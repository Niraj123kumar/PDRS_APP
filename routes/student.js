const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const calendarService = require('../services/calendarService');
const { getBadges, BADGES } = require('../services/badgeService');
const pdfService = require('../services/pdfService');

// GET /api/student/defense-date
router.get('/defense-date', verifyToken, requireRole('student'), (req, res) => {
    try {
        const user = db.prepare('SELECT defense_date, google_event_id, google_event_url FROM users WHERE id = ?').get(req.user.id);
        res.json({
            success: true,
            data: {
                defenseDate: user ? user.defense_date : null,
                googleEventId: user ? user.google_event_id : null,
                googleEventUrl: user ? user.google_event_url : null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/student/defense-date
router.post('/defense-date', verifyToken, requireRole('student'), (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ success: false, error: 'Date is required' });

    try {
        const defenseDate = new Date(date);
        if (defenseDate <= new Date()) {
            return res.status(400).json({ success: false, error: 'Defense date must be in the future' });
        }

        db.prepare('UPDATE users SET defense_date = ? WHERE id = ?').run(date, req.user.id);
        res.json({ success: true, data: { defenseDate: date } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/student/schedule-defense
router.post('/schedule-defense', verifyToken, requireRole('student'), async (req, res) => {
    const { date, title, facultyEmails } = req.body;
    if (!date || !title) return res.status(400).json({ success: false, error: 'Date and title are required' });

    try {
        const defenseDate = new Date(date);
        if (Number.isNaN(defenseDate.getTime()) || defenseDate <= new Date()) {
            return res.status(400).json({ success: false, error: 'Defense date must be in the future' });
        }

        db.prepare('UPDATE users SET defense_date = ? WHERE id = ?').run(date, req.user.id);
        const user = db.prepare('SELECT id, email, calendar_token FROM users WHERE id = ?').get(req.user.id);

        let googleEventUrl = null;
        if (user?.calendar_token) {
            const attendees = String(facultyEmails || '')
                .split(',')
                .map((email) => email.trim())
                .filter(Boolean);
            const event = await calendarService.createDefenseEvent(user.calendar_token, {
                summary: title,
                description: `PDRS Defense Scheduling Event for ${user.email}`,
                start: defenseDate.toISOString(),
                end: new Date(defenseDate.getTime() + 60 * 60 * 1000).toISOString(),
                attendees
            });
            googleEventUrl = event.eventLink;
            db.prepare('UPDATE users SET google_event_id = ?, google_event_url = ? WHERE id = ?')
                .run(event.eventId, event.eventLink, req.user.id);
        }

        // Email reminder setup placeholder (Phase 19 will handle actual sending)
        return res.json({ success: true, data: { defenseDate: date, googleEventUrl } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/student/calendar-event
router.delete('/calendar-event', verifyToken, requireRole('student'), async (req, res) => {
    try {
        const user = db.prepare('SELECT calendar_token, google_event_id FROM users WHERE id = ?').get(req.user.id);
        if (user?.calendar_token && user?.google_event_id) {
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(user.google_event_id)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${user.calendar_token}` }
            });
        }
        db.prepare('UPDATE users SET google_event_id = NULL, google_event_url = NULL WHERE id = ?').run(req.user.id);
        return res.json({ success: true, data: null });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/student/badges
router.get('/badges', verifyToken, requireRole('student'), (req, res) => {
    try {
        const earned = getBadges(req.user.id);
        const earnedTypes = new Set(earned.map((b) => b.badge_type));
        const allBadges = Object.entries(BADGES).map(([type, meta]) => ({
            badge_type: type,
            badge_name: meta.name,
            description: meta.description,
            earned: earnedTypes.has(type)
        }));
        res.json({ success: true, data: { earned, allBadges } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/student/dashboard-insights
router.get('/dashboard-insights', verifyToken, requireRole('student'), (req, res) => {
    try {
        const latest = db.prepare('SELECT * FROM dimension_history WHERE user_id = ? ORDER BY datetime(recorded_at) DESC LIMIT 1').get(req.user.id);
        const goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
        const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20').all(req.user.id);
        const streak = db.prepare(`
            SELECT COUNT(DISTINCT date(created_at)) AS days
            FROM sessions
            WHERE user_id = ? AND status = 'completed' AND datetime(created_at) >= datetime('now', '-30 days')
        `).get(req.user.id).days;
        res.json({
            success: true,
            data: {
                latestDimensions: latest || null,
                goals,
                bookmarks,
                streakDays: Number(streak || 0)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/student/export-report
router.get('/export-report', verifyToken, requireRole('student'), async (req, res) => {
    try {
        const pdf = await pdfService.generateStudentReport(req.user.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=progress-report.pdf');
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

// GET /api/student/goals
router.get('/goals', verifyToken, requireRole('student'), (req, res) => {
    try {
        const goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
        res.json({ success: true, data: goals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/student/bookmarks
router.get('/bookmarks', verifyToken, requireRole('student'), (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

