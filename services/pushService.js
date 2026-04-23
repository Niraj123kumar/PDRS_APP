const webpush = require('web-push');
const db = require('../db');

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:no-reply@pdrs.local';

let vapidConfigured = false;
if (vapidPublicKey && vapidPrivateKey) {
    try {
        webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
        vapidConfigured = true;
    } catch (_) {
        vapidConfigured = false;
    }
}

async function sendPush(subscription, title, body, url = '/notifications.html') {
    const payload = JSON.stringify({
        title,
        body,
        url
    });
    try {
        if (!vapidConfigured) throw new Error('vapid-not-configured');
        await webpush.sendNotification(subscription, payload);
        return true;
    } catch (err) {
        if (subscription?.endpoint) {
            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
        }
        return false;
    }
}

async function sendToUser(userId, title, body, url = '/notifications.html') {
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
    for (const row of subs) {
        await sendPush({
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth }
        }, title, body, url);
    }
}

async function sendToAll(title, body, url = '/notifications.html') {
    const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
    for (const row of rows) {
        await sendPush({
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth }
        }, title, body, url);
    }
}

async function sendToRole(role, title, body, url = '/notifications.html') {
    const rows = db.prepare(`
        SELECT s.endpoint, s.p256dh, s.auth
        FROM push_subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE u.role = ?
    `).all(role);
    for (const row of rows) {
        await sendPush({
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth }
        }, title, body, url);
    }
}

module.exports = {
    sendPush,
    sendToUser,
    sendToAll,
    sendToRole,
    vapidPublicKey
};
