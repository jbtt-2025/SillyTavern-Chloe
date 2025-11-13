async function getCsrfToken() {
    try {
        const res = await fetch('/csrf-token');
        const data = await res.json();
        return data.token || '';
    } catch {
        return '';
    }
}

function $(sel) { return document.querySelector(sel); }

function showError(msg) {
    const el = $('#loginError');
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.classList.remove('hidden'); else el.classList.add('hidden');
}

// 验证用户名
function validateHandle(handle) {
    const trimmed = handle.trim();

    if (!trimmed) {
        return { valid: false, message: '请输入用户名' };
    }

    if (trimmed.length < 3) {
        return { valid: false, message: '用户名至少需要 3 个字符' };
    }

    return { valid: true, message: '' };
}

// 验证密码
function validatePassword(password) {
    if (!password) {
        return { valid: false, message: '请输入密码' };
    }

    if (password.length < 6) {
        return { valid: false, message: '密码至少需要 6 位字符' };
    }

    return { valid: true, message: '' };
}

async function submitLogin() {
    const handle = String($('#loginHandle')?.value || '').trim();
    const password = String($('#loginPassword')?.value || '');

    // 验证用户名
    const handleValidation = validateHandle(handle);
    if (!handleValidation.valid) {
        return showError(handleValidation.message);
    }

    // 验证密码
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return showError(passwordValidation.message);
    }

    try {
        showError('');
        const btn = $('#loginSubmit');
        if (btn) btn.disabled = true;

        const token = await getCsrfToken();
        const res = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token && token !== 'disabled' ? { 'X-CSRF-Token': token } : {}),
            },
            body: JSON.stringify({ handle, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '登录失败，请检查用户名和密码');
        }

        const data = await res.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${data.handle}!`);
            // 登录成功，跳转到用户主界面
            location.href = '/';
        }
    } catch (e) {
        showError(e.message || '登录失败，请稍后重试');
        const btn = $('#loginSubmit');
        if (btn) btn.disabled = false;
    }
}

function init() {
    const btn = $('#loginSubmit');
    if (btn) btn.addEventListener('click', submitLogin);

    // 监听回车键
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitLogin();
    });

    // Initialize animations
    setTimeout(() => {
        initializeAnimations();
    }, 100);
}

// ═══════════════════════════════════════════════════════════════
// PIXEL PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════════

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

        if (window.Motion && window.Motion.animate) {
            const { animate } = window.Motion;
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
            this.createParticle();
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// ANIMATIONS
// ═══════════════════════════════════════════════════════════════

function initializeAnimations() {
    console.log('Initializing animations...', { hasMotion: !!(window.Motion && window.Motion.animate) });

    // Initialize particle system
    try {
        new PixelParticleSystem('particles', 25);
    } catch (e) {
        console.error('Particle system error:', e);
    }

    // If Motion library is available, use it
    if (window.Motion && window.Motion.animate) {
        const { animate, stagger } = window.Motion;

        console.log('Using Motion animations');

        // Animate pixel grid
        animate('.pixel-grid',
            { opacity: [0, 0.3] },
            { duration: 1, delay: 0.2 }
        );

        // Animate particles container
        animate('#particles',
            { opacity: [0, 1] },
            { duration: 1.5, delay: 0.3 }
        );

        // Animate back button
        animate('.back-button-container',
            { opacity: [0, 1], x: [-20, 0] },
            { duration: 0.5, delay: 0.2 }
        );

        // Animate logo
        animate('.logo-container',
            { opacity: [0, 1], scale: [0.9, 1] },
            { duration: 0.6, easing: 'ease-out', delay: 0.3 }
        );

        // Animate title
        animate('.pixel-title',
            { opacity: [0, 1], y: [-10, 0] },
            { duration: 0.5, delay: 0.4 }
        );

        // Animate subtitle
        animate('.subtitle-container',
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.5, delay: 0.5 }
        );

        // Animate description
        animate('.pixel-description',
            { opacity: [0, 1] },
            { duration: 0.4, delay: 0.6 }
        );

        // Animate form fields with stagger
        animate('.form-field',
            { opacity: [0, 1], x: [-20, 0] },
            { duration: 0.4, delay: stagger(0.1, { start: 0.7 }) }
        );

        // Animate submit button
        animate('#loginSubmit',
            { opacity: [0, 1], scale: [0.95, 1] },
            { duration: 0.4, delay: 1.0 }
        );

        // Animate footer link
        animate('.login-footer',
            { opacity: [0, 1] },
            { duration: 0.4, delay: 1.1 }
        );

        // Animate footer
        animate('.pixel-footer',
            { opacity: [0, 1] },
            { duration: 0.5, delay: 1.2 }
        );

        // Animate corner decorations
        animate('.corner-decoration',
            { opacity: [0, 1] },
            { duration: 0.5, delay: stagger(0.1, { start: 0.5 }) }
        );

        // Animate glitch container
        animate('.glitch-container',
            { opacity: [0, 1] },
            { duration: 0.6, easing: 'ease-out' }
        );
    } else {
        // Fallback: just show everything immediately
        console.log('Using fallback - showing all elements immediately');
        const selectors = [
            '.glitch-container',
            '.pixel-grid',
            '.back-button-container',
            '.logo-container',
            '.pixel-title',
            '.subtitle-container',
            '.pixel-description',
            '.form-field',
            '#loginSubmit',
            '.login-footer',
            '.pixel-footer',
            '.corner-decoration',
            '#particles',
            '.pixel-card'
        ];

        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            console.log(`Setting opacity for ${selector}:`, elements.length);
            elements.forEach(el => {
                if (el) el.style.opacity = '1';
            });
        });
    }
}

// Emergency fallback - if animations don't run within 2 seconds, show everything
setTimeout(() => {
    const container = document.querySelector('.glitch-container');
    if (container && window.getComputedStyle(container).opacity === '0') {
        console.warn('Emergency fallback: forcing all elements visible');
        document.querySelectorAll('.glitch-container, .pixel-grid, .back-button-container, .logo-container, .pixel-title, .subtitle-container, .pixel-description, .form-field, #loginSubmit, .login-footer, .pixel-footer, .corner-decoration, #particles, .pixel-card').forEach(el => {
            if (el) el.style.opacity = '1';
        });
    }
}, 2000);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
