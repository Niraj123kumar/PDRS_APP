const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_here', (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        req.user = user;
        next();
    });
};

module.exports = { verifyToken };
