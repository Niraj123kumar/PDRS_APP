const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/faculty/stats (faculty auth)
router.get('/stats', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
        const sessionsThisWeek = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE created_at >= datetime('now', '-7 days')").get().count;
        const avgCohortScore = db.prepare('SELECT AVG(overall_score) as avg FROM sessions WHERE overall_score IS NOT NULL').get().avg || 0;
        
        // At-risk: avg score < 50 OR no session in 7 days
        const atRiskCount = db.prepare(`
            SELECT COUNT(DISTINCT u.id) as count 
            FROM users u 
            LEFT JOIN sessions s ON u.id = s.user_id 
            WHERE u.role = 'student' 
            AND (
                (SELECT AVG(overall_score) FROM sessions WHERE user_id = u.id) < 50 
                OR u.id NOT IN (SELECT user_id FROM sessions WHERE created_at >= datetime('now', '-7 days'))
            )
        `).get().count;

        res.json({
            totalStudents,
            sessionsThisWeek,
            avgCohortScore: Math.round(avgCohortScore * 10) / 10,
            atRiskCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/faculty/cohort (faculty auth)
router.get('/cohort', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const students = db.prepare(`
            SELECT u.id, u.name, u.email, 
            (SELECT overall_score FROM sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as latest_score
            FROM users u WHERE u.role = 'student'
        `).all();

        const distribution = [0, 0, 0, 0, 0]; // [0-20, 20-40, 40-60, 60-80, 80-100]
        students.forEach(s => {
            if (s.latest_score === null) return;
            const score = s.latest_score;
            if (score <= 20) distribution[0]++;
            else if (score <= 40) distribution[1]++;
            else if (score <= 60) distribution[2]++;
            else if (score <= 80) distribution[3]++;
            else distribution[4]++;
        });

        res.json({ students, cohortChart: distribution });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/faculty/at-risk (faculty auth)
router.get('/at-risk', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const atRisk = db.prepare(`
            SELECT u.id, u.name, u.email, 
            (SELECT AVG(overall_score) FROM sessions WHERE user_id = u.id) as avg_score,
            (SELECT MAX(created_at) FROM sessions WHERE user_id = u.id) as last_session
            FROM users u 
            WHERE u.role = 'student' 
            AND (
                (SELECT AVG(overall_score) FROM sessions WHERE user_id = u.id) < 50 
                OR u.id NOT IN (SELECT user_id FROM sessions WHERE created_at >= datetime('now', '-7 days'))
            )
        `).all();
        res.json(atRisk);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/faculty/students (faculty auth)
router.get('/students', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const students = db.prepare(`
            SELECT u.id, u.name, u.email, 
            (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) as session_count,
            (SELECT AVG(overall_score) FROM sessions WHERE user_id = u.id) as avg_score
            FROM users u 
            WHERE u.role = 'student'
        `).all();
        res.json(students);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/faculty/student/:id (faculty auth)
router.get('/student/:id', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const student = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ? AND role = 'student'").get(req.params.id);
        if (!student) return res.status(404).json({ error: 'Student not found' });

        const sessions = db.prepare('SELECT s.*, p.title as project_title FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.user_id = ? ORDER BY s.created_at DESC').all(req.params.id);
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(req.params.id);

        res.json({ student, sessions, projects });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/faculty/session-requests (faculty auth)
router.get('/session-requests', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const requests = db.prepare(`
            SELECT sr.*, u.name as student_name 
            FROM session_requests sr 
            JOIN users u ON sr.student_id = u.id 
            WHERE sr.faculty_id = ? AND sr.status = 'pending'
        `).all(req.user.id);
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/faculty/session-requests/:id (faculty auth)
router.patch('/session-requests/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const { action, reason } = req.body;
    const request_id = req.params.id;
    const faculty_id = req.user.id;

    try {
        const request = db.prepare('SELECT * FROM session_requests WHERE id = ? AND faculty_id = ?').get(request_id, faculty_id);
        if (!request) return res.status(404).json({ error: 'Request not found' });

        if (action === 'accept') {
            db.prepare("UPDATE session_requests SET status = 'approved' WHERE id = ?").run(request_id);
            
            // Find latest session for student to link to panel
            const latestSession = db.prepare("SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(request.student_id);
            const sessionId = latestSession ? latestSession.id : 0; // Fallback or handle error

            if (sessionId) {
                db.prepare("INSERT INTO panel_sessions (session_id, faculty_id, student_id, status) VALUES (?, ?, ?, 'scheduled')")
                    .run(sessionId, faculty_id, request.student_id);
            }
            
            db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'panel', 'Session Request Approved', 'Your session request has been approved by the faculty.')")
                .run(request.student_id);
        } else {
            db.prepare("UPDATE session_requests SET status = 'rejected' WHERE id = ?").run(request_id);
            db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'panel', 'Session Request Declined', ?)")
                .run(request.student_id, reason || "No reason provided");
        }

        res.json({ message: `Request ${action}ed successfully` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
