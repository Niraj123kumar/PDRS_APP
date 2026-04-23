const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');

class BackupService {
    constructor() {
        this.backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    async backupDatabase() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const backupPath = path.join(this.backupDir, `pdrs_${timestamp}.db`);
        const dbPath = path.join(__dirname, '..', 'pdrs.db');

        try {
            fs.copyFileSync(dbPath, backupPath);
            console.log(`Database backed up to ${backupPath}`);
            this.cleanOldBackups();
            return { success: true, filename: `pdrs_${timestamp}.db` };
        } catch (err) {
            console.error('Database backup failed:', err);
            throw err;
        }
    }

    cleanOldBackups() {
        const files = fs.readdirSync(this.backupDir)
            .filter(f => f.startsWith('pdrs_') && f.endsWith('.db'))
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 7) {
            files.slice(7).forEach(f => {
                fs.unlinkSync(path.join(this.backupDir, f.name));
                console.log(`Deleted old backup: ${f.name}`);
            });
        }
    }

    async exportToJSON() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10);
        const exportDir = path.join(this.backupDir, `export_${timestamp}`);
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);

        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        
        for (const table of tables) {
            const data = db.prepare(`SELECT * FROM ${table.name}`).all();
            fs.writeFileSync(
                path.join(exportDir, `${table.name}.json`),
                JSON.stringify(data, null, 2)
            );
        }

        const zipPath = path.join(this.backupDir, `export_${timestamp}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', () => {
                // Clean up the temporary export directory
                fs.rmSync(exportDir, { recursive: true, force: true });
                resolve({ success: true, filename: `export_${timestamp}.zip` });
            });
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            archive.directory(exportDir, false);
            archive.finalize();
        });
    }

    listBackups() {
        return fs.readdirSync(this.backupDir)
            .filter(f => f.endsWith('.db') || f.endsWith('.zip'))
            .map(f => {
                const stats = fs.statSync(path.join(this.backupDir, f));
                return {
                    filename: f,
                    size: stats.size,
                    date: stats.mtime
                };
            })
            .sort((a, b) => b.date - a.date);
    }
}

module.exports = new BackupService();
