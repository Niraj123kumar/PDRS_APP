const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { sanitizeUser } = require('../middleware/validators');
const emailService = require('../services/email');
const auditService = require('../services/auditService');
const ipDetection = require('../services/ipDetection');
const backupService = require('../services/backupService');
const cacheService = require('../services/cacheService');
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

router.use(verifyToken, requireAdmin);

// GET /api/admin/users?page=1&limit=20
router.get('/users', (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const rows = db.prepare(`
            SELECT
                u.id, u.name, u.email, u.role, u.created_at, u.is_suspended, u.suspension_reason,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count,
                (SELECT MAX(last_active) FROM user_devices d WHERE d.user_id = u.id) AS last_active
            FROM users u
            ORDER BY datetime(u.created_at) DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset).map(sanitizeUser);
        const total = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
        res.json({
            success: true,
            data: { page, limit, total, users: rows }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/users/:id
router.get('/users/:id', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
        const audit = db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.id);
        return res.json({
            success: true,
            data: {
                user: sanitizeUser(user),
                sessions,
                audit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/admin/users/:id/suspend
router.patch('/users/:id/suspend', async (req, res) => {
    try {
        const reason = String(req.body.reason || '').trim() || 'Policy violation';
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        db.prepare('UPDATE users SET is_suspended = 1, suspension_reason = ? WHERE id = ?').run(reason, user.id);
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user.id);
        emailService.sendSuspensionEmail(user.email, reason).catch(() => {});
        auditService.logAction(req.user.id, req.user.email, 'SUSPEND_USER', 'user', user.id, req, { reason });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/admin/users/:id/unsuspend
router.patch('/users/:id/unsuspend', async (req, res) => {
    try {
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        db.prepare('UPDATE users SET is_suspended = 0, suspension_reason = NULL WHERE id = ?').run(user.id);
        emailService.sendReinstatementEmail(user.email).catch(() => {});
        auditService.logAction(req.user.id, req.user.email, 'UNSUSPEND_USER', 'user', user.id, req, {});
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const tx = db.transaction(() => {
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
            db.prepare('DELETE FROM login_attempts WHERE user_id = ? OR email = ?').run(user.id, user.email);
            db.prepare('DELETE FROM suspicious_logins WHERE user_id = ? OR email = ?').run(user.id, user.email);
            db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
        });
        tx();
        auditService.logAction(req.user.id, req.user.email, 'DELETE_USER', 'user', user.id, req, {});
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/suspicious-logins
router.get('/suspicious-logins', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT sl.*, u.name, u.role
            FROM suspicious_logins sl
            LEFT JOIN users u ON u.id = sl.user_id
            WHERE sl.resolved = 0
            ORDER BY datetime(sl.created_at) DESC
        `).all();
        res.json({
            success: true,
            data: rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/admin/suspicious-logins/:id/resolve
router.patch('/suspicious-logins/:id/resolve', (req, res) => {
    try {
        const ok = ipDetection.resolveAlert(req.params.id);
        if (!ok) return res.status(404).json({ success: false, error: 'Alert not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/stats
router.get('/stats', (req, res) => {
    try {
        const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
        const totalSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
        const totalPanels = db.prepare('SELECT COUNT(*) AS n FROM panel_sessions').get().n;
        const activeToday = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE datetime(created_at) >= datetime('now', '-1 day')").get().n;
        const newThisWeek = db.prepare("SELECT COUNT(*) AS n FROM users WHERE datetime(created_at) >= datetime('now', '-7 day')").get().n;
        const suspendedCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_suspended = 1').get().n;
        const suspiciousOpen = db.prepare('SELECT COUNT(*) AS n FROM suspicious_logins WHERE resolved = 0').get().n;
        res.json({
            success: true,
            data: { totalUsers, totalSessions, totalPanels, activeToday, newThisWeek, suspendedCount, suspiciousOpen }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/export.csv
router.get('/export.csv', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT id, name, email, role, is_suspended, created_at
            FROM users
            ORDER BY datetime(created_at) DESC
        `).all();

        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['id', 'name', 'email', 'role', 'is_suspended', 'created_at'];
        const csvContent = [
            headers.join(','),
            ...rows.map(r => [
                r.id,
                escapeCsv(r.name),
                escapeCsv(r.email),
                r.role,
                r.is_suspended,
                r.created_at
            ].join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="pdrs-export.csv"');
        res.send(csvContent);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/backups
router.get('/backups', (req, res) => {
    try {
        const backups = backupService.listBackups();
        res.json({
            success: true,
            data: backups
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/backups/:filename
router.get('/backups/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        // Basic path traversal prevention
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ success: false, error: 'Invalid filename' });
        }
        const filePath = path.join(__dirname, '..', 'backups', filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }
        res.download(filePath);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/admin/backups/trigger
router.post('/backups/trigger', async (req, res) => {
    try {
        const result = await backupService.backupDatabase();
        auditService.logAction(req.user.id, req.user.email, 'TRIGGER_BACKUP', 'admin', null, req, { filename: result.filename });
        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/admin/metrics
router.get('/metrics', (req, res) => {
    try {
        const dbPath = path.join(__dirname, '..', 'pdrs.db');
        const dbSize = fs.statSync(dbPath).size;
        
        // Calculate requests per minute from audit_log
        const rpm = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE datetime(created_at) >= datetime('now', '-1 minute')").get().count;
        
        // Error rate (mock implementation as we don't track every error in DB yet)
        const totalReqs = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE datetime(created_at) >= datetime('now', '-1 hour')").get().count;
        // In a real app, you'd have an error_log table or integrate with Sentry metrics
        const errorRate = 0.01; // placeholder

        res.json({
            success: true,
            data: {
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                dbSize,
                cacheHitRate: cacheService.getStats(),
                requestsPerMinute: rpm,
                errorRate,
                version: packageJson.version,
                timestamp: Date.now()
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
