const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const db = require('../db');

async function generateSecret(email) {
    const generated = speakeasy.generateSecret({ name: `PDRS:${email}` });
    const qrCodeDataUrl = await qrcode.toDataURL(generated.otpauth_url);
    return {
        secret: generated.base32,
        otpauthUrl: generated.otpauth_url,
        qrCodeDataUrl
    };
}

function verifyToken(secret, token) {
    return speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 1
    });
}

function enableTOTP(userId, secret) {
    db.prepare(`
        INSERT INTO totp_secrets (user_id, secret, enabled)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 1
    `).run(userId, secret);
}

function disableTOTP(userId) {
    db.prepare('UPDATE totp_secrets SET enabled = 0 WHERE user_id = ?').run(userId);
}

module.exports = {
    generateSecret,
    verifyToken,
    enableTOTP,
    disableTOTP
};
