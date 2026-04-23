const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'access_secret_dev';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret_dev';
const ACCESS_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

function generateAccessToken(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY });
}

function generateRefreshToken(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function saveRefreshToken(userId, token) {
    const tokenHash = hashToken(token);
    db.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked)
        VALUES (?, ?, datetime('now', '+7 days'), 0)
    `).run(userId, tokenHash);
    return tokenHash;
}

function revokeRefreshToken(tokenHash) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

function verifyAccessToken(token) {
    return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
    return jwt.verify(token, REFRESH_SECRET);
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    hashToken,
    saveRefreshToken,
    revokeRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
};
