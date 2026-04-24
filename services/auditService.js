const db = require('../db');

function logAction(userId, email, action, resource, resourceId, req, details = {}) {
    try {
        const sanitizedDetails = JSON.parse(
            JSON.stringify(details || {}).replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
        );
        db.prepare(`
            INSERT INTO audit_log (user_id, user_email, action, resource, resource_id, ip_address, user_agent, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId || null,
            email || null,
            action,
            resource || null,
            resourceId ? String(resourceId) : null,
            req?.ip || null,
            req?.headers?.['user-agent'] || null,
            JSON.stringify(sanitizedDetails)
        );
    } catch (_) {
        // best effort logging
    }
}

function getAuditLog(userId, limit = 50) {
    return db.prepare(`
        SELECT id, user_id, user_email, action, resource, resource_id, ip_address, created_at
        FROM audit_log
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(userId, limit);
}

function getAuditLogAdmin(filters = {}) {
    const { action, from, to, limit = 200 } = filters;
    const clauses = [];
    const params = [];
    if (action) {
        clauses.push('action = ?');
        params.push(action);
    }
    if (from) {
        clauses.push("datetime(created_at) >= datetime(?)");
        params.push(from);
    }
    if (to) {
        clauses.push("datetime(created_at) <= datetime(?)");
        params.push(to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT id, user_id, user_email, action, resource, resource_id, ip_address, created_at
        FROM audit_log
        ${where}
        ORDER BY created_at DESC
        LIMIT ?
    `).all(...params, limit);
}

module.exports = {
    logAction,
    getAuditLog,
    getAuditLogAdmin
};
