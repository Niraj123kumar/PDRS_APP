const tokenService = require('../services/tokenService');
const db = require('../db');
const { checkSuspended } = require('./checkSuspended');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const user = tokenService.verifyAccessToken(token);
        const dbUser = db.prepare('SELECT id, email, role, is_suspended, suspension_reason, force_password_change FROM users WHERE id = ?').get(user.id);
        if (!dbUser) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        req.user = { ...user, ...dbUser };
        return checkSuspended(req, res, next);
    } catch (err) {
        return res.status(401).json({ error: 'Authentication required' });
    }
};

module.exports = { verifyToken };
