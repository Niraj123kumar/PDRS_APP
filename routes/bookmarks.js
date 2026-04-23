const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

router.get('/', verifyToken, requireRole('student'), (req, res) => {
    const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
    res.json(rows);
});

module.exports = router;
