const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET /api/student/defense-date
router.get('/defense-date', verifyToken, (req, res) => {
    try {
        const user = db.prepare('SELECT defense_date FROM users WHERE id = ?').get(req.user.id);
        res.json({ defenseDate: user ? user.defense_date : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/student/defense-date
router.post('/defense-date', verifyToken, (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    try {
        const defenseDate = new Date(date);
        if (defenseDate <= new Date()) {
            return res.status(400).json({ error: 'Defense date must be in the future' });
        }

        db.prepare('UPDATE users SET defense_date = ? WHERE id = ?').run(date, req.user.id);
        res.json({ success: true, defenseDate: date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
