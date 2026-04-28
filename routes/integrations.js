const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const slackService = require('../services/slackService');
const zoomService = require('../services/zoomService');
const lmsService = require('../services/lmsService');
const emailService = require('../services/email');

const { requireRole } = require('../middleware/roles');

// POST /api/integrations/slack/connect (auth)
router.post('/slack/connect', verifyToken, async (req, res) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return res.status(400).json({ success: false, error: 'Webhook URL is required' });
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
        return res.status(400).json({ success: false, error: 'Invalid Slack Webhook URL' });
    }

    try {
        // Test webhook
        await slackService.sendMessage(webhookUrl, { 
            text: '✅ *PDRS Slack Integration Connected*\nYour defense notifications will appear here.' 
        });
        
        db.prepare('UPDATE users SET slack_webhook_url = ? WHERE id = ?').run(webhookUrl, req.user.id);
        res.json({ success: true, data: null });
    } catch (err) {
        console.error('Slack connection error:', err);
        res.status(500).json({ success: false, error: 'Failed to connect Slack: ' + (err.response?.data || err.message) });
    }
});

// POST /api/integrations/zoom/connect (auth)
router.post('/zoom/connect', verifyToken, async (req, res) => {
    try {
        // In a real app, this would be an OAuth redirect or validation
        // For this MVP, we'll just enable it by setting a dummy zoom_user_id
        const dummyZoomId = 'zoom_' + req.user.id;
        db.prepare('UPDATE users SET zoom_user_id = ? WHERE id = ?').run(dummyZoomId, req.user.id);
        res.json({ success: true, data: { zoomUserId: dummyZoomId } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to connect Zoom: ' + err.message });
    }
});

// DELETE /api/integrations/zoom/disconnect (auth)
router.delete('/zoom/disconnect', verifyToken, (req, res) => {
    try {
        const result = db.prepare('UPDATE users SET zoom_user_id = NULL WHERE id = ?').run(req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/integrations/slack/disconnect (auth)
router.delete('/slack/disconnect', verifyToken, (req, res) => {
    try {
        const result = db.prepare('UPDATE users SET slack_webhook_url = NULL WHERE id = ?').run(req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/integrations/slack/test (auth)
router.post('/slack/test', verifyToken, async (req, res) => {
    try {
        const user = db.prepare('SELECT slack_webhook_url FROM users WHERE id = ?').get(req.user.id);
        if (!user?.slack_webhook_url) return res.status(400).json({ success: false, error: 'Slack not connected' });

        await slackService.sendMessage(user.slack_webhook_url, { text: '🛠️ This is a test message from PDRS.' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/integrations/zoom/create-meeting (faculty auth)
router.post('/zoom/create-meeting', verifyToken, requireRole('faculty'), async (req, res) => {
    const { topic, startTime, duration, studentEmail } = req.body;
    if (!studentEmail) return res.status(400).json({ success: false, error: 'Student email is required' });

    try {
        const student = db.prepare('SELECT id, name FROM users WHERE email = ?').get(studentEmail);
        if (!student) return res.status(404).json({ success: false, error: `Student with email ${studentEmail} not found` });

        const meeting = await zoomService.createMeeting(topic, startTime, duration);
        
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

        res.json({ success: true, data: meeting });
    } catch (err) {
        console.error('Zoom integration error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/integrations/lms/sync (faculty auth)
router.post('/lms/sync', verifyToken, requireRole('faculty'), async (req, res) => {
    const { lmsType, courseId, lmsUrl, token } = req.body;
    if (!lmsType || !courseId || !lmsUrl || !token) {
        return res.status(400).json({ success: false, error: 'lmsType, courseId, lmsUrl, and token are required' });
    }
    try {
        let students = [];
        if (lmsType === 'moodle') {
            students = await lmsService.syncMoodleStudents(lmsUrl, token, courseId);
        } else if (lmsType === 'canvas') {
            students = await lmsService.syncCanvasStudents(lmsUrl, token, courseId);
        } else {
            return res.status(400).json({ success: false, error: 'Unsupported LMS type' });
        }

        const result = await lmsService.importStudents(students, req.user.id);

        // Update lms_sync table
        db.prepare(`
            INSERT INTO lms_sync (faculty_id, lms_type, course_id, last_synced, student_count)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).run(req.user.id, lmsType, courseId, result.imported);

        res.json({ success: true, data: { ...result, total: students.length } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/integrations/lms/status (faculty auth)
router.get('/lms/status', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const status = db.prepare('SELECT * FROM lms_sync WHERE faculty_id = ? ORDER BY last_synced DESC').all(req.user.id);
        res.json({ success: true, data: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/integrations/whatsapp/save (auth)
router.post('/whatsapp/save', verifyToken, (req, res) => {
    const { whatsappNumber } = req.body;
    if (!whatsappNumber) return res.status(400).json({ success: false, error: 'whatsappNumber is required' });
    try {
        const result = db.prepare('UPDATE users SET whatsapp_number = ? WHERE id = ?').run(whatsappNumber, req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
