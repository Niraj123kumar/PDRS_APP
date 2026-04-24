const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const emailService = require('../services/email');
const totpService = require('../services/totpService');
const tokenService = require('../services/tokenService');
const auditService = require('../services/auditService');
const passport = require('../services/googleAuth');
const cacheService = require('../services/cacheService');
const ipDetection = require('../services/ipDetection');
const { encryptField } = require('../services/encryption');
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);

function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    if (!local || !domain) return email;
    const keep = Math.min(2, local.length);
    return `${local.slice(0, keep)}***@${domain}`;
}

function generateOTPCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function createTokenForUser(user) {
    const userPayload = { id: user.id, name: user.name, email: user.email, role: user.role };
    const token = tokenService.generateAccessToken(userPayload);
    return { token, user: userPayload };
}

function parseDevice(req) {
    const ua = req.headers['user-agent'] || '';
    const browser = ua.includes('Chrome') ? 'Chrome'
        : ua.includes('Firefox') ? 'Firefox'
            : ua.includes('Safari') ? 'Safari'
                : 'Unknown';
    const deviceType = /mobile|iphone|android/i.test(ua) ? 'mobile' : 'desktop';
    return {
        device_name: `${browser} ${deviceType}`,
        device_type: deviceType,
        browser,
        ip_address: req.ip
    };
}

function recordDevice(userId, req) {
    const { device_name, device_type, browser, ip_address } = parseDevice(req);
    const info = db.prepare(`
        INSERT INTO user_devices (user_id, device_name, device_type, browser, ip_address, last_active)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(userId, device_name, device_type, browser, ip_address);
    return info.lastInsertRowid;
}

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.ip;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
    const { name, email, password, role } = req.body;

    // Strict role validation
    if (!['student', 'faculty'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be student or faculty.' });
    }

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    // Password validation: minimum 8 chars, 1 number, 1 uppercase
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d\W]{8,}$/.test(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter and one number' });
    }

    try {
        const password_hash = bcrypt.hashSync(password, 12);
        const info = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, encrypted_email, encrypted_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, email, password_hash, role, encryptField(email), encryptField(name));
        
        const user = { id: info.lastInsertRowid, name, email: maskEmail(email), role };
        const token = tokenService.generateAccessToken(user);
        emailService.sendWelcome(email, name).catch(() => {});
        auditService.logAction(user.id, email, 'REGISTER', 'user', user.id, req, { role });

        // Invalidate faculty cache if student registered
        if (role === 'student') {
            cacheService.invalidatePattern('faculty:stats:*');
        }

        res.json({ token, user });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const ip = getRequestIp(req);

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            db.prepare('INSERT INTO login_attempts (user_id, email, ip, success) VALUES (?, ?, ?, 0)').run(user?.id || null, email, ip);
            return res.status(401).json({ error: 'Wrong credentials' });
        }
        if (Number(user.is_suspended) === 1) {
            return res.status(403).json({ error: 'Account suspended', reason: user.suspension_reason || 'No reason provided' });
        }

        db.prepare('INSERT INTO login_attempts (user_id, email, ip, success) VALUES (?, ?, ?, 1)').run(user.id, email, ip);

        const totp = db.prepare('SELECT enabled FROM totp_secrets WHERE user_id = ?').get(user.id);
        const maskedEmail = maskEmail(user.email);
        if (totp && Number(totp.enabled) === 1) {
            return res.json({ requiresTOTP: true, email: maskedEmail, maskedEmail, forcePasswordChange: Number(user.force_password_change) === 1 });
        }

        const otp = generateOTPCode();
        db.prepare('DELETE FROM otp_codes WHERE email = ?').run(user.email);
        db.prepare("INSERT INTO otp_codes (email, code, expires_at, used) VALUES (?, ?, datetime('now', '+10 minutes'), 0)")
            .run(user.email, otp);
        emailService.sendOTP(user.email, otp).catch(() => {});
        res.json({ requiresOTP: true, maskedEmail, email: user.email, forcePasswordChange: Number(user.force_password_change) === 1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(401).json({ error: 'Invalid code' });
        const row = db.prepare(`
            SELECT * FROM otp_codes
            WHERE email = ? AND code = ? AND used = 0 AND datetime(expires_at) > datetime('now')
            ORDER BY created_at DESC LIMIT 1
        `).get(email, String(otp));
        if (!row) return res.status(401).json({ error: 'Invalid code' });

        db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
        const deviceId = recordDevice(user.id, req);
        const accessToken = tokenService.generateAccessToken(user);
        const refreshToken = tokenService.generateRefreshToken(user);
        tokenService.saveRefreshToken(user.id, refreshToken);
        res.cookie('pdrs_refresh', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        auditService.logAction(user.id, user.email, 'LOGIN', 'auth', null, req, { method: 'otp' });
        ipDetection.checkSuspiciousLogin(user.id, getRequestIp(req), req).catch(() => {});
        res.json({
            token: accessToken,
            user: { id: user.id, name: user.name, email: maskEmail(user.email), role: user.role },
            deviceId,
            forcePasswordChange: Number(user.force_password_change) === 1
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/verify-totp
router.post('/verify-totp', (req, res) => {
    const { email, token } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(401).json({ error: 'Invalid authenticator code' });
        const row = db.prepare('SELECT secret, enabled FROM totp_secrets WHERE user_id = ?').get(user.id);
        if (!row || Number(row.enabled) !== 1) return res.status(401).json({ error: 'TOTP not enabled' });
        const ok = totpService.verifyToken(row.secret, String(token));
        if (!ok) return res.status(401).json({ error: 'Invalid authenticator code' });

        const deviceId = recordDevice(user.id, req);
        const accessToken = tokenService.generateAccessToken(user);
        const refreshToken = tokenService.generateRefreshToken(user);
        tokenService.saveRefreshToken(user.id, refreshToken);
        res.cookie('pdrs_refresh', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        auditService.logAction(user.id, user.email, 'LOGIN', 'auth', null, req, { method: 'totp' });
        ipDetection.checkSuspiciousLogin(user.id, getRequestIp(req), req).catch(() => {});
        res.json({
            token: accessToken,
            user: { id: user.id, name: user.name, email: maskEmail(user.email), role: user.role },
            deviceId,
            forcePasswordChange: Number(user.force_password_change) === 1
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/resend-otp
router.post('/resend-otp', (req, res) => {
    const { email } = req.body;
    try {
        const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const last = db.prepare(`
            SELECT created_at FROM otp_codes WHERE email = ?
            ORDER BY created_at DESC LIMIT 1
        `).get(email);
        if (last) {
            const remaining = db.prepare(`
                SELECT CAST((strftime('%s', datetime(created_at, '+60 seconds')) - strftime('%s', 'now')) AS INTEGER) AS seconds
                FROM otp_codes WHERE email = ?
                ORDER BY created_at DESC LIMIT 1
            `).get(email).seconds;
            if (remaining > 0) {
                return res.status(429).json({ error: 'Please wait before requesting another OTP', secondsRemaining: remaining });
            }
        }

        const otp = generateOTPCode();
        db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email);
        db.prepare("INSERT INTO otp_codes (email, code, expires_at, used) VALUES (?, ?, datetime('now', '+10 minutes'), 0)")
            .run(email, otp);
        emailService.sendOTP(email, otp).catch(() => {});
        res.json({ success: true, maskedEmail: maskEmail(email) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/setup-totp (auth required)
router.post('/setup-totp', verifyToken, async (req, res) => {
    try {
        const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const generated = await totpService.generateSecret(user.email);
        db.prepare(`
            INSERT INTO totp_secrets (user_id, secret, enabled)
            VALUES (?, ?, 0)
            ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0
        `).run(req.user.id, generated.secret);
        res.json({ qrCodeDataUrl: generated.qrCodeDataUrl, manualEntryKey: generated.secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/confirm-totp (auth required)
router.post('/confirm-totp', verifyToken, (req, res) => {
    const { token } = req.body;
    try {
        const row = db.prepare('SELECT secret FROM totp_secrets WHERE user_id = ?').get(req.user.id);
        if (!row) return res.status(400).json({ error: 'TOTP not setup' });
        const ok = totpService.verifyToken(row.secret, String(token));
        if (!ok) return res.status(401).json({ error: 'Invalid authenticator code' });
        totpService.enableTOTP(req.user.id, row.secret);
        auditService.logAction(req.user.id, req.user.email, 'ENABLE_TOTP', 'auth', req.user.id, req, {});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/auth/totp (auth required)
router.delete('/totp', verifyToken, (req, res) => {
    try {
        totpService.disableTOTP(req.user.id);
        auditService.logAction(req.user.id, req.user.email, 'DISABLE_TOTP', 'auth', req.user.id, req, {});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/totp-status (auth required)
router.get('/totp-status', verifyToken, (req, res) => {
    try {
        const row = db.prepare('SELECT enabled FROM totp_secrets WHERE user_id = ?').get(req.user.id);
        res.json({ enabled: !!(row && Number(row.enabled) === 1) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/devices (auth required)
router.get('/devices', verifyToken, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT id, device_name, browser, ip_address AS ip, last_active
            FROM user_devices
            WHERE user_id = ?
            ORDER BY datetime(last_active) DESC
        `).all(req.user.id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/auth/devices/:id (auth required)
router.delete('/devices/:id', verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const result = db.prepare('DELETE FROM user_devices WHERE id = ? AND user_id = ?').run(id, req.user.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
        const currentDeviceId = req.headers['x-device-id'];
        res.json({ success: true, invalidateToken: currentDeviceId && String(currentDeviceId) === String(id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/auth/account (auth required)
router.delete('/account', verifyToken, (req, res) => {
    const { password, confirmation } = req.body;
    if (confirmation !== 'DELETE MY ACCOUNT') {
        return res.status(400).json({ error: 'Confirmation text does not match' });
    }
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!bcrypt.compareSync(password || '', user.password_hash)) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const deleteAll = db.transaction(() => {
            db.prepare('DELETE FROM goals WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM badges WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM flashcards WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM question_notes WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM user_goals WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM dimension_history WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM coaching_sessions WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM totp_secrets WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM user_devices WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM notifications WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)').run(user.id);
            db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM projects WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM panel_attendance WHERE user_id = ?').run(user.id);
            db.prepare('DELETE FROM peer_sessions WHERE student_a_id = ? OR student_b_id = ?').run(user.id, user.id);
            db.prepare('DELETE FROM flagged_students WHERE student_id = ?').run(user.id);
            db.prepare('DELETE FROM otp_codes WHERE email = ?').run(user.email);
            db.prepare('DELETE FROM login_attempts WHERE email = ?').run(user.email);
            db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
        });
        deleteAll();
        res.clearCookie('pdrs_refresh');
        auditService.logAction(user.id, user.email, 'DELETE_ACCOUNT', 'user', user.id, req, {});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
    const refresh = req.cookies?.pdrs_refresh;
    if (!refresh) return res.status(401).json({ error: 'Refresh token missing' });
    try {
        const decoded = tokenService.verifyRefreshToken(refresh);
        const tokenHash = tokenService.hashToken(refresh);
        const row = db.prepare(`
            SELECT * FROM refresh_tokens
            WHERE user_id = ? AND token_hash = ? AND revoked = 0 AND datetime(expires_at) > datetime('now')
            ORDER BY created_at DESC LIMIT 1
        `).get(decoded.id, tokenHash);
        if (!row) return res.status(401).json({ error: 'Invalid refresh token' });

        const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const token = tokenService.generateAccessToken(user);
        res.json({ token });
    } catch (err) {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// POST /api/auth/logout
router.post('/logout', verifyToken, (req, res) => {
    const refresh = req.cookies?.pdrs_refresh;
    if (refresh) {
        const hash = tokenService.hashToken(refresh);
        tokenService.revokeRefreshToken(hash);
    }
    res.clearCookie('pdrs_refresh');
    auditService.logAction(req.user.id, req.user.email, 'LOGOUT', 'auth', null, req, {});
    res.json({ success: true });
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const newHash = bcrypt.hashSync(newPassword, 12);
        db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?').run(newHash, user.id);
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user.id);
        res.clearCookie('pdrs_refresh');
        auditService.logAction(user.id, user.email, 'CHANGE_PASSWORD', 'auth', null, req, {});
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/google
router.get('/google', (req, res, next) => {
    if (!googleEnabled) {
        return res.redirect('/login.html?error=google-failed');
    }
    return passport.authenticate('google', {
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar'],
        accessType: 'offline',
        prompt: 'consent'
    })(req, res, next);
});

// GET /api/auth/google/callback
router.get('/google/callback', (req, res, next) => {
    if (!googleEnabled) {
        return res.redirect('/login.html?error=google-failed');
    }
    passport.authenticate('google', { session: true }, (err, user) => {
        if (err || !user) {
            return res.redirect('/login.html?error=google-failed');
        }

        try {
            const accessToken = tokenService.generateAccessToken(user);
            const refreshToken = tokenService.generateRefreshToken(user);
            tokenService.saveRefreshToken(user.id, refreshToken);
            res.cookie('pdrs_refresh', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'Strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            if (user.googleAccessToken) {
                const encryptedToken = encryptField(user.googleAccessToken);
                db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(encryptedToken, user.id);
            }
            auditService.logAction(user.id, user.email, 'LOGIN', 'auth', null, req, { method: 'google' });
            ipDetection.checkSuspiciousLogin(user.id, getRequestIp(req), req).catch(() => {});
            return res.redirect(`/student.html#token=${accessToken}`);
        } catch (callbackErr) {
            return next(callbackErr);
        }
    })(req, res, next);
});

// GET /api/auth/audit
router.get('/audit', verifyToken, (req, res) => {
    const { action, from, to, limit } = req.query;
    try {
        let rows;
        if (req.user.role === 'admin') {
            rows = auditService.getAuditLogAdmin({ action, from, to, limit: Number(limit) || 200 });
        } else {
            rows = auditService.getAuditLog(req.user.id, Number(limit) || 100);
            if (action) rows = rows.filter(r => r.action === action);
            if (from) rows = rows.filter(r => new Date(r.created_at) >= new Date(from));
            if (to) rows = rows.filter(r => new Date(r.created_at) <= new Date(to));
        }
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/me
router.get('/me', verifyToken, (req, res) => {
    try {
        const user = db.prepare('SELECT id, name, email, role, avatar_url, github_username, force_password_change, slack_webhook_url, whatsapp_number, zoom_user_id FROM users WHERE id = ?').get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.json({
            ...user,
            email: maskEmail(user.email),
            force_password_change: Number(user.force_password_change) === 1
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
