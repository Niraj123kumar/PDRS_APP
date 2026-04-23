const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const slackService = require('../services/slackService');
const zoomService = require('../services/zoomService');
const lmsService = require('../services/lmsService');
const emailService = require('../services/email');

// POST /api/integrations/slack/connect (auth)
router.post('/slack/connect', verifyToken, async (req, res) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'Webhook URL is required' });

    try {
        // Test webhook
        await slackService.sendMessage(webhookUrl, { text: '✅ PDRS Slack Integration Connected Successfully!' });
        
        db.prepare('UPDATE users SET slack_webhook_url = ? WHERE id = ?').run(webhookUrl, req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to connect Slack: ' + err.message });
    }
});

// DELETE /api/integrations/slack/disconnect (auth)
router.delete('/slack/disconnect', verifyToken, (req, res) => {
    try {
        db.prepare('UPDATE users SET slack_webhook_url = NULL WHERE id = ?').run(req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/integrations/slack/test (auth)
router.post('/slack/test', verifyToken, async (req, res) => {
    try {
        const user = db.prepare('SELECT slack_webhook_url FROM users WHERE id = ?').get(req.user.id);
        if (!user?.slack_webhook_url) return res.status(400).json({ error: 'Slack not connected' });

        await slackService.sendMessage(user.slack_webhook_url, { text: '🛠️ This is a test message from PDRS.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/integrations/zoom/create-meeting (faculty auth)
router.post('/zoom/create-meeting', verifyToken, async (req, res) => {
    if (req.user.role !== 'faculty' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Faculty access required' });
    }

    const { topic, startTime, duration, studentEmail, studentName } = req.body;
    try {
        const meeting = await zoomService.createMeeting(topic, startTime, duration);
        
        // Save to defense_schedule if needed, or just return. 
        // User request says "Save meeting details to defense_schedule"
        // Let's assume there's a student_id we can find by email
        const student = db.prepare('SELECT id, name FROM users WHERE email = ?').get(studentEmail);
        
        if (student) {
            db.prepare(`
                INSERT INTO defense_schedule (student_id, faculty_id, scheduled_date, location, notes)
                VALUES (?, ?, ?, ?, ?)
            `).run(student.id, req.user.id, startTime, meeting.joinUrl, `Zoom Meeting ID: ${meeting.meetingId}`);

            // Send email to student
            await emailService.sendEmail({
                to: studentEmail,
                subject: 'Defense Scheduled - Zoom Link Included',
                html: `
                    <p>Hi ${student.name}, your defense has been scheduled.</p>
                    <p><strong>Topic:</strong> ${topic}</p>
                    <p><strong>Time:</strong> ${startTime}</p>
                    <p><strong>Zoom Link:</strong> <a href="${meeting.joinUrl}">${meeting.joinUrl}</a></p>
                `
            });

            // Notification
            db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'defense', 'Zoom Defense Scheduled', ?)")
                .run(student.id, `Your defense is scheduled via Zoom. Link: ${meeting.joinUrl}`);
        }

        res.json(meeting);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/integrations/lms/sync (faculty auth)
router.post('/lms/sync', verifyToken, async (req, res) => {
    if (req.user.role !== 'faculty' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Faculty access required' });
    }

    const { lmsType, courseId, lmsUrl, token } = req.body;
    try {
        let students = [];
        if (lmsType === 'moodle') {
            students = await lmsService.syncMoodleStudents(lmsUrl, token, courseId);
        } else if (lmsType === 'canvas') {
            students = await lmsService.syncCanvasStudents(lmsUrl, token, courseId);
        } else {
            return res.status(400).json({ error: 'Unsupported LMS type' });
        }

        const result = await lmsService.importStudents(students, req.user.id);

        // Update lms_sync table
        db.prepare(`
            INSERT INTO lms_sync (faculty_id, lms_type, course_id, last_synced, student_count)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).run(req.user.id, lmsType, courseId, students.length);

        res.json({ ...result, total: students.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/integrations/lms/status (faculty auth)
router.get('/lms/status', verifyToken, (req, res) => {
    try {
        const status = db.prepare('SELECT * FROM lms_sync WHERE faculty_id = ? ORDER BY last_synced DESC').all(req.user.id);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/integrations/whatsapp/save (auth)
router.post('/whatsapp/save', verifyToken, (req, res) => {
    const { whatsappNumber } = req.body;
    try {
        db.prepare('UPDATE users SET whatsapp_number = ? WHERE id = ?').run(whatsappNumber, req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
