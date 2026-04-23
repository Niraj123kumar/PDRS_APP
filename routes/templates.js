const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// POST /api/templates
router.post('/', verifyToken, requireRole('student'), (req, res) => {
    const { name, projectId, questionsJson } = req.body;
    if (!name || !projectId) return res.status(400).json({ error: 'name and projectId required' });
    const proj = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const qj = typeof questionsJson === 'string' ? questionsJson : JSON.stringify(questionsJson || []);
    const info = db.prepare(`
        INSERT INTO session_templates (user_id, name, project_id, questions_json)
        VALUES (?, ?, ?, ?)
    `).run(req.user.id, String(name).trim(), projectId, qj);
    const row = db.prepare('SELECT * FROM session_templates WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
});

// GET /api/templates
router.get('/', verifyToken, requireRole('student'), (req, res) => {
    const rows = db.prepare(`
        SELECT t.*, p.title AS project_title
        FROM session_templates t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC
    `).all(req.user.id);
    res.json(rows);
});

// DELETE /api/templates/:id
router.delete('/:id', verifyToken, requireRole('student'), (req, res) => {
    const r = db.prepare('DELETE FROM session_templates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
});

module.exports = router;
