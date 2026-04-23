const db = require('../db');
const emailService = require('./email');

function ipPrefix(ip) {
    return String(ip || '').split('.').slice(0, 2).join('.');
}

async function inferCountryFromIp(ip) {
    try {
        const normalized = String(ip || '').replace('::ffff:', '');
        const res = await fetch(`https://ipapi.co/${encodeURIComponent(normalized)}/json/`);
        if (!res.ok) return 'UNKNOWN';
        const data = await res.json();
        return data.country_name || data.country_code || 'UNKNOWN';
    } catch {
        return 'UNKNOWN';
    }
}

async function checkSuspiciousLogin(userId, currentIp, req) {
    const ip = String(currentIp || '').replace('::ffff:', '');
    const reasons = [];
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) return { suspicious: false, reason: '' };

    const recentSuccess = db.prepare(`
        SELECT ip, created_at FROM login_attempts
        WHERE user_id = ? AND success = 1
        ORDER BY datetime(created_at) DESC LIMIT 5
    `).all(userId);
    const seenIps = new Set(recentSuccess.map((r) => r.ip).filter(Boolean));
    if (!seenIps.has(ip) && seenIps.size > 0) {
        reasons.push('New login IP not seen in recent successful logins');
    }

    const failedByIp = db.prepare(`
        SELECT COUNT(*) AS count FROM login_attempts
        WHERE ip = ? AND success = 0 AND datetime(created_at) >= datetime('now', '-1 hour')
    `).get(ip);
    if (Number(failedByIp?.count || 0) > 5) {
        reasons.push('More than 5 failed attempts from this IP in last hour');
    }

    const thisCountry = await inferCountryFromIp(ip);
    const lastLogin = db.prepare(`
        SELECT ip, created_at FROM login_attempts
        WHERE user_id = ? AND success = 1
        ORDER BY datetime(created_at) DESC LIMIT 1
    `).get(userId);
    if (lastLogin) {
        const lastCountry = await inferCountryFromIp(lastLogin.ip || '');
        const withinHour = db.prepare(`
            SELECT CASE WHEN datetime(?) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END AS recent
        `).get(lastLogin.created_at);
        if (Number(withinHour?.recent) === 1 && lastCountry !== 'UNKNOWN' && thisCountry !== 'UNKNOWN' && lastCountry !== thisCountry) {
            reasons.push('Impossible travel: different countries within 1 hour');
        } else if (ipPrefix(lastLogin.ip) && ipPrefix(lastLogin.ip) !== ipPrefix(ip) && thisCountry !== 'UNKNOWN' && lastCountry !== 'UNKNOWN' && lastCountry !== thisCountry) {
            reasons.push('Login location differs significantly from last known location');
        }
    }

    if (reasons.length === 0) {
        return { suspicious: false, reason: '' };
    }

    const reason = reasons.join('; ');
    db.prepare(`
        INSERT INTO suspicious_logins (user_id, email, ip_address, reason, resolved)
        VALUES (?, ?, ?, ?, 0)
    `).run(userId, user.email, ip, reason);

    await emailService.sendSecurityAlert(user.email, reason, req?.headers?.['user-agent'] || 'Unknown agent', ip).catch(() => {});
    return { suspicious: true, reason };
}

function resolveAlert(alertId) {
    const result = db.prepare('UPDATE suspicious_logins SET resolved = 1 WHERE id = ?').run(alertId);
    return result.changes > 0;
}

module.exports = {
    checkSuspiciousLogin,
    resolveAlert
};
