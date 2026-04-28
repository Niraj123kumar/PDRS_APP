const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const pushService = require('../services/pushService');
const smsService = require('../services/smsService');

// GET /api/notifications (auth required)
router.get('/', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
        res.json({ success: true, data: notifications });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/notifications/:id/read (auth required)
router.patch('/:id/read', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const notification_id = req.params.id;
    try {
        const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notification_id, user_id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Notification not found' });
        res.json({ success: true, data: { message: 'Notification marked as read' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/notifications/read-all (auth required)
router.patch('/read-all', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user_id);
        res.json({ success: true, data: { message: 'All notifications marked as read' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/notifications/unread-count (auth required)
router.get('/unread-count', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(user_id);
        res.json({ success: true, data: { count: row.count } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/notifications/vapid-key (public)
router.get('/vapid-key', (req, res) => {
    try {
        res.json({ success: true, data: { publicKey: process.env.VAPID_PUBLIC_KEY || '' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/notifications/subscribe-push (auth)
router.post('/subscribe-push', verifyToken, async (req, res) => {
    const { endpoint, p256dh, auth } = req.body;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ success: false, error: 'Invalid subscription payload' });
    try {
        db.prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?)
        `).run(req.user.id, endpoint, p256dh, auth);
        db.prepare('UPDATE users SET push_notifications = 1 WHERE id = ?').run(req.user.id);
        await pushService.sendPush({ endpoint, keys: { p256dh, auth } }, 'PDRS', 'Push notifications enabled for PDRS', '/notifications.html');
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/notifications/unsubscribe-push (auth)
router.delete('/unsubscribe-push', verifyToken, (req, res) => {
    const { endpoint } = req.body;
    try {
        if (endpoint) {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
        } else {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
        }
        db.prepare('UPDATE users SET push_notifications = 0 WHERE id = ?').run(req.user.id);
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/notifications/update-phone (auth)
router.post('/update-phone', verifyToken, async (req, res) => {
    const { phoneNumber } = req.body;
    if (!/^\+[1-9]\d{7,14}$/.test(String(phoneNumber || ''))) {
        return res.status(400).json({ success: false, error: 'Phone number must be E.164 format' });
    }
    try {
        const code = generateCode();
        const key = `phone:${req.user.id}`;
        db.prepare('UPDATE users SET phone_number = ?, phone_verified = 0 WHERE id = ?').run(phoneNumber, req.user.id);
        db.prepare('DELETE FROM otp_codes WHERE email = ?').run(key);
        db.prepare("INSERT INTO otp_codes (email, code, expires_at, used) VALUES (?, ?, datetime('now', '+10 minutes'), 0)")
            .run(key, code);
        await smsService.sendOTPSMS(phoneNumber, code);
        res.json({ success: true, data: { requiresVerification: true } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/notifications/verify-phone (auth)
router.post('/verify-phone', verifyToken, (req, res) => {
    const { code } = req.body;
    const key = `phone:${req.user.id}`;
    try {
        const row = db.prepare(`
            SELECT * FROM otp_codes
            WHERE email = ? AND code = ? AND used = 0 AND datetime(expires_at) > datetime('now')
            ORDER BY datetime(created_at) DESC LIMIT 1
        `).get(key, String(code));
        if (!row) return res.status(401).json({ success: false, error: 'Invalid verification code' });
        db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
        db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(req.user.id);
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/notifications/preferences (auth)
router.patch('/preferences', verifyToken, (req, res) => {
    const {
        smsNotifications,
        pushNotifications,
        emailNotifications,
        weeklyReports,
        defenseReminders,
        inactivityAlerts
    } = req.body;
    try {
        db.prepare(`
            UPDATE users
            SET sms_notifications = COALESCE(?, sms_notifications),
                push_notifications = COALESCE(?, push_notifications),
                email_notifications = COALESCE(?, email_notifications),
                email_weekly_reports = COALESCE(?, email_weekly_reports),
                email_defense_reminders = COALESCE(?, email_defense_reminders),
                email_inactivity_alerts = COALESCE(?, email_inactivity_alerts)
            WHERE id = ?
        `).run(
            smsNotifications === undefined ? null : (smsNotifications ? 1 : 0),
            pushNotifications === undefined ? null : (pushNotifications ? 1 : 0),
            emailNotifications === undefined ? null : (emailNotifications ? 1 : 0),
            weeklyReports === undefined ? null : (weeklyReports ? 1 : 0),
            defenseReminders === undefined ? null : (defenseReminders ? 1 : 0),
            inactivityAlerts === undefined ? null : (inactivityAlerts ? 1 : 0),
            req.user.id
        );
        const prefs = db.prepare(`
            SELECT phone_number, phone_verified, sms_notifications, push_notifications,
                   email_notifications, email_weekly_reports, email_defense_reminders, email_inactivity_alerts
            FROM users WHERE id = ?
        `).get(req.user.id);
        res.json({ success: true, data: { preferences: prefs } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/notifications/preferences (auth)
router.get('/preferences', verifyToken, (req, res) => {
    try {
        const prefs = db.prepare(`
            SELECT phone_number, phone_verified, sms_notifications, push_notifications,
                   email_notifications, email_weekly_reports, email_defense_reminders, email_inactivity_alerts
            FROM users WHERE id = ?
        `).get(req.user.id);
        res.json({ success: true, data: prefs || {} });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
