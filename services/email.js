const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER || 'no-reply@pdrs.local';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});

function emailShell(title, body) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f8fafc;">
            <div style="background: #ffffff; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0;">
                <h2 style="margin: 0 0 12px; color: #2563eb;">PDRS</h2>
                <h3 style="margin: 0 0 16px; color: #0f172a;">${title}</h3>
                ${body}
            </div>
        </div>
    `;
}

async function sendEmail(mailOptions) {
    if (!SMTP_USER || !SMTP_PASS) {
        return;
    }
    await transporter.sendMail({
        from: FROM_EMAIL,
        ...mailOptions
    });
}

async function sendOTP(email, otp) {
    const html = emailShell(
        'Your Login Verification Code',
        `
            <p style="margin-bottom: 16px; color: #334155;">Use this one-time code to continue your PDRS login.</p>
            <div style="font-size: 36px; letter-spacing: 8px; font-weight: 700; color: #0f172a; text-align: center; margin: 20px 0;">${otp}</div>
            <p style="color: #64748b; margin-bottom: 0;">This code expires in 10 minutes.</p>
        `
    );
    await sendEmail({
        to: email,
        subject: 'Your PDRS Login Code',
        html
    });
}

async function sendWelcome(email, name) {
    const html = emailShell(
        `Welcome to PDRS, ${name}!`,
        `
            <p style="color: #334155;">Great to have you onboard.</p>
            <ul style="color: #334155;">
                <li>Complete your profile and project details</li>
                <li>Run your first mock defense session</li>
                <li>Track progress and improve weak dimensions</li>
            </ul>
        `
    );
    await sendEmail({
        to: email,
        subject: 'Welcome to PDRS',
        html
    });
}

async function sendDefenseReminder(email, name, date) {
    const html = emailShell(
        'Defense Tomorrow — Are You Ready?',
        `
            <p style="color: #334155;">Hi ${name}, your defense date is approaching: <strong>${date}</strong>.</p>
            <ul style="color: #334155;">
                <li>Practice clear and concise answers</li>
                <li>Prepare for follow-up technical questions</li>
                <li>Do one final mock session today</li>
            </ul>
            <p><a href="${APP_URL}/student.html" style="color: #2563eb;">Go to PDRS Practice</a></p>
        `
    );
    await sendEmail({
        to: email,
        subject: 'Defense Tomorrow — Are You Ready?',
        html
    });
}

async function sendWeeklyReport(email, name, stats) {
    const html = emailShell(
        'Your Weekly PDRS Progress',
        `
            <p style="color: #334155;">Hi ${name}, here is your progress this week:</p>
            <ul style="color: #334155;">
                <li>Score trend: <strong>${stats.scoreTrend || 'N/A'}</strong></li>
                <li>Sessions completed: <strong>${stats.sessionsCompleted || 0}</strong></li>
                <li>Top dimension: <strong>${stats.topDimension || 'N/A'}</strong></li>
            </ul>
        `
    );
    await sendEmail({
        to: email,
        subject: 'Your Weekly PDRS Progress',
        html
    });
}

module.exports = {
    sendOTP,
    sendWelcome,
    sendDefenseReminder,
    sendWeeklyReport
};
