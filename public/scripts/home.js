// ═══════════════════════════════════════════════════════════════
// PIXEL ART MULTI-PAGE APP - CHLOE HOME
// Navigation system with sidebar and page switching
// ═══════════════════════════════════════════════════════════════

let CSRF = 'disabled';
let currentPage = 'dashboard';
let userStatus = null;
let checkinCountdownTimer = null;
let leaderboardTimer = null;

// ═══════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function fetchCsrf() {
    try {
        const res = await fetch('/csrf-token');
        if (res.ok) {
            const j = await res.json();
            CSRF = j.token || 'disabled';
        }
    } catch {}
}

async function getStatus() {
    const tzOffset = new Date().getTimezoneOffset();
    const baseHeaders = { 'x-tz-offset': String(tzOffset) };
    const headers = CSRF === 'disabled' ? baseHeaders : { ...baseHeaders, 'x-csrf-token': CSRF };
    const res = await fetch('/api/account/status', { headers });
    if (!res.ok) throw new Error('status failed');
    return res.json();
}

async function postJSON(url, body) {
    const headers = { 'Content-Type': 'application/json', 'x-tz-offset': String(new Date().getTimezoneOffset()) };
    if (CSRF && CSRF !== 'disabled') headers['x-csrf-token'] = CSRF;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {})
    });
    if (!res.ok) {
        let msg = `${url} failed`;
        try {
            const data = await res.json();
            if (data && data.error) msg = data.error;
        } catch {
            try { msg = await res.text(); } catch {}
        }
        throw new Error(msg);
    }
    return res.json().catch(() => ({}));
}

function qs(id) {
    return document.getElementById(id);
}

function clearURLParams() {
    // Remove URL parameters without reloading the page
    const url = new URL(window.location);
    url.search = '';
    window.history.replaceState({}, '', url);
}

// ═══════════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════════════════

const PAGE_TITLES = {
    dashboard: '仪表盘',
    checkin: '签到',
    redeem: '兑换码',
    leaderboard: '排行榜',
    settings: '设置',
    about: '关于',
    contact: '联系'
};

function navigateToPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show target page
    const targetPage = qs(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) {
            item.classList.add('active');
        }
    });

    // Update page title
    const titleEl = qs('currentPageTitle');
    if (titleEl && PAGE_TITLES[pageName]) {
        titleEl.textContent = PAGE_TITLES[pageName];
    }

    currentPage = pageName;

    // Close sidebar on mobile
    if (window.innerWidth < 1024) {
        closeSidebar();
    }

    // Update page-specific data
    if (pageName === 'checkin' || pageName === 'settings') {
        updatePageData();
    }

    // Load leaderboard data when navigating to leaderboard page
    if (pageName === 'leaderboard') {
        loadLeaderboard();
        if (leaderboardTimer) clearInterval(leaderboardTimer);
        leaderboardTimer = setInterval(loadLeaderboard, 15000);
    } else {
        if (leaderboardTimer) {
            clearInterval(leaderboardTimer);
            leaderboardTimer = null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR CONTROL
// ═══════════════════════════════════════════════════════════════

function openSidebar() {
    const sidebar = qs('sidebar');
    const overlay = qs('sidebarOverlay');

    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
}

function closeSidebar() {
    const sidebar = qs('sidebar');
    const overlay = qs('sidebarOverlay');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

function toggleSidebar() {
    const sidebar = qs('sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

// ═══════════════════════════════════════════════════════════════
// DATA DISPLAY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function applyStatus(s) {
    userStatus = s;

    // Update all username displays
    const usernameEls = ['username'];
    usernameEls.forEach(id => {
        const el = qs(id);
        if (el) el.textContent = s.name || s.handle || '-';
    });

    // Update all points displays
    const pointsEls = ['points', 'pointsCheckin'];
    pointsEls.forEach(id => {
        const el = qs(id);
        if (el) el.textContent = String(s.points);
    });

    // Access control buttons
    const accessOnBtn = qs('accessOnBtn');
    const accessOffBtn = qs('accessOffBtn');

    if (accessOnBtn && accessOffBtn) {
        if (s.accessOn) {
            // Currently ON: disable ON button, enable OFF button
            accessOnBtn.disabled = true;
            accessOffBtn.disabled = false;
        } else {
            // Currently OFF: enable ON button, disable OFF button
            accessOnBtn.disabled = false;
            accessOffBtn.disabled = true;
        }
    }

    // Access labels
    const accessLabel = qs('accessLabel');
    if (accessLabel) {
        accessLabel.textContent = s.accessOn ? '已开启' : '已关闭';
        // Update styling for emphasis
        accessLabel.classList.toggle('highlight', s.accessOn);
    }

    const dailyCost = qs('dailyCost');
    if (dailyCost) {
        dailyCost.textContent = s.accessOn ? '1 积分/天' : '不消耗';
        // Update styling for emphasis
        dailyCost.classList.toggle('highlight', s.accessOn);
    }

    const accessStatusText = qs('accessStatusText');
    if (accessStatusText) {
        accessStatusText.textContent = s.accessOn ? '开启' : '关闭';
        // Update badge styling
        accessStatusText.classList.remove('status-on', 'status-off');
        accessStatusText.classList.add(s.accessOn ? 'status-on' : 'status-off');
    }

    // Off days
    const offDaysEls = document.querySelectorAll('#offDays');
    offDaysEls.forEach(el => {
        el.textContent = String(s.offDays || 0);
    });

    // Check-in button
    const checkinBtn = qs('checkinBtn');
    if (checkinBtn) {
        checkinBtn.disabled = !s.canCheckInToday;
        const btnText = checkinBtn.querySelector('.button-text');
        if (btnText) {
            if (s.canCheckInToday) {
                btnText.textContent = '每日签到 +5 积分';
            } else {
                btnText.textContent = '已签到';
            }
        }
    }

    // Check-in cooldown countdown
    const cooldownWrap = qs('checkinCooldownWrap');
    const cooldownEl = qs('checkinCooldown');
    if (cooldownWrap && cooldownEl) {
        const nextAt = s.nextCheckInAt || 0;
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((nextAt - now) / 1000));

        const updateCooldown = () => {
            const now2 = Date.now();
            const remain = Math.max(0, Math.floor(((s.nextCheckInAt || 0) - now2) / 1000));
            const h = Math.floor(remain / 3600);
            const m = Math.floor((remain % 3600) / 60);
            const sec = remain % 60;
            const pad = (n) => String(n).padStart(2, '0');
            cooldownEl.textContent = `${pad(h)}:${pad(m)}:${pad(sec)}`;
            if (remain <= 0 && checkinCountdownTimer) {
                clearInterval(checkinCountdownTimer);
                checkinCountdownTimer = null;
                // Refresh status to re-enable the button promptly
                getStatus().then(applyStatus).catch(() => {});
            }
        };

        if (!s.canCheckInToday && remaining > 0) {
            cooldownWrap.classList.remove('hidden');
            updateCooldown();
            if (checkinCountdownTimer) clearInterval(checkinCountdownTimer);
            checkinCountdownTimer = setInterval(updateCooldown, 1000);
        } else {
            cooldownWrap.classList.add('hidden');
            if (checkinCountdownTimer) {
                clearInterval(checkinCountdownTimer);
                checkinCountdownTimer = null;
            }
        }
    }

    // Alert messages
    const params = new URLSearchParams(location.search);
    const denied = params.get('denied');
    const alertBox = qs('alert');
    const alertText = qs('alertText');

    if (alertBox && alertText) {
        if (s.purged) {
            alertText.textContent = '因连续关闭满 30 天，已清除账号数据。可继续签到积攒积分后再使用。';
            alertBox.classList.remove('hidden');
            // Clear URL params after showing alert
            clearURLParams();
        } else if (denied) {
            let msg = '无法进入 SillyTavern：';
            if (denied === 'NO_POINTS') msg += '积分不足';
            else if (denied === 'OFF') msg += '访问已关闭';
            else msg += '权限受限';
            alertText.textContent = msg;
            alertBox.classList.remove('hidden');
            // Clear URL params after showing alert
            clearURLParams();
        } else {
            alertBox.classList.add('hidden');
        }
    }
}

function updatePageData() {
    if (userStatus) {
        applyStatus(userStatus);
    }
}

// ═══════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════

function showConfirmDialog(title, message, confirmText, cancelText) {
    return new Promise((resolve) => {
        // Create dialog overlay
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        // Create dialog box
        const dialog = document.createElement('div');
        dialog.className = 'pixel-dialog';

        dialog.innerHTML = `
            <div class="dialog-header">
                <span class="dialog-icon">⚠</span>
                <span class="dialog-title">${title}</span>
            </div>
            <div class="dialog-body">
                <p class="dialog-message">${message}</p>
            </div>
            <div class="dialog-footer">
                <button class="pixel-button dialog-btn confirm-btn">
                    <span class="button-content">
                        <span class="button-icon">✓</span>
                        <span class="button-text">${confirmText}</span>
                    </span>
                </button>
                <button class="pixel-button dialog-btn cancel-btn">
                    <span class="button-content">
                        <span class="button-icon">✕</span>
                        <span class="button-text">${cancelText}</span>
                    </span>
                </button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Animate in
        if (animate) {
            animate(overlay, { opacity: [0, 1] }, { duration: 0.2 });
            animate(dialog, { scale: [0.9, 1], opacity: [0, 1] }, { duration: 0.3 });
        } else {
            overlay.style.opacity = '1';
            dialog.style.opacity = '1';
        }

        const confirmBtn = dialog.querySelector('.confirm-btn');
        const cancelBtn = dialog.querySelector('.cancel-btn');

        // Add button effects
        [confirmBtn, cancelBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                const icon = btn.querySelector('.button-icon');
                if (icon && animate) {
                    animate(icon, { x: [0, 5, 0] }, { duration: 0.3 });
                }
            });

            btn.addEventListener('click', (e) => {
                const ripple = document.createElement('div');
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                ripple.style.cssText = `
                    position: absolute;
                    width: 10px;
                    height: 10px;
                    background: ${btn.classList.contains('confirm-btn') ? '#fff' : '#000'};
                    left: ${x}px;
                    top: ${y}px;
                    opacity: 0.5;
                    pointer-events: none;
                `;
                btn.appendChild(ripple);

                if (animate) {
                    animate(
                        ripple,
                        {
                            width: [10, 100],
                            height: [10, 100],
                            opacity: [0.5, 0],
                            x: [-5, -50],
                            y: [-5, -50]
                        },
                        { duration: 0.6 }
                    ).finished.then(() => ripple.remove());
                }
            });
        });

        const cleanup = () => {
            if (animate) {
                Promise.all([
                    animate(overlay, { opacity: [1, 0] }, { duration: 0.2 }).finished,
                    animate(dialog, { scale: [1, 0.9], opacity: [1, 0] }, { duration: 0.2 }).finished
                ]).then(() => {
                    overlay.remove();
                });
            } else {
                overlay.remove();
            }
        };

        confirmBtn.addEventListener('click', () => {
            setTimeout(() => {
                cleanup();
                resolve(true);
            }, 100);
        });

        cancelBtn.addEventListener('click', () => {
            setTimeout(() => {
                cleanup();
                resolve(false);
            }, 100);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'success', duration = 3000) {
    const container = qs('toastContainer');
    if (!container) return;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `pixel-toast ${type}`;

    // Icons for different types
    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
        warning: '⚠'
    };

    const titles = {
        success: '成功',
        error: '错误',
        info: '提示',
        warning: '警告'
    };

    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-title">${titles[type] || titles.info}</span>
            <button class="toast-close">✕</button>
        </div>
        <div class="toast-message">${message}</div>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    const progress = toast.querySelector('.toast-progress');

    // Animate in
    if (animate) {
        animate(toast, {
            x: [400, 0],
            opacity: [0, 1]
        }, {
            duration: 0.4,
            easing: 'ease-out'
        });

        // Progress bar animation
        animate(progress, {
            scaleX: [1, 0]
        }, {
            duration: duration / 1000,
            easing: 'linear'
        });
    }

    // Auto dismiss
    const dismissToast = () => {
        if (animate) {
            animate(toast, {
                x: [0, 400],
                opacity: [1, 0]
            }, {
                duration: 0.3,
                easing: 'ease-in'
            }).finished.then(() => {
                toast.remove();
            });
        } else {
            toast.remove();
        }
    };

    const timeoutId = setTimeout(dismissToast, duration);

    // Close button
    closeBtn.addEventListener('click', () => {
        clearTimeout(timeoutId);
        dismissToast();
    });

    return toast;
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════

async function loadLeaderboard() {
    const loadingEl = qs('leaderboardLoading');
    const errorEl = qs('leaderboardError');
    const tableEl = qs('leaderboardTable');
    const bodyEl = qs('leaderboardBody');

    // Show loading state
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (tableEl) tableEl.classList.add('hidden');

    try {
        const headers = CSRF === 'disabled' ? {} : { 'x-csrf-token': CSRF };
        const data = await fetch('/api/account/leaderboard', { headers }).then(r => {
            if (!r.ok) throw new Error('leaderboard failed');
            return r.json();
        });

        // Update stats
        const totalUsersEl = qs('totalUsers');
        const myRankEl = qs('myRank');
        const myPointsEl = qs('myPoints');

        if (totalUsersEl) totalUsersEl.textContent = data.total;
        if (myRankEl) myRankEl.textContent = data.myRank ? `#${data.myRank}` : '-';
        if (myPointsEl) myPointsEl.textContent = data.myPoints;

        // Render leaderboard table
        if (bodyEl) {
            bodyEl.innerHTML = '';
            data.leaderboard.forEach((entry, index) => {
                const row = document.createElement('div');
                row.className = 'table-row';

                // Highlight current user
                if (userStatus && (entry.name === userStatus.name || entry.handle === (userStatus.handle || ''))) {
                    row.classList.add('current-user');
                }

                // Uniform rank display; add badges for top 3
                const rankText = `#${index + 1}`;
                const badge = index === 0 ? '屌！' : index === 1 ? '牛逼！' : index === 2 ? '帅！' : '';

                row.innerHTML = `
                    <div class="table-cell rank-cell">${rankText}</div>
                    <div class="table-cell name-cell">${entry.name}${badge ? ` <span class="rank-badge rank-badge-${index + 1}">${badge}</span>` : ''}</div>
                    <div class="table-cell points-cell">${entry.points}</div>
                `;

                bodyEl.appendChild(row);
            });
        }

        // Hide loading, show table
        if (loadingEl) loadingEl.classList.add('hidden');
        if (tableEl) tableEl.classList.remove('hidden');

    } catch (e) {
        console.error('Failed to load leaderboard:', e);
        if (loadingEl) loadingEl.classList.add('hidden');
        if (errorEl) errorEl.classList.remove('hidden');
    }
}

// removed mock leaderboard

// ═══════════════════════════════════════════════════════════════
// REDEEM CODE FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════

async function handleRedeem() {
    const codeInput = qs('redeemCode');
    const resultDiv = qs('redeemResult');
    const redeemBtn = qs('redeemBtn');

    if (!codeInput || !resultDiv) return;

    const code = codeInput.value.trim();
    if (!code) {
        resultDiv.textContent = '请输入兑换码';
        resultDiv.className = 'result-message error';
        resultDiv.classList.remove('hidden');
        return;
    }

    try {
        redeemBtn.disabled = true;
        const result = await postJSON('/api/account/redeem', { code });

        if (result.success) {
            resultDiv.textContent = result.message || `成功兑换 ${result.addedPoints} 积分！当前积分：${result.points}`;
            resultDiv.className = 'result-message success';
            resultDiv.classList.remove('hidden');

            // Optimistically update status without extra round-trip
            const updated = { ...(userStatus || {}), points: result.points };
            applyStatus(updated);

            // Clear input
            codeInput.value = '';

            // Show success toast
            showToast('success', '兑换成功', result.message);
        } else {
            resultDiv.textContent = result.error || '兑换失败';
            resultDiv.className = 'result-message error';
            resultDiv.classList.remove('hidden');
        }
    } catch (e) {
        const errorMsg = e.error || e.message || '兑换失败，请稍后重试';
        resultDiv.textContent = errorMsg;
        resultDiv.className = 'result-message error';
        resultDiv.classList.remove('hidden');
    } finally {
        redeemBtn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// PASSWORD CHANGE HANDLERS
// ═══════════════════════════════════════════════════════════════

function showChangePasswordDialog() {
    const dialog = qs('changePasswordDialog');
    if (dialog) {
        // Clear previous values
        const currentPassword = qs('currentPassword');
        const newPassword = qs('newPassword');
        const confirmNewPassword = qs('confirmNewPassword');
        const passwordError = qs('passwordError');

        if (currentPassword) currentPassword.value = '';
        if (newPassword) newPassword.value = '';
        if (confirmNewPassword) confirmNewPassword.value = '';
        if (passwordError) {
            passwordError.textContent = '';
            passwordError.classList.add('hidden');
        }

        dialog.classList.remove('hidden');
    }
}

function hideChangePasswordDialog() {
    const dialog = qs('changePasswordDialog');
    if (dialog) {
        dialog.classList.add('hidden');
    }
}

function showPasswordError(msg) {
    const el = qs('passwordError');
    if (!el) return;
    el.textContent = msg || '';
    if (msg) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

async function handleChangePassword() {
    const currentPassword = qs('currentPassword')?.value || '';
    const newPassword = qs('newPassword')?.value || '';
    const confirmNewPassword = qs('confirmNewPassword')?.value || '';

    // 验证输入
    if (!currentPassword) {
        return showPasswordError('请输入当前密码');
    }

    if (!newPassword) {
        return showPasswordError('请输入新密码');
    }

    if (newPassword.length < 6) {
        return showPasswordError('新密码至少需要 6 位字符');
    }

    if (newPassword.length > 128) {
        return showPasswordError('新密码最多 128 位字符');
    }

    if (newPassword !== confirmNewPassword) {
        return showPasswordError('两次输入的新密码不一致');
    }

    if (currentPassword === newPassword) {
        return showPasswordError('新密码不能与当前密码相同');
    }

    try {
        showPasswordError('');
        const confirmBtn = qs('passwordConfirm');
        if (confirmBtn) confirmBtn.disabled = true;

        const result = await postJSON('/api/account/change-password', {
            currentPassword,
            newPassword,
        });

        // 成功后关闭对话框并显示提示
        hideChangePasswordDialog();
        showToast(result.message || '密码修改成功', 'success', 3000);

    } catch (e) {
        showPasswordError(e.error || e.message || '修改密码失败，请稍后重试');
    } finally {
        const confirmBtn = qs('passwordConfirm');
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function setupEventHandlers() {
    // Alert close button
    const alertClose = qs('alertClose');
    if (alertClose) {
        alertClose.addEventListener('click', () => {
            const alertBox = qs('alert');
            if (alertBox) {
                alertBox.classList.add('hidden');
            }
        });
    }

    // Menu toggle
    const menuToggle = qs('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleSidebar);
    }

    // Close sidebar button
    const closeSidebarBtn = qs('closeSidebar');
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', closeSidebar);
    }

    // Sidebar overlay
    const sidebarOverlay = qs('sidebarOverlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const pageName = item.dataset.page;
            if (pageName) {
                navigateToPage(pageName);
            }
        });
    });

    // Navigation buttons (e.g., "前往签到")
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
            const pageName = btn.dataset.nav;
            if (pageName) {
                navigateToPage(pageName);
            }
        });
    });

    // Check-in button
    const checkinBtn = qs('checkinBtn');
    if (checkinBtn) {
        checkinBtn.addEventListener('click', async () => {
            try {
                const result = await postJSON('/api/account/checkin');
                // Optimistically update local status to avoid extra round-trip
                const updated = {
                    ...(userStatus || {}),
                    points: result.points,
                    canCheckInToday: false,
                    nextCheckInAt: result.nextCheckInAt,
                };
                applyStatus(updated);

                // Animate points counter
                const pointsEl = qs('pointsCheckin');
                if (pointsEl && window.Motion && window.Motion.animate) {
                    animateCounter('#pointsCheckin', result.points);
                }

                // Button text will be automatically updated to "已签到" by applyStatus
            } catch (e) {
                // Silently fail, UI will refresh on next tick
            }
        });
    }

    // Access control buttons
    const accessOnBtn = qs('accessOnBtn');
    const accessOffBtn = qs('accessOffBtn');

    // Handler for turning access ON
    if (accessOnBtn) {
        accessOnBtn.addEventListener('click', async () => {
            // Immediately update UI to show loading state
            const accessLabel = qs('accessLabel');
            const dailyCost = qs('dailyCost');
            const accessStatusText = qs('accessStatusText');

            if (accessLabel) {
                accessLabel.textContent = '切换中...';
            }

            // Disable buttons during request
            accessOnBtn.disabled = true;
            accessOffBtn.disabled = true;

            try {
                await postJSON('/api/account/toggle', { accessOn: true });
                const s = await getStatus();
                applyStatus(s);

                // Show success toast
                showToast('已开启访问，扣除 1 积分', 'success', 3000);

                // Animate the status change
                if (accessLabel && window.Motion && window.Motion.animate) {
                    animate(accessLabel, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }

                if (dailyCost && window.Motion && window.Motion.animate) {
                    animate(dailyCost, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }

                if (accessStatusText && window.Motion && window.Motion.animate) {
                    animate(accessStatusText, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }
            } catch (e) {
                // Restore original state on error
                if (accessLabel) {
                    accessLabel.textContent = '已关闭';
                }
                if (dailyCost) {
                    dailyCost.textContent = '不消耗';
                }
                if (accessStatusText) {
                    accessStatusText.textContent = '关闭';
                }

                const alertBox = qs('alert');
                const alertText = qs('alertText');
                if (alertBox && alertText) {
                    alertText.textContent = `开启失败：${e.message}`;
                    alertBox.classList.remove('hidden');
                }

                // Re-enable buttons
                if (userStatus) {
                    accessOnBtn.disabled = userStatus.accessOn;
                    accessOffBtn.disabled = !userStatus.accessOn;
                }
            }
        });
    }

    // Handler for turning access OFF
    if (accessOffBtn) {
        accessOffBtn.addEventListener('click', async () => {
            // Show confirmation dialog
            const confirmed = await showConfirmDialog(
                '确认关闭访问？',
                '关闭后，再次开启将会一次性扣除 1 积分。',
                '确认关闭',
                '取消'
            );

            if (!confirmed) {
                return;
            }

            // Immediately update UI to show loading state
            const accessLabel = qs('accessLabel');
            const dailyCost = qs('dailyCost');
            const accessStatusText = qs('accessStatusText');

            if (accessLabel) {
                accessLabel.textContent = '切换中...';
            }

            // Disable buttons during request
            accessOnBtn.disabled = true;
            accessOffBtn.disabled = true;

            try {
                await postJSON('/api/account/toggle', { accessOn: false });
                const s = await getStatus();
                applyStatus(s);

                // Animate the status change
                if (accessLabel && window.Motion && window.Motion.animate) {
                    animate(accessLabel, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }

                if (dailyCost && window.Motion && window.Motion.animate) {
                    animate(dailyCost, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }

                if (accessStatusText && window.Motion && window.Motion.animate) {
                    animate(accessStatusText, {
                        scale: [1, 1.1, 1]
                    }, {
                        duration: 0.3
                    });
                }
            } catch (e) {
                // Restore original state on error
                if (accessLabel) {
                    accessLabel.textContent = '已开启';
                }
                if (dailyCost) {
                    dailyCost.textContent = '1 积分/天';
                }
                if (accessStatusText) {
                    accessStatusText.textContent = '开启';
                }

                const alertBox = qs('alert');
                const alertText = qs('alertText');
                if (alertBox && alertText) {
                    alertText.textContent = `关闭失败：${e.message}`;
                    alertBox.classList.remove('hidden');
                }

                // Re-enable buttons
                if (userStatus) {
                    accessOnBtn.disabled = userStatus.accessOn;
                    accessOffBtn.disabled = !userStatus.accessOn;
                }
            }
        });
    }

    // Redeem button
    const redeemBtn = qs('redeemBtn');
    if (redeemBtn) {
        redeemBtn.addEventListener('click', handleRedeem);
    }

    // Redeem input - Enter key
    const redeemInput = qs('redeemCode');
    if (redeemInput) {
        redeemInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleRedeem();
            }
        });
    }

    // Logout button
    const logoutBtn = qs('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await postJSON('/api/users/logout');
            } catch {}
            const url = new URL('/oauth.html', location.origin);
            url.searchParams.set('noauto', 'true');
            location.href = url.toString();
        });
    }

    // Change password button
    const changePasswordBtn = qs('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', showChangePasswordDialog);
    }

    // Change password dialog handlers
    const passwordConfirm = qs('passwordConfirm');
    const passwordCancel = qs('passwordCancel');

    if (passwordConfirm) {
        passwordConfirm.addEventListener('click', handleChangePassword);
    }

    if (passwordCancel) {
        passwordCancel.addEventListener('click', hideChangePasswordDialog);
    }

    // Periodic refresh
    setInterval(async () => {
        try {
            const s = await getStatus();
            applyStatus(s);
        } catch {}
    }, 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════
// MOTION ONE ANIMATIONS
// ═══════════════════════════════════════════════════════════════

const { animate, stagger, timeline } = window.Motion || {};

class PixelParticleSystem {
    constructor(containerId, particleCount = 25) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.particles = [];
        this.particleCount = particleCount;
        this.init();
    }

    createParticle() {
        const particle = document.createElement('div');
        const size = Math.random() * 3 + 1;
        const startX = Math.random() * window.innerWidth;
        const startY = Math.random() * window.innerHeight;
        const duration = Math.random() * 10 + 15;
        const baseOpacity = Math.random() * 0.3 + 0.2;

        particle.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            background: #000;
            left: ${startX}px;
            top: ${startY}px;
            opacity: ${baseOpacity};
            pointer-events: none;
            border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            will-change: transform, opacity;
        `;

        this.container.appendChild(particle);
        this.particles.push(particle);

        if (animate) {
            const moveY = Math.random() * 200 - 100;
            const moveX = Math.random() * 150 - 75;
            const opacityMax = Math.min(baseOpacity + 0.3, 0.6);

            animate(
                particle,
                {
                    y: [0, moveY],
                    x: [0, moveX],
                    opacity: [baseOpacity, opacityMax],
                    rotate: [0, Math.random() * 360],
                    scale: [1, 1.3]
                },
                {
                    duration,
                    easing: 'ease-in-out',
                    repeat: Infinity,
                    direction: 'alternate'
                }
            );
        }
    }

    init() {
        for (let i = 0; i < this.particleCount; i++) {
            setTimeout(() => this.createParticle(), i * 50);
        }
    }
}

function animateCounter(selector, targetValue) {
    const counterElement = document.querySelector(selector);
    if (!counterElement) return;

    const chars = '█▓▒░0123456789';
    const target = String(targetValue);
    let frame = 0;
    const maxFrames = 20;

    const interval = setInterval(() => {
        if (frame >= maxFrames) {
            counterElement.textContent = target;
            clearInterval(interval);
            return;
        }

        let scrambled = '';
        for (let i = 0; i < target.length; i++) {
            scrambled += chars[Math.floor(Math.random() * chars.length)];
        }
        counterElement.textContent = scrambled;
        frame++;
    }, 50);
}

function addButtonEffects() {
    const buttons = document.querySelectorAll('.pixel-button');

    buttons.forEach(button => {
        button.addEventListener('mouseenter', () => {
            const icon = button.querySelector('.button-icon');
            if (icon && animate) {
                animate(icon, { x: [0, 5, 0] }, { duration: 0.3 });
            }
        });

        button.addEventListener('click', (e) => {
            if (button.disabled) return;

            const ripple = document.createElement('div');
            const rect = button.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            ripple.style.cssText = `
                position: absolute;
                width: 10px;
                height: 10px;
                background: #000;
                left: ${x}px;
                top: ${y}px;
                opacity: 0.5;
                pointer-events: none;
            `;
            button.appendChild(ripple);

            if (animate) {
                animate(
                    ripple,
                    {
                        width: [10, 100],
                        height: [10, 100],
                        opacity: [0.5, 0],
                        x: [-5, -50],
                        y: [-5, -50]
                    },
                    { duration: 0.6 }
                ).finished.then(() => ripple.remove());
            }
        });
    });
}

function initializeAnimations() {
    if (!animate) {
        console.warn('Motion One not available, animations disabled');
        document.querySelectorAll('.sidebar, .top-bar, .page, .pixel-footer').forEach(el => {
            el.style.opacity = '1';
        });
        return;
    }

    try {
        const sequence = [
            // Grid fades in
            ['.pixel-grid', {
                opacity: [0, 0.15]
            }, { duration: 0.6, easing: 'ease-out' }],

            // Particles appear
            ['#particles', {
                opacity: [0, 1]
            }, { duration: 0.5, at: 0.15 }],

            // Sidebar slides in
            ['.sidebar', {
                opacity: [0, 1]
            }, { duration: 0.5, at: 0.25 }],

            // Top bar slides down
            ['.top-bar', {
                opacity: [0, 1],
                y: [-20, 0]
            }, { duration: 0.6, easing: 'ease-out', at: 0.3 }],

            // Active page fades in
            ['.page.active', {
                opacity: [0, 1]
            }, { duration: 0.5, at: 0.5 }],

            // Footer fades in
            ['.pixel-footer', {
                opacity: [0, 1]
            }, { duration: 0.4, at: 0.7 }]
        ];

        timeline(sequence);

        // Continuous scanline animations
        const scanlines = document.querySelectorAll('.scanline');
        scanlines.forEach(scanline => {
            animate(scanline, {
                y: [0, 50]
            }, {
                duration: 3,
                repeat: Infinity,
                easing: 'linear'
            });
        });

    } catch (error) {
        console.error('Animation error:', error);
        document.querySelectorAll('.sidebar, .top-bar, .page, .pixel-footer').forEach(el => {
            el.style.opacity = '1';
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
    await fetchCsrf();

    try {
        const s = await getStatus();
        applyStatus(s);
    } catch (e) {
        // Not logged in, redirect
        location.href = '/oauth.html';
        return;
    }

    // Setup event handlers
    await setupEventHandlers();

    // Initialize animations
    if (window.Motion) {
        new PixelParticleSystem('particles', 25);
        initializeAnimations();

        setTimeout(() => {
            addButtonEffects();
        }, 800);

        console.log(`
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  CHLOE HOME PAGE v2.0           ┃
        ┃  ▸ Multi-page Navigation        ┃
        ┃  ▸ Sidebar Menu System          ┃
        ┃  ▸ Powered by Motion One        ┃
        ┃  ▸ Made with shadcn/ui style    ┃
        ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        `);
    } else {
        // Fallback without animations
        document.querySelectorAll('.sidebar, .top-bar, .page, .pixel-footer').forEach(el => {
            el.style.opacity = '1';
        });
    }
}

// Start the app
init();
