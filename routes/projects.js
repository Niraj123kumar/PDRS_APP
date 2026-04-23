const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// POST /api/projects (auth required)
router.post('/', verifyToken, (req, res) => {
    const { title, description, tech_stack } = req.body;
    const user_id = req.user.id;

    if (!title) {
        return res.status(400).json({ error: 'Project title is required' });
    }

    try {
        const info = db.prepare('INSERT INTO projects (user_id, title, description, tech_stack) VALUES (?, ?, ?, ?)').run(user_id, title, description, tech_stack);
        res.status(201).json({ id: info.lastInsertRowid, user_id, title, description, tech_stack });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/projects (auth required)
router.get('/', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
