const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// POST /api/sessions (auth required)
router.post('/', verifyToken, (req, res) => {
    const { project_id } = req.body;
    const user_id = req.user.id;

    if (!project_id) {
        return res.status(400).json({ error: 'Project ID is required' });
    }

    try {
        const info = db.prepare("INSERT INTO sessions (user_id, project_id, status) VALUES (?, ?, 'active')").run(user_id, project_id);
        res.status(201).json({ id: info.lastInsertRowid, user_id, project_id, status: 'active' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions (auth required)
router.get('/', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const sessions = db.prepare(`
            SELECT s.*, p.title as project_title 
            FROM sessions s 
            JOIN projects p ON s.project_id = p.id 
            WHERE s.user_id = ? 
            ORDER BY s.created_at DESC
        `).all(user_id);
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions/:id (auth required)
router.get('/:id', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const session_id = req.params.id;
    try {
        const session = db.prepare('SELECT s.*, p.title as project_title FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.id = ? AND s.user_id = ?').get(session_id, user_id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(session_id);
        res.json({ ...session, answers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:id/answers (auth required)
router.post('/:id/answers', verifyToken, (req, res) => {
    const session_id = req.params.id;
    const { question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback } = req.body;

    try {
        const info = db.prepare(`
            INSERT INTO answers (session_id, question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(session_id, question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback);
        
        res.status(201).json({ id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/sessions/:id (auth required)
router.patch('/:id', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const session_id = req.params.id;
    const { status, overall_score } = req.body;

    try {
        const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(session_id, user_id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        let query = 'UPDATE sessions SET ';
        const params = [];
        if (status) {
            query += 'status = ?, ';
            params.push(status);
        }
        if (overall_score !== undefined) {
            query += 'overall_score = ?, ';
            params.push(overall_score);
        }
        query = query.slice(0, -2) + ' WHERE id = ?';
        params.push(session_id);

        db.prepare(query).run(...params);
        res.json({ message: 'Session updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
