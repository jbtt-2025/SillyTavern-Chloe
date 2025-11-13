import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import express from 'express';
import storage from 'node-persist';

import { getUserDirectories, toKey, getPasswordHash, getPasswordSalt } from '../users.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h cooldown for check-in
const ACCOUNT_PREFIX = 'account:';
const REDEEM_CODE_PREFIX = 'redeem:';

/**
 * @typedef {Object} AccountState
 * @property {string} handle
 * @property {number} points
 * @property {boolean} accessOn
 * @property {number} lastCostAppliedAt Epoch ms at local midnight when cost was last applied
 * @property {string} lastCheckInDate YYYY-MM-DD for daily check-in limiter (legacy)
 * @property {number|null} lastCheckInAt Epoch ms when user last checked in (for tz-aware checks)
 * @property {number|null} accessOffSince Epoch ms when entered OFF state (for 30 days purge)
 * @property {number} createdAt Epoch ms when the state was created
 */

function toAccountKey(handle) {
    return `${ACCOUNT_PREFIX}${handle}`;
}

function toRedeemCodeKey(code) {
    return `${REDEEM_CODE_PREFIX}${code.toUpperCase()}`;
}

function toDateString(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

/**
 * Formats a date string (YYYY-MM-DD) using a client-provided timezone offset.
 * Offset is minutes as returned by Date.getTimezoneOffset() on the client.
 * Positive values mean locations west of UTC, negative east of UTC.
 *
 * Implementation detail: to compute the client local calendar day irrespective of server TZ,
 * convert the UTC timestamp into the client's local clock by subtracting the offset in ms,
 * then read the UTC parts.
 * @param {number} ts Epoch milliseconds
 * @param {number} offsetMinutes Client timezone offset in minutes
 */
function toDateStringWithOffset(ts, offsetMinutes) {
    const t = ts - (Number.isFinite(offsetMinutes) ? offsetMinutes : 0) * 60 * 1000;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

function getClientOffset(req) {
    const raw = /** @type {string|undefined} */ (req.headers['x-tz-offset']);
    const parsed = raw != null ? parseInt(Array.isArray(raw) ? raw[0] : raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}

function todayMidnight(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Initialize account state if missing.
 * @param {string} handle
 * @returns {Promise<AccountState>}
 */
async function getOrInitState(handle) {
    /** @type {AccountState | undefined} */
    const existing = await storage.getItem(toAccountKey(handle));
    if (existing) return existing;

    /** @type {AccountState} */
    const initial = {
        handle,
        points: 20,
        accessOn: true,
        lastCostAppliedAt: todayMidnight(),
        lastCheckInDate: '',
        lastCheckInAt: null,
        accessOffSince: null,
        createdAt: Date.now(),
    };
    await storage.setItem(toAccountKey(handle), initial);
    return initial;
}

/**
 * Applies daily costs since lastCostAppliedAt up to today midnight.
 * Also enforces 30-day purge on continuous OFF.
 * @param {AccountState} state
 * @returns {Promise<AccountState>}
 */
async function applyDailyCosts(state) {
    const nowMid = todayMidnight();
    let appliedFrom = state.lastCostAppliedAt || todayMidnight(state.createdAt || Date.now());
    if (appliedFrom > nowMid) {
        state.lastCostAppliedAt = nowMid;
        return state;
    }

    const days = Math.floor((nowMid - appliedFrom) / MS_PER_DAY);
    if (days > 0) {
        const rate = state.accessOn ? 1 : 0;
        const cost = days * rate;
        state.points = Math.max(0, Math.round((state.points - cost) * 2) / 2);
        state.lastCostAppliedAt = appliedFrom + days * MS_PER_DAY;
        await storage.setItem(toAccountKey(state.handle), state);
    }

    // Purge if OFF >= 30 days
    if (state.accessOn === false && state.accessOffSince && (Date.now() - state.accessOffSince) >= 30 * MS_PER_DAY) {
        await purgeUserData(state.handle);
        // After purge, reset account state to initial with 0 points and OFF
        state.points = 0;
        state.accessOn = false;
        state.lastCheckInDate = '';
        state.accessOffSince = todayMidnight();
        state.lastCostAppliedAt = todayMidnight();
        await storage.setItem(toAccountKey(state.handle), state);
        // Signal purge via flag on response level (handled in routes) by attaching property
        // but we keep state persisted as zeroed so future requests are consistent.
        // The route will add { purged: true } in response separately.
    }

    return state;
}

async function purgeUserData(handle) {
    try {
        const userKey = toKey(handle);
        await storage.removeItem(userKey);
        const directories = getUserDirectories(handle);
        await fsPromises.rm(directories.root, { recursive: true, force: true });
    } catch (err) {
        // Log but do not crash; continue flow
        console.warn('purgeUserData failed for', handle, err?.message || err);
    }
}

/**
 * Builds a serializable status payload for the current request user.
 * @param {import('express').Request} req
 */
async function buildStatus(req) {
    const handle = req.user?.profile?.handle;
    const name = req.user?.profile?.name;
    if (!handle) throw new Error('No user in request');
    let state = await getOrInitState(handle);
    const beforeOffSince = state.accessOffSince;
    state = await applyDailyCosts(state);

    const offDays = state.accessOn || !state.accessOffSince
        ? 0
        : Math.floor((todayMidnight() - todayMidnight(state.accessOffSince)) / MS_PER_DAY);
    // 24-hour cooldown logic
    let lastCheckInAt = state.lastCheckInAt;
    if (lastCheckInAt == null && state.lastCheckInDate) {
        // Best-effort migration from legacy date string: treat as midnight UTC
        const parsed = Date.parse(`${state.lastCheckInDate}T00:00:00Z`);
        if (!Number.isNaN(parsed)) lastCheckInAt = parsed;
    }
    const now = Date.now();
    const canCheckInToday = lastCheckInAt == null || (now - lastCheckInAt) >= COOLDOWN_MS;
    const nextCheckInAt = lastCheckInAt == null ? now : (lastCheckInAt + COOLDOWN_MS);

    const didPurge = beforeOffSince && !state.accessOn && (Date.now() - beforeOffSince) >= 30 * MS_PER_DAY;

    return {
        handle,
        name,
        points: state.points,
        accessOn: state.accessOn,
        offDays,
        canCheckInToday,
        nextCheckInAt,
        purged: !!didPurge,
    };
}

export const router = express.Router();

// Get current account status
router.get('/status', async (req, res) => {
    try {
        if (!req.user) return res.sendStatus(403);
        const status = await buildStatus(req);
        return res.json(status);
    } catch (err) {
        console.error('account/status failed', err);
        return res.sendStatus(500);
    }
});

// Daily check-in: +5 points once per calendar day
router.post('/checkin', async (req, res) => {
    try {
        if (!req.user) return res.sendStatus(403);
        const handle = req.user.profile.handle;
        let state = await getOrInitState(handle);
        state = await applyDailyCosts(state);
        // 24-hour cooldown enforcement
        const now = Date.now();
        let lastCheckInAt = state.lastCheckInAt;
        if (lastCheckInAt == null && state.lastCheckInDate) {
            const parsed = Date.parse(`${state.lastCheckInDate}T00:00:00Z`);
            if (!Number.isNaN(parsed)) lastCheckInAt = parsed;
        }
        if (lastCheckInAt != null && (now - lastCheckInAt) < COOLDOWN_MS) {
            return res.status(400).json({ error: '冷却中，尚未到下一次签到时间', nextCheckInAt: lastCheckInAt + COOLDOWN_MS });
        }
        state.points = Math.round((state.points + 5) * 2) / 2;
        state.lastCheckInAt = now;
        state.lastCheckInDate = toDateString(now);
        await storage.setItem(toAccountKey(handle), state);
        return res.json({ points: state.points, lastCheckInAt: state.lastCheckInAt, lastCheckInDate: state.lastCheckInDate, nextCheckInAt: now + COOLDOWN_MS });
    } catch (err) {
        console.error('account/checkin failed', err);
        return res.sendStatus(500);
    }
});

// Toggle access on/off
router.post('/toggle', async (req, res) => {
    try {
        if (!req.user) return res.sendStatus(403);
        const handle = req.user.profile.handle;
        const desired = typeof req.body?.accessOn === 'boolean' ? req.body.accessOn : undefined;
        if (typeof desired !== 'boolean') {
            return res.status(400).json({ error: 'Missing accessOn boolean' });
        }
        let state = await getOrInitState(handle);
        state = await applyDailyCosts(state);
        if (state.accessOn !== desired) {
            if (desired === true) {
                // Activation fee: requires and deducts 1 point immediately
                if ((state.points ?? 0) < 1) {
                    return res.status(400).json({ error: '积分不足，无法开启（需要 1 积分）' });
                }
                state.points = Math.max(0, Math.round((state.points - 1) * 2) / 2);
                state.accessOn = true;
                state.accessOffSince = null;
            } else {
                state.accessOn = false;
                state.accessOffSince = Date.now();
            }
            await storage.setItem(toAccountKey(handle), state);
        }
        return res.json({ accessOn: state.accessOn, points: state.points });
    } catch (err) {
        console.error('account/toggle failed', err);
        return res.sendStatus(500);
    }
});

// Redeem code: adds points to account
router.post('/redeem', async (req, res) => {
    try {
        if (!req.user) return res.sendStatus(403);
        const handle = req.user.profile.handle;
        const { code } = req.body;

        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: '请输入兑换码' });
        }

        const codeKey = toRedeemCodeKey(code);
        const redeemData = await storage.getItem(codeKey);

        if (!redeemData) {
            return res.status(404).json({ error: '兑换码不存在或已失效' });
        }

        if (redeemData.used) {
            return res.status(400).json({ error: '此兑换码已被使用' });
        }

        // Mark code as used
        redeemData.used = true;
        redeemData.usedBy = handle;
        redeemData.usedAt = Date.now();
        await storage.setItem(codeKey, redeemData);

        // Add points to user account
        let state = await getOrInitState(handle);
        state = await applyDailyCosts(state);
        state.points = Math.round((state.points + redeemData.points) * 2) / 2;
        await storage.setItem(toAccountKey(handle), state);

        return res.json({
            success: true,
            points: state.points,
            addedPoints: redeemData.points,
            message: `成功兑换 ${redeemData.points} 积分`,
        });
    } catch (err) {
        console.error('account/redeem failed', err);
        return res.sendStatus(500);
    }
});

// Leaderboard: top users by points, plus caller's rank
router.get('/leaderboard', async (req, res) => {
    try {
        if (!req.user) return res.sendStatus(403);
        const myHandle = req.user.profile.handle;

        // Collect all users and their points
        const userKeys = await storage.keys((x) => x.key.startsWith('user:'));
        const rows = [];
        for (const key of userKeys) {
            const handle = key.replace('user:', '');
            const userData = await storage.getItem(key);
            // Skip explicitly disabled users if flag present
            if (userData && userData.enabled === false) continue;
            const state = await getOrInitState(handle);
            rows.push({
                handle,
                name: userData?.name || handle,
                points: state.points || 0,
            });
        }

        // Sort by points desc, then by handle for stability
        rows.sort((a, b) => {
            if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
            return a.handle.localeCompare(b.handle);
        });

        const myIndex = rows.findIndex((r) => r.handle === myHandle);
        const myRank = myIndex >= 0 ? (myIndex + 1) : null;

        // Limit leaderboard size to top 50
        const top = rows.slice(0, 50).map(({ name, handle, points }) => ({ name, handle, points }));

        const myState = await getOrInitState(myHandle);
        return res.json({
            total: rows.length,
            myRank,
            myPoints: myState.points || 0,
            leaderboard: top,
        });
    } catch (err) {
        console.error('account/leaderboard failed', err);
        return res.sendStatus(500);
    }
});

// 修改密码
router.post('/change-password', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const handle = req.user.profile.handle;

    try {
        const { currentPassword, newPassword } = req.body || {};

        // 验证输入
        if (!currentPassword || typeof currentPassword !== 'string') {
            return res.status(400).json({ error: '请输入当前密码' });
        }

        if (!newPassword || typeof newPassword !== 'string') {
            return res.status(400).json({ error: '请输入新密码' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: '新密码至少需要 6 位字符' });
        }

        if (newPassword.length > 128) {
            return res.status(400).json({ error: '新密码最多 128 位字符' });
        }

        // 获取用户数据
        const userKey = toKey(handle);
        const userData = await storage.getItem(userKey);

        if (!userData) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 验证当前密码
        const currentPasswordHash = getPasswordHash(currentPassword, userData.salt);
        if (currentPasswordHash !== userData.password) {
            return res.status(401).json({ error: '当前密码错误' });
        }

        // 生成新密码的盐和哈希
        const newSalt = getPasswordSalt();
        const newPasswordHash = getPasswordHash(newPassword, newSalt);

        // 更新密码
        userData.password = newPasswordHash;
        userData.salt = newSalt;
        userData.passwordChangedAt = Date.now();

        await storage.setItem(userKey, userData);

        return res.json({
            success: true,
            message: '密码修改成功',
        });
    } catch (error) {
        console.error('Change password error:', error);
        return res.status(500).json({ error: '修改密码失败' });
    }
});

// Helper used by server-main for gating /app
export async function getEffectiveAccess(req) {
    if (!req.user) return { allowed: false, reason: 'NOT_LOGGED_IN' };
    const handle = req.user.profile.handle;
    let state = await getOrInitState(handle);
    state = await applyDailyCosts(state);
    if (!state.accessOn) return { allowed: false, reason: 'OFF' };
    if (state.points <= 0) return { allowed: false, reason: 'NO_POINTS' };
    return { allowed: true };
}

export default router;
