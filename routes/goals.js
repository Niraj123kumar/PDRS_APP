const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

router.use(verifyToken, requireRole('student'));

function latestDimensionAverage(userId, dimension) {
    const col = `${dimension}_avg`;
    const row = db.prepare(`SELECT ${col} AS value FROM dimension_history WHERE user_id = ? ORDER BY datetime(recorded_at) DESC LIMIT 1`).get(userId);
    return Number(row?.value || 0);
}

// GET /api/goals
router.get('/', (req, res) => {
    const goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
    res.json(goals);
});

// POST /api/goals
router.post('/', (req, res) => {
    const { dimension, targetScore } = req.body;
    if (!['clarity', 'reasoning', 'depth', 'confidence'].includes(dimension)) {
        return res.status(400).json({ error: 'Invalid dimension' });
    }

    const existing = db.prepare('SELECT id FROM user_goals WHERE user_id = ? AND dimension = ? AND achieved = 0').get(req.user.id, dimension);
    if (existing) {
        return res.status(409).json({ error: 'Active goal already exists for this dimension' });
    }

    const current = latestDimensionAverage(req.user.id, dimension);
    const achieved = current >= Number(targetScore);
    const info = db.prepare(`
        INSERT INTO user_goals (user_id, dimension, target_score, current_score, achieved, achieved_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, dimension, Number(targetScore), current, achieved ? 1 : 0, achieved ? new Date().toISOString() : null);
    const goal = db.prepare('SELECT * FROM user_goals WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(goal);
});

// PATCH /api/goals/:id
router.patch('/:id', (req, res) => {
    const { targetScore } = req.body;
    db.prepare('UPDATE user_goals SET target_score = ? WHERE id = ? AND user_id = ?').run(Number(targetScore), req.params.id, req.user.id);
    const updated = db.prepare('SELECT * FROM user_goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!updated) return res.status(404).json({ error: 'Goal not found' });
    res.json(updated);
});

// DELETE /api/goals/:id
router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM user_goals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
});

module.exports = router;
