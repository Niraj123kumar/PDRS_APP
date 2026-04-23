const db = require('../db');
const { encryptField } = require('./encryption');

let completed = false;

function runPIIMigrationOnce() {
    if (completed) return;
    const needsMigration = db.prepare('SELECT COUNT(*) AS count FROM users WHERE encrypted_email IS NULL OR encrypted_name IS NULL').get();
    if (!needsMigration || Number(needsMigration.count) === 0) {
        completed = true;
        return;
    }

    const users = db.prepare('SELECT id, email, name, encrypted_email, encrypted_name FROM users').all();
    const tx = db.transaction((rows) => {
        for (const user of rows) {
            const encryptedEmail = user.encrypted_email || encryptField(user.email || '');
            const encryptedName = user.encrypted_name || encryptField(user.name || '');
            db.prepare('UPDATE users SET encrypted_email = ?, encrypted_name = ? WHERE id = ?')
                .run(encryptedEmail, encryptedName, user.id);
        }
    });
    tx(users);
    completed = true;
    console.log(`[migration] Encrypted PII migration completed for ${users.length} users.`);
}

module.exports = {
    runPIIMigrationOnce
};
