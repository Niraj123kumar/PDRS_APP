const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

// POST /api/auth/register
router.post('/register', (req, res) => {
    const { name, email, password, role } = req.body;

    // Strict role validation
    if (!['student', 'faculty'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be student or faculty.' });
    }

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const password_hash = bcrypt.hashSync(password, 12);
        const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, password_hash, role);
        
        const user = { id: info.lastInsertRowid, name, email, role };
        const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });

        res.json({ token, user });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            db.prepare('INSERT INTO login_attempts (email, ip, success) VALUES (?, ?, 0)').run(email, ip);
            return res.status(401).json({ error: 'Wrong credentials' });
        }

        db.prepare('INSERT INTO login_attempts (email, ip, success) VALUES (?, ?, 1)').run(email, ip);

        const userPayload = { id: user.id, name: user.name, email: user.email, role: user.role };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '24h' });

        res.json({ token, user: userPayload });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
