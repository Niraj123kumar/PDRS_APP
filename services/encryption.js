const crypto = require('crypto');

const KEY_HEX = process.env.ENCRYPTION_KEY || '';
const FALLBACK_KEY = crypto.createHash('sha256').update('pdrs-dev-encryption-key').digest('hex');
const NORMALIZED_KEY_HEX = /^[a-fA-F0-9]{64}$/.test(KEY_HEX) ? KEY_HEX : FALLBACK_KEY;
const KEY = Buffer.from(NORMALIZED_KEY_HEX, 'hex');

function encryptField(text) {
    if (text === null || text === undefined) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptField(str) {
    if (!str || typeof str !== 'string') return '';
    const [ivHex, encryptedHex] = str.split(':');
    if (!ivHex || !encryptedHex) return '';
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    if (!local || !domain) return '';
    return `${local.slice(0, 2)}***@${domain}`;
}

function maskName(name) {
    const clean = String(name || '').trim();
    if (!clean) return '';
    return `${clean[0]}***`;
}

function hashForLookup(text) {
    return crypto.createHash('sha256').update(String(text || '').toLowerCase()).digest('hex');
}

module.exports = {
    encryptField,
    decryptField,
    maskEmail,
    maskName,
    hashForLookup
};
