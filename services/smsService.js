const twilio = require('twilio');
const auditService = require('./auditService');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;
let client = null;
if (accountSid && authToken) {
    try {
        client = twilio(accountSid, authToken);
    } catch (_) {
        client = null;
    }
}

async function sendSMS(phoneNumber, message, user = null) {
    if (!client || !fromPhone || !phoneNumber) return { success: false, reason: 'sms-not-configured' };
    try {
        await client.messages.create({
            body: message,
            from: fromPhone,
            to: phoneNumber
        });
        auditService.logAction(user?.id || null, user?.email || null, 'SEND_SMS', 'notification', null, null, { phoneNumber });
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
}

async function sendDefenseReminder(phoneNumber, name, hoursUntil) {
    return sendSMS(phoneNumber, `Hi ${name}, your defense is in ${hoursUntil} hours. Practice now: http://localhost:3000/student.html`);
}

async function sendOTPSMS(phoneNumber, otp) {
    return sendSMS(phoneNumber, `Your PDRS code is ${otp}. Expires in 10 minutes.`);
}

module.exports = {
    sendSMS,
    sendDefenseReminder,
    sendOTPSMS
};
