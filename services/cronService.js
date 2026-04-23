const cron = require('node-cron');
const db = require('../db');
const emailService = require('./email');
const pushService = require('./pushService');
const smsService = require('./smsService');
const backupService = require('./backupService');

let started = false;

function alreadySentReminder(userId, type, windowHours = 26) {
    const row = db.prepare(`
        SELECT id FROM scheduled_reminders
        WHERE user_id = ? AND type = ? AND sent = 1
          AND datetime(created_at) >= datetime('now', ?)
        LIMIT 1
    `).get(userId, type, `-${windowHours} hours`);
    return !!row;
}

async function runDefenseReminderJob() {
    const users = db.prepare(`
            SELECT *
            FROM users
            WHERE defense_date IS NOT NULL
              AND datetime(defense_date) BETWEEN datetime('now', '+23 hours') AND datetime('now', '+25 hours')
    `).all();
    for (const user of users) {
        if (alreadySentReminder(user.id, 'defense_24h')) continue;
        if (Number(user.email_defense_reminders || 1) === 1) {
            await emailService.sendDefenseReminder(user.email, user.name, user.defense_date).catch(() => {});
        }
        if (Number(user.sms_notifications) === 1 && user.phone_number && Number(user.phone_verified) === 1) {
            await smsService.sendDefenseReminder(user.phone_number, user.name, 24);
        }
        if (Number(user.push_notifications || 0) === 1) {
            await pushService.sendToUser(user.id, 'Defense Reminder', 'Your defense is in 24 hours.', '/student.html');
        }
        db.prepare('INSERT INTO scheduled_reminders (user_id, type, scheduled_for, sent) VALUES (?, ?, ?, 1)')
            .run(user.id, 'defense_24h', user.defense_date);
        db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)')
            .run(user.id, 'defense', 'Defense Reminder', 'Your defense is in 24 hours.');
    }
}

async function runWeeklyReportJob() {
    const students = db.prepare(`
            SELECT u.*
            FROM users u
            WHERE u.role = 'student' AND EXISTS (
                SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.status = 'completed'
            )
    `).all();
    for (const student of students) {
        if (Number(student.email_weekly_reports || 1) !== 1) continue;
        const thisWeek = db.prepare(`
                SELECT COUNT(*) AS n, AVG(overall_score) AS avg
                FROM sessions
                WHERE user_id = ? AND status = 'completed' AND datetime(created_at) >= datetime('now', '-7 days')
        `).get(student.id);
        const lastWeek = db.prepare(`
                SELECT AVG(overall_score) AS avg
                FROM sessions
                WHERE user_id = ? AND status = 'completed'
                  AND datetime(created_at) >= datetime('now', '-14 days')
                  AND datetime(created_at) < datetime('now', '-7 days')
        `).get(student.id);
        const improvement = Number(thisWeek.avg || 0) - Number(lastWeek.avg || 0);
        await emailService.sendWeeklyReport(student.email, student.name, {
            scoreTrend: improvement >= 0 ? `+${improvement.toFixed(1)}` : `${improvement.toFixed(1)}`,
            sessionsCompleted: thisWeek.n || 0,
            topDimension: 'See dashboard'
        }).catch(() => {});
        db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)')
            .run(student.id, 'weekly_report', 'Weekly Progress Report', 'Your weekly report is ready.');
    }
}

async function runInactivityAlertJob() {
    const inactiveStudents = db.prepare(`
            SELECT u.id, u.name, u.email, u.defense_date
            FROM users u
            WHERE u.role = 'student'
              AND u.defense_date IS NOT NULL
              AND datetime(u.defense_date) <= datetime('now', '+14 days')
              AND NOT EXISTS (
                SELECT 1 FROM sessions s
                WHERE s.user_id = u.id AND datetime(s.created_at) >= datetime('now', '-7 days')
              )
    `).all();
    if (!inactiveStudents.length) return;
    const faculty = db.prepare("SELECT id, name, email FROM users WHERE role = 'faculty'").all();
    for (const f of faculty) {
        await emailService.sendFacultyInactivityAlert(f.email, f.name, inactiveStudents).catch(() => {});
        db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)')
            .run(f.id, 'at_risk', 'Inactive students alert', `${inactiveStudents.length} students are at risk due to inactivity.`);
    }
}

function runOtpCleanupJob() {
    db.prepare("DELETE FROM otp_codes WHERE datetime(expires_at) < datetime('now')").run();
}

function startCronJobs() {
    if (started) return;
    started = true;

    cron.schedule('0 * * * *', runDefenseReminderJob);
    cron.schedule('0 9 * * 0', runWeeklyReportJob);
    cron.schedule('0 8 * * *', runInactivityAlertJob);
    cron.schedule('0 * * * *', runOtpCleanupJob);

    // Daily backup at 2am
    cron.schedule('0 2 * * *', async () => {
        try {
            await backupService.backupDatabase();
            console.log('Database backed up');
        } catch (err) {
            console.error('Scheduled database backup failed:', err);
        }
    });

    // Weekly JSON export at 3am Sunday
    cron.schedule('0 3 * * 0', async () => {
        try {
            await backupService.exportToJSON();
            console.log('Weekly JSON export completed');
        } catch (err) {
            console.error('Scheduled JSON export failed:', err);
        }
    });
}

module.exports = {
    startCronJobs,
    runDefenseReminderJob,
    runWeeklyReportJob,
    runInactivityAlertJob,
    runOtpCleanupJob
};
