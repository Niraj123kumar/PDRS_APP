const { maskEmail, maskName } = require('../services/encryption');

function stripHTML(str) {
    return String(str || '').replace(/<[^>]*>/g, '');
}

function trimAll(value) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(trimAll);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = trimAll(v);
        }
        return out;
    }
    return value;
}

function sanitizeUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        name: stripHTML(user.name || ''),
        email: stripHTML(user.email || ''),
        role: user.role,
        created_at: user.created_at,
        is_suspended: Number(user.is_suspended) || 0,
        suspension_reason: user.suspension_reason || null,
        session_count: user.session_count,
        last_active: user.last_active
    };
}

function sanitizeUserPublic(user) {
    if (!user) return null;
    return {
        id: user.id,
        name: maskName(user.name),
        email: maskEmail(user.email),
        role: user.role
    };
}

module.exports = {
    stripHTML,
    trimAll,
    sanitizeUser,
    sanitizeUserPublic
};
