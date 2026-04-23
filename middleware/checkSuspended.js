const db = require('../db');

function checkSuspended(req, res, next) {
    if (!req.user?.id) return next();
    try {
        const row = db.prepare('SELECT is_suspended, suspension_reason FROM users WHERE id = ?').get(req.user.id);
        if (row && Number(row.is_suspended) === 1) {
            return res.status(403).json({
                error: 'Account suspended',
                reason: row.suspension_reason || 'No reason provided'
            });
        }
        return next();
    } catch (err) {
        return res.status(500).json({ error: 'Suspension check failed' });
    }
}

module.exports = { checkSuspended };
