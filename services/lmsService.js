const axios = require('axios');
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('./email');

/**
 * Sync students from Moodle
 */
async function syncMoodleStudents(moodleUrl, token, courseId) {
    try {
        const response = await axios.get(`${moodleUrl}/webservice/rest/server.php`, {
            params: {
                wstoken: token,
                wsfunction: 'core_enrol_get_enrolled_users',
                courseid: courseId,
                moodlewsrestformat: 'json'
            }
        });
        // Moodle returns an array of users
        return (response.data || []).map(u => ({
            name: u.fullname,
            email: u.email
        }));
    } catch (error) {
        console.error('Moodle sync error:', error.message);
        throw new Error('Failed to sync from Moodle');
    }
}

/**
 * Sync students from Canvas
 */
async function syncCanvasStudents(canvasUrl, token, courseId) {
    try {
        const response = await axios.get(`${canvasUrl}/api/v1/courses/${courseId}/enrollments`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        // Canvas returns an array of enrollment objects
        return (response.data || [])
            .filter(e => e.type === 'StudentEnrollment')
            .map(e => ({
                name: e.user.name,
                email: e.user.email
            }));
    } catch (error) {
        console.error('Canvas sync error:', error.message);
        throw new Error('Failed to sync from Canvas');
    }
}

/**
 * Import students into PDRS
 */
async function importStudents(students, facultyId) {
    let imported = 0;
    let existing = 0;

    for (const s of students) {
        const check = db.prepare('SELECT id FROM users WHERE email = ?').get(s.email);
        if (check) {
            existing++;
            continue;
        }

        const tempPassword = crypto.randomBytes(8).toString('hex');
        const hash = bcrypt.hashSync(tempPassword, 10);
        
        try {
            db.prepare(`
                INSERT INTO users (name, email, password_hash, role, force_password_change)
                VALUES (?, ?, ?, 'student', 1)
            `).run(s.name, s.email, hash);

            // Send welcome email with temp password
            await emailService.sendEmail({
                to: s.email,
                subject: 'Welcome to PDRS - Your Account is Ready',
                html: `
                    <h1>Welcome to PDRS, ${s.name}!</h1>
                    <p>Your instructor has imported your account from the LMS.</p>
                    <p><strong>Temporary Password:</strong> ${tempPassword}</p>
                    <p>Please log in and change your password immediately: <a href="${process.env.APP_URL || 'http://localhost:3000'}/login.html">Login here</a></p>
                `
            });
            imported++;
        } catch (err) {
            console.error(`Failed to import student ${s.email}:`, err.message);
        }
    }

    return { imported, existing };
}

module.exports = {
    syncMoodleStudents,
    syncCanvasStudents,
    importStudents
};
