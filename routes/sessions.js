const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const auditService = require('../services/auditService');
const badgeService = require('../services/badgeService');
const pdfService = require('../services/pdfService');

// POST /api/sessions (auth required)
router.post('/', verifyToken, (req, res) => {
    const { project_id } = req.body;
    const user_id = req.user.id;

    if (!project_id) {
        return res.status(400).json({ error: 'Project ID is required' });
    }

    try {
        const info = db.prepare("INSERT INTO sessions (user_id, project_id, status) VALUES (?, ?, 'active')").run(user_id, project_id);
        auditService.logAction(req.user.id, req.user.email, 'CREATE_SESSION', 'session', info.lastInsertRowid, req, { project_id });
        res.status(201).json({ id: info.lastInsertRowid, user_id, project_id, status: 'active' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions (auth required)
router.get('/', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const sessions = db.prepare(`
            SELECT s.*, p.title as project_title 
            FROM sessions s 
            JOIN projects p ON s.project_id = p.id 
            WHERE s.user_id = ? 
            ORDER BY s.created_at DESC
        `).all(user_id);
        auditService.logAction(req.user.id, req.user.email, 'VIEW_SESSION', 'session', null, req, { list: true });
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions/:id (auth required)
router.get('/:id', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const session_id = req.params.id;
    try {
        const session = db.prepare('SELECT s.*, p.title as project_title FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.id = ? AND s.user_id = ?').get(session_id, user_id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(session_id);
        auditService.logAction(req.user.id, req.user.email, 'VIEW_SESSION', 'session', session_id, req, {});
        res.json({ ...session, answers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:id/answers (auth required)
router.post('/:id/answers', verifyToken, (req, res) => {
    const session_id = req.params.id;
    const { question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback } = req.body;

    try {
        const info = db.prepare(`
            INSERT INTO answers (session_id, question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(session_id, question, answer, tier, clarity_score, reasoning_score, depth_score, confidence_score, feedback);
        
        res.status(201).json({ id: info.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/sessions/:id (auth required)
router.patch('/:id', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const session_id = req.params.id;
    const { status, overall_score } = req.body;

    try {
        const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(session_id, user_id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        let query = 'UPDATE sessions SET ';
        const params = [];
        if (status) {
            query += 'status = ?, ';
            params.push(status);
        }
        if (overall_score !== undefined) {
            query += 'overall_score = ?, ';
            params.push(overall_score);
        }
        query = query.slice(0, -2) + ' WHERE id = ?';
        params.push(session_id);

        db.prepare(query).run(...params);
        if (status === 'completed') {
            const averages = db.prepare(`
                SELECT
                    AVG(clarity_score) AS clarity_avg,
                    AVG(reasoning_score) AS reasoning_avg,
                    AVG(depth_score) AS depth_avg,
                    AVG(confidence_score) AS confidence_avg
                FROM answers
                WHERE session_id = ?
            `).get(session_id);
            db.prepare(`
                INSERT INTO dimension_history (user_id, session_id, clarity_avg, reasoning_avg, depth_avg, confidence_avg)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(user_id, session_id, averages.clarity_avg || 0, averages.reasoning_avg || 0, averages.depth_avg || 0, averages.confidence_avg || 0);

            const goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? AND achieved = 0').all(user_id);
            for (const goal of goals) {
                const key = `${goal.dimension}_avg`;
                const current = Number(averages[key] || 0);
                const achieved = current >= Number(goal.target_score || 0);
                db.prepare('UPDATE user_goals SET current_score = ?, achieved = ?, achieved_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE achieved_at END WHERE id = ?')
                    .run(current, achieved ? 1 : 0, achieved ? 1 : 0, goal.id);
            }
            badgeService.checkAndAward(user_id);
        }
        res.json({ message: 'Session updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:id/bookmark
router.post('/:id/bookmark', verifyToken, (req, res) => {
    const { questionIndex, questionText, note } = req.body;
    db.prepare(`
        INSERT INTO bookmarks (user_id, session_id, question_index, question_text, note)
        VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, req.params.id, Number(questionIndex), questionText || '', note || '');
    res.json({ success: true });
});

// DELETE /api/sessions/:id/bookmark/:questionIndex
router.delete('/:id/bookmark/:questionIndex', verifyToken, (req, res) => {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND session_id = ? AND question_index = ?')
        .run(req.user.id, req.params.id, Number(req.params.questionIndex));
    res.json({ success: true });
});

// GET /api/bookmarks
router.get('/bookmarks/all', verifyToken, (req, res) => {
    const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(req.user.id);
    res.json(rows);
});

// POST /api/sessions/:id/note
router.post('/:id/note', verifyToken, (req, res) => {
    const { questionIndex, note } = req.body;
    const existing = db.prepare(`
        SELECT id FROM question_notes
        WHERE user_id = ? AND session_id = ? AND question_index = ?
    `).get(req.user.id, req.params.id, Number(questionIndex));
    if (existing) {
        db.prepare('UPDATE question_notes SET note = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?').run(note || '', existing.id);
    } else {
        db.prepare('INSERT INTO question_notes (user_id, session_id, question_index, note) VALUES (?, ?, ?, ?)')
            .run(req.user.id, req.params.id, Number(questionIndex), note || '');
    }
    res.json({ success: true });
});

// GET /api/sessions/:id/notes
router.get('/:id/notes', verifyToken, (req, res) => {
    const rows = db.prepare('SELECT * FROM question_notes WHERE user_id = ? AND session_id = ? ORDER BY question_index ASC')
        .all(req.user.id, req.params.id);
    res.json(rows);
});

// GET /api/sessions/:id/export-pdf
router.get('/:id/export-pdf', verifyToken, async (req, res) => {
    try {
        const pdf = await pdfService.generateSessionReport(req.params.id, req.user.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=session.pdf');
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/student/export-report
router.get('/student/export-report/full', verifyToken, async (req, res) => {
    try {
        const pdf = await pdfService.generateStudentReport(req.user.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=progress-report.pdf');
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
