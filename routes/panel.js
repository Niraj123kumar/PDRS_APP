const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// POST /api/panel/request (student auth)
router.post('/request', verifyToken, requireRole('student'), (req, res) => {
    const { faculty_id, message } = req.body;
    const student_id = req.user.id;

    try {
        const info = db.prepare('INSERT INTO session_requests (student_id, faculty_id, message) VALUES (?, ?, ?)')
            .run(student_id, faculty_id, message);
        
        // Notify faculty via notification table
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'panel_request', 'New Session Request', ?)")
            .run(faculty_id, `Student ${req.user.name} has requested a mock defense session.`);

        res.json({ id: info.lastInsertRowid, message: "Request sent" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/panel/sessions/:id/annotations (faculty auth)
router.post('/sessions/:id/annotations', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;
    const faculty_id = req.user.id;
    const { question_index, note, score_override } = req.body;

    try {
        db.prepare('INSERT INTO panel_annotations (panel_session_id, faculty_id, question_index, note, score_override) VALUES (?, ?, ?, ?, ?)')
            .run(panel_session_id, faculty_id, question_index, note, score_override);
        res.json({ message: "Annotation saved" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/panel/sessions/:id/report (faculty auth)
router.get('/sessions/:id/report', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;

    try {
        const panel = db.prepare('SELECT * FROM panel_sessions WHERE id = ?').get(panel_session_id);
        if (!panel) return res.status(404).json({ error: "Panel session not found" });

        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(panel.session_id);
        const annotations = db.prepare('SELECT * FROM panel_annotations WHERE panel_session_id = ?').all(panel_session_id);

        res.json({ panel, answers, annotations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
