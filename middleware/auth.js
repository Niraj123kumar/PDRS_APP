const tokenService = require('../services/tokenService');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const user = tokenService.verifyAccessToken(token);
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Authentication required' });
    }
};

module.exports = { verifyToken };
