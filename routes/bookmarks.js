const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

router.get('/', verifyToken, requireRole('student'), (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/:id', verifyToken, requireRole('student'), (req, res) => {
    try {
        const result = db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, error: 'Bookmark not found' });
        }
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
