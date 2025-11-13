import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import fs from 'node:fs';

import express from 'express';
import storage from 'node-persist';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getUserDirectories, toKey, getPasswordHash } from '../users.js';

// 从环境变量读取管理员凭据，避免硬编码
const ADMIN_CREDENTIALS = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'changeme',
};

const ACCOUNT_PREFIX = 'account:';
const REDEEM_CODE_PREFIX = 'redeem:';
const INVITE_CODE_PREFIX = 'invite:';
const SYSTEM_CONFIG_KEY = 'system:config';

function toAccountKey(handle) {
    return `${ACCOUNT_PREFIX}${handle}`;
}

function toRedeemCodeKey(code) {
    return `${REDEEM_CODE_PREFIX}${code.toUpperCase()}`;
}

function toInviteCodeKey(code) {
    return `${INVITE_CODE_PREFIX}${code.toUpperCase()}`;
}

/**
 * @typedef {Object} RedeemCode
 * @property {string} code
 * @property {number} points
 * @property {boolean} used
 * @property {string|null} usedBy
 * @property {number} createdAt
 * @property {number|null} usedAt
 */

/**
 * @typedef {Object} SystemConfig
 * @property {boolean} registrationEnabled
 */

// 获取系统配置
async function getSystemConfig() {
    const config = await storage.getItem(SYSTEM_CONFIG_KEY);
    if (!config) {
        const defaultConfig = {
            registrationEnabled: true,
        };
        await storage.setItem(SYSTEM_CONFIG_KEY, defaultConfig);
        return defaultConfig;
    }
    return config;
}

// 设置系统配置
async function setSystemConfig(config) {
    await storage.setItem(SYSTEM_CONFIG_KEY, config);
}

// 检查是否允许注册
export async function isRegistrationEnabled() {
    const config = await getSystemConfig();
    return config.registrationEnabled !== false;
}

// 验证管理员凭据
function verifyAdminCredentials(username, password) {
    return username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password;
}

// 生成随机兑换码
function generateRedeemCode(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// 计算目录大小
async function getDirectorySize(dirPath) {
    try {
        let totalSize = 0;

        async function calculateSize(currentPath) {
            const stats = await fsPromises.stat(currentPath);

            if (stats.isFile()) {
                totalSize += stats.size;
            } else if (stats.isDirectory()) {
                const files = await fsPromises.readdir(currentPath);
                for (const file of files) {
                    await calculateSize(path.join(currentPath, file));
                }
            }
        }

        if (fs.existsSync(dirPath)) {
            await calculateSize(dirPath);
        }

        return totalSize;
    } catch (error) {
        console.error('Error calculating directory size:', error);
        return 0;
    }
}

// 格式化文件大小
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export const router = express.Router();

// 管理员登录
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        if (verifyAdminCredentials(username, password)) {
            // 设置管理员会话
            if (req.session) {
                req.session.isAdmin = true;
                req.session.adminUser = username;
            }
            return res.json({ success: true, message: '登录成功' });
        } else {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ error: '登录失败' });
    }
});

// 管理员登出
router.post('/logout', async (req, res) => {
    try {
        if (req.session) {
            req.session.isAdmin = false;
            req.session.adminUser = null;
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('Admin logout error:', error);
        return res.status(500).json({ error: '登出失败' });
    }
});

// 验证管理员权限的中间件
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.status(403).json({ error: '需要管理员权限' });
}

// 应用管理员权限检查到所有需要权限的路由
router.use(requireAdmin);

// 获取所有用户列表
router.get('/users', async (req, res) => {
    try {
        const allKeys = await storage.keys(x => x.key.startsWith('user:'));
        const users = [];

        for (const key of allKeys) {
            const handle = key.replace('user:', '');
            const userData = await storage.getItem(key);
            const accountData = await storage.getItem(toAccountKey(handle));

            if (userData) {
                const directories = getUserDirectories(handle);
                const storageSize = await getDirectorySize(directories.root);

                users.push({
                    handle: userData.handle,
                    name: userData.name,
                    enabled: userData.enabled,
                    admin: userData.admin,
                    created: userData.created,
                    points: accountData?.points || 0,
                    accessOn: accountData?.accessOn || false,
                    storageSize: storageSize,
                    storageSizeFormatted: formatBytes(storageSize),
                });
            }
        }

        // 按创建时间排序
        users.sort((a, b) => (b.created || 0) - (a.created || 0));

        return res.json({ users });
    } catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({ error: '获取用户列表失败' });
    }
});

// 修改用户积分
router.post('/users/:handle/points', async (req, res) => {
    try {
        const { handle } = req.params;
        const { action, amount } = req.body;

        if (!['add', 'subtract', 'set'].includes(action)) {
            return res.status(400).json({ error: '无效的操作类型' });
        }

        if (typeof amount !== 'number' || amount < 0) {
            return res.status(400).json({ error: '无效的积分数量' });
        }

        const accountKey = toAccountKey(handle);
        let accountData = await storage.getItem(accountKey);

        if (!accountData) {
            return res.status(404).json({ error: '用户不存在' });
        }

        let newPoints = accountData.points || 0;

        switch (action) {
            case 'add':
                newPoints += amount;
                break;
            case 'subtract':
                newPoints = Math.max(0, newPoints - amount);
                break;
            case 'set':
                newPoints = amount;
                break;
        }

        accountData.points = Math.round(newPoints * 2) / 2;
        await storage.setItem(accountKey, accountData);

        return res.json({
            success: true,
            points: accountData.points,
            message: `积分已${action === 'add' ? '增加' : action === 'subtract' ? '减少' : '设置为'} ${amount}`,
        });
    } catch (error) {
        console.error('Modify points error:', error);
        return res.status(500).json({ error: '修改积分失败' });
    }
});

// 封禁/解封用户
router.post('/users/:handle/toggle-ban', async (req, res) => {
    try {
        const { handle } = req.params;
        const userKey = toKey(handle);
        const userData = await storage.getItem(userKey);

        if (!userData) {
            return res.status(404).json({ error: '用户不存在' });
        }

        userData.enabled = !userData.enabled;
        await storage.setItem(userKey, userData);

        return res.json({
            success: true,
            enabled: userData.enabled,
            message: userData.enabled ? '用户已解封' : '用户已封禁',
        });
    } catch (error) {
        console.error('Toggle ban error:', error);
        return res.status(500).json({ error: '操作失败' });
    }
});

// 删除用户数据
router.delete('/users/:handle/data', async (req, res) => {
    try {
        const { handle } = req.params;
        const directories = getUserDirectories(handle);

        // 删除用户数据目录
        if (fs.existsSync(directories.root)) {
            await fsPromises.rm(directories.root, { recursive: true, force: true });
        }

        // 重置账户状态
        const accountKey = toAccountKey(handle);
        const accountData = await storage.getItem(accountKey);
        if (accountData) {
            accountData.points = 0;
            accountData.accessOn = false;
            accountData.lastCheckInDate = '';
            await storage.setItem(accountKey, accountData);
        }

        return res.json({
            success: true,
            message: '用户数据已删除',
        });
    } catch (error) {
        console.error('Delete user data error:', error);
        return res.status(500).json({ error: '删除用户数据失败' });
    }
});

// 创建兑换码
router.post('/redeem-codes', async (req, res) => {
    try {
        const { points, count = 1 } = req.body;

        if (typeof points !== 'number' || points <= 0) {
            return res.status(400).json({ error: '无效的积分数量' });
        }

        if (typeof count !== 'number' || count <= 0 || count > 100) {
            return res.status(400).json({ error: '数量必须在1-100之间' });
        }

        const codes = [];

        for (let i = 0; i < count; i++) {
            let code = generateRedeemCode();
            let attempts = 0;

            // 确保生成的兑换码不重复
            while (await storage.getItem(toRedeemCodeKey(code)) && attempts < 10) {
                code = generateRedeemCode();
                attempts++;
            }

            /** @type {RedeemCode} */
            const redeemCode = {
                code: code,
                points: points,
                used: false,
                usedBy: null,
                createdAt: Date.now(),
                usedAt: null,
            };

            await storage.setItem(toRedeemCodeKey(code), redeemCode);
            codes.push(redeemCode);
        }

        return res.json({
            success: true,
            codes: codes.map(c => ({
                code: c.code,
                points: c.points,
                createdAt: c.createdAt,
            })),
            message: `成功创建 ${count} 个兑换码`,
        });
    } catch (error) {
        console.error('Create redeem codes error:', error);
        return res.status(500).json({ error: '创建兑换码失败' });
    }
});

// 获取所有兑换码
router.get('/redeem-codes', async (req, res) => {
    try {
        const allKeys = await storage.keys(x => x.key.startsWith(REDEEM_CODE_PREFIX));
        const codes = [];

        for (const key of allKeys) {
            const codeData = await storage.getItem(key);
            if (codeData) {
                codes.push(codeData);
            }
        }

        // 按创建时间倒序排序
        codes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return res.json({ codes });
    } catch (error) {
        console.error('Get redeem codes error:', error);
        return res.status(500).json({ error: '获取兑换码列表失败' });
    }
});

// 删除兑换码
router.delete('/redeem-codes/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const codeKey = toRedeemCodeKey(code);

        const codeData = await storage.getItem(codeKey);
        if (!codeData) {
            return res.status(404).json({ error: '兑换码不存在' });
        }

        await storage.removeItem(codeKey);

        return res.json({
            success: true,
            message: '兑换码已删除',
        });
    } catch (error) {
        console.error('Delete redeem code error:', error);
        return res.status(500).json({ error: '删除兑换码失败' });
    }
});

// 获取系统统计信息
router.get('/stats', async (req, res) => {
    try {
        const allUserKeys = await storage.keys(x => x.key.startsWith('user:'));
        const allCodeKeys = await storage.keys(x => x.key.startsWith(REDEEM_CODE_PREFIX));
        const allInviteKeys = await storage.keys(x => x.key.startsWith(INVITE_CODE_PREFIX));

        let totalStorage = 0;
        let activeUsers = 0;
        let totalPoints = 0;

        for (const key of allUserKeys) {
            const handle = key.replace('user:', '');
            const userData = await storage.getItem(key);
            const accountData = await storage.getItem(toAccountKey(handle));

            if (userData && userData.enabled) {
                activeUsers++;
            }

            if (accountData) {
                totalPoints += accountData.points || 0;
            }

            const directories = getUserDirectories(handle);
            const storageSize = await getDirectorySize(directories.root);
            totalStorage += storageSize;
        }

        let usedCodes = 0;
        let unusedCodes = 0;

        for (const key of allCodeKeys) {
            const codeData = await storage.getItem(key);
            if (codeData) {
                if (codeData.used) {
                    usedCodes++;
                } else {
                    unusedCodes++;
                }
            }
        }

        return res.json({
            totalUsers: allUserKeys.length,
            activeUsers,
            totalStorage: totalStorage,
            totalStorageFormatted: formatBytes(totalStorage),
            totalPoints,
            redeemCodes: {
                total: allCodeKeys.length,
                used: usedCodes,
                unused: unusedCodes,
            },
            inviteCodes: {
                total: allInviteKeys.length,
                // count used invites
                used: (await Promise.all(allInviteKeys.map(async (k) => {
                    const c = await storage.getItem(k);
                    return c?.used ? 1 : 0;
                }))).reduce((a, b) => a + b, 0),
            },
        });
    } catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({ error: '获取统计信息失败' });
    }
});

// 获取系统配置
router.get('/config', async (req, res) => {
    try {
        const config = await getSystemConfig();
        return res.json(config);
    } catch (error) {
        console.error('Get config error:', error);
        return res.status(500).json({ error: '获取系统配置失败' });
    }
});

// 更新系统配置
router.post('/config', async (req, res) => {
    try {
        const { registrationEnabled } = req.body;

        if (typeof registrationEnabled !== 'boolean') {
            return res.status(400).json({ error: '无效的配置参数' });
        }

        const config = await getSystemConfig();
        config.registrationEnabled = registrationEnabled;
        await setSystemConfig(config);

        return res.json({
            success: true,
            config,
            message: `注册功能已${registrationEnabled ? '开启' : '关闭'}`,
        });
    } catch (error) {
        console.error('Update config error:', error);
        return res.status(500).json({ error: '更新系统配置失败' });
    }
});

// ──────────────────────────────────────────────────────────────
// 邀请码管理
// ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} InviteCode
 * @property {string} code
 * @property {boolean} used
 * @property {string|null} usedBy
 * @property {number} createdAt
 * @property {number|null} usedAt
 * @property {number|null} expiresAt - 过期时间戳，null表示永不过期
 */

// 批量创建邀请码
router.post('/invite-codes', async (req, res) => {
    try {
        const { count = 1, expiresInDays } = req.body || {};

        if (typeof count !== 'number' || count <= 0 || count > 200) {
            return res.status(400).json({ error: '数量必须在 1-200 之间' });
        }

        // 验证过期天数
        let expiresAt = null;
        if (expiresInDays !== undefined && expiresInDays !== null) {
            if (typeof expiresInDays !== 'number' || expiresInDays <= 0 || expiresInDays > 365) {
                return res.status(400).json({ error: '过期天数必须在 1-365 之间' });
            }
            expiresAt = Date.now() + (expiresInDays * 24 * 60 * 60 * 1000);
        }

        const created = [];
        for (let i = 0; i < count; i++) {
            let code = generateRedeemCode(12);
            let attempts = 0;
            // 增加重试次数到50次，减少生成失败的可能性
            while (await storage.getItem(toInviteCodeKey(code)) && attempts < 50) {
                code = generateRedeemCode(12);
                attempts++;
            }

            // 如果50次都失败了，返回错误
            if (attempts >= 50) {
                return res.status(500).json({ error: '生成邀请码失败，请稍后重试' });
            }

            /** @type {InviteCode} */
            const invite = {
                code,
                used: false,
                usedBy: null,
                createdAt: Date.now(),
                usedAt: null,
                expiresAt,
            };
            await storage.setItem(toInviteCodeKey(code), invite);
            created.push(invite);
        }

        return res.json({
            success: true,
            codes: created.map(c => ({
                code: c.code,
                createdAt: c.createdAt,
                expiresAt: c.expiresAt,
            })),
            message: `成功创建 ${created.length} 个邀请码${expiresAt ? `，有效期 ${expiresInDays} 天` : ''}`,
        });
    } catch (error) {
        console.error('Create invite codes error:', error);
        return res.status(500).json({ error: '创建邀请码失败' });
    }
});

// 获取所有邀请码
router.get('/invite-codes', async (_req, res) => {
    try {
        const keys = await storage.keys(k => k.key.startsWith(INVITE_CODE_PREFIX));
        const codes = [];
        for (const key of keys) {
            const data = await storage.getItem(key);
            if (data) codes.push(data);
        }
        codes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.json({ codes });
    } catch (error) {
        console.error('Get invite codes error:', error);
        return res.status(500).json({ error: '获取邀请码失败' });
    }
});

// 删除未使用的邀请码
router.delete('/invite-codes/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const key = toInviteCodeKey(code);
        const data = await storage.getItem(key);
        if (!data) {
            return res.status(404).json({ error: '邀请码不存在' });
        }
        if (data.used) {
            return res.status(400).json({ error: '邀请码已被使用，无法删除' });
        }
        await storage.removeItem(key);
        return res.json({ success: true, message: '邀请码已删除' });
    } catch (error) {
        console.error('Delete invite code error:', error);
        return res.status(500).json({ error: '删除邀请码失败' });
    }
});
