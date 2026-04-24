const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const auditService = require('../services/auditService');
const badgeService = require('../services/badgeService');
const pdfService = require('../services/pdfService');
const cacheService = require('../services/cacheService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseAIJson(raw) {
    const c = String(raw).replace(/```json|```/g, '').trim();
    return JSON.parse(c);
}

async function claudeAsk(system, user) {
    const r = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
        temperature: 0.35
    });
    return r.content[0].text;
}

// POST /api/sessions (auth required)
router.post('/', verifyToken, (req, res) => {
    const { project_id } = req.body;
    const user_id = req.user.id;

    if (!project_id) {
        return res.status(400).json({ error: 'Project ID is required' });
    }

    try {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(project_id, user_id);
        if (!project) return res.status(403).json({ error: "Project not yours" });

        const info = db.prepare("INSERT INTO sessions (user_id, project_id, status) VALUES (?, ?, 'active')").run(user_id, project_id);
        auditService.logAction(req.user.id, req.user.email, 'CREATE_SESSION', 'session', info.lastInsertRowid, req, { project_id });
        
        // Invalidate faculty cache
        cacheService.invalidatePattern('faculty:stats:*');
        cacheService.invalidatePattern('cohort:chart:*');
        
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

// POST /api/sessions/from-template/:templateId
router.post('/from-template/:templateId', verifyToken, (req, res) => {
    try {
        const t = db.prepare('SELECT * FROM session_templates WHERE id = ? AND user_id = ?').get(req.params.templateId, req.user.id);
        if (!t) return res.status(404).json({ error: 'Template not found' });
        const info = db.prepare(`
            INSERT INTO sessions (user_id, project_id, status, questions_json)
            VALUES (?, ?, 'active', ?)
        `).run(req.user.id, t.project_id, t.questions_json || '[]');
        let questions = [];
        try {
            questions = JSON.parse(t.questions_json || '[]');
        } catch (e) { /* */ }
        res.status(201).json({
            id: info.lastInsertRowid,
            user_id: req.user.id,
            project_id: t.project_id,
            status: 'active',
            questions
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:id/save-replay
router.post('/:id/save-replay', verifyToken, (req, res) => {
    const session_id = req.params.id;
    const { replayData, timeStamps } = req.body;
    try {
        const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(session_id, req.user.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        db.prepare('UPDATE sessions SET replay_data_json = ?, time_stamps_json = ? WHERE id = ?').run(
            JSON.stringify(replayData != null ? replayData : []),
            JSON.stringify(timeStamps != null ? timeStamps : []),
            session_id
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions/:id/replay
router.get('/:id/replay', verifyToken, (req, res) => {
    const session_id = req.params.id;
    try {
        const session = db.prepare(`
            SELECT s.*, p.title AS project_title
            FROM sessions s JOIN projects p ON p.id = s.project_id
            WHERE s.id = ? AND s.user_id = ?
        `).get(session_id, req.user.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        let replay = [];
        let timeStamps = [];
        try {
            replay = session.replay_data_json ? JSON.parse(session.replay_data_json) : [];
        } catch (e) { /* */ }
        try {
            timeStamps = session.time_stamps_json ? JSON.parse(session.time_stamps_json) : [];
        } catch (e) { /* */ }
        res.json({
            session: {
                id: session.id,
                project_title: session.project_title,
                status: session.status,
                overall_score: session.overall_score,
                created_at: session.created_at,
                summary_pdf_url: session.summary_pdf_url || null
            },
            replay,
            timeStamps
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:id/summarize
router.post('/:id/summarize', verifyToken, async (req, res) => {
    const session_id = req.params.id;
    try {
        const session = db.prepare('SELECT s.*, p.title AS project_title FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.user_id = ?')
            .get(session_id, req.user.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY id ASC').all(session_id);
        const lines = answers.map((a, i) => `Q${i + 1}: ${a.question}\nAnswer: ${a.answer}\nScores C/R/D/F: ${a.clarity_score}/${a.reasoning_score}/${a.depth_score}/${a.confidence_score}\nFeedback: ${a.feedback || ''}`).join('\n\n');
        const system = 'You are an academic coach. Return ONLY valid JSON, no markdown.';
        const user = `Summarize this defense rehearsal session.\n${lines}\n\nReturn JSON with keys:
overallParagraph (string),
dimensionAnalysis (string, 2-4 sentences covering clarity, reasoning, depth, confidence),
strengths (array of 3 strings),
improvements (array of 3 strings),
nextSteps (array of 3 strings)`;
        const raw = await claudeAsk(system, user);
        const summary = parseAIJson(raw);
        const buffer = await pdfService.generateSessionSummaryPdf(summary);
        const url = await pdfService.writeSessionSummaryPdf(session_id, buffer);
        db.prepare('UPDATE sessions SET summary_pdf_url = ? WHERE id = ?').run(url, session_id);
        res.json({ summaryUrl: url, summary });
    } catch (err) {
        console.error('summarize', err);
        res.status(500).json({ error: 'Failed to generate summary' });
    }
});

// POST /api/sessions/:id/hint
router.post('/:id/hint', verifyToken, async (req, res) => {
    const session_id = req.params.id;
    const { questionIndex, questionText, tier } = req.body;
    const qIdx = Math.max(0, parseInt(questionIndex, 10) || 0);
    try {
        const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(session_id, req.user.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        let state = {};
        try {
            state = session.hints_state_json ? JSON.parse(session.hints_state_json) : {};
        } catch (e) { /* */ }
        const key = String(qIdx);
        const used = Number(state[key] || 0);
        if (used >= 3) return res.status(400).json({ error: 'No hints left for this question' });
        const system = 'You are a technical interview coach. Return ONLY valid JSON, no markdown.';
        const user = `For this interview question, give exactly 3 short hints (not full answers) as JSON:
{ "keyConcept": "one sentence on a core idea to address",
  "example": "one sentence suggesting an example structure",
  "commonMistake": "one sentence on a common pitfall" }
Question (tier ${tier || '?'}): ${String(questionText || '').slice(0, 2000)}`;
        const raw = await claudeAsk(system, user);
        const hintObj = parseAIJson(raw);
        state[key] = used + 1;
        db.prepare('UPDATE sessions SET hints_state_json = ? WHERE id = ?').run(JSON.stringify(state), session_id);
        const nowUsed = used + 1;
        res.json({ hints: hintObj, used: nowUsed, remaining: Math.max(0, 3 - nowUsed), penaltyPoints: 5 });
    } catch (err) {
        console.error('hint', err);
        res.status(500).json({ error: 'Hint unavailable' });
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
    const { status, overall_score, time_per_question_json, abandoned_at_question } = req.body;

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
        if (time_per_question_json !== undefined) {
            query += 'time_per_question_json = ?, ';
            params.push(typeof time_per_question_json === 'string' ? time_per_question_json : JSON.stringify(time_per_question_json));
        }
        if (abandoned_at_question !== undefined && abandoned_at_question !== null) {
            query += 'abandoned_at_question = ?, ';
            params.push(abandoned_at_question);
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

// POST /api/templates
router.post('/templates', verifyToken, (req, res) => {
    const { name, projectId, questionsJson } = req.body;
    try {
        const info = db.prepare(`
            INSERT INTO session_templates (user_id, name, project_id, questions_json)
            VALUES (?, ?, ?, ?)
        `).run(req.user.id, name, projectId, questionsJson);
        const template = db.prepare('SELECT * FROM session_templates WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(template);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/templates
router.get('/templates', verifyToken, (req, res) => {
    try {
        const templates = db.prepare('SELECT * FROM session_templates WHERE user_id = ?').all(req.user.id);
        res.json(templates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/templates/:id
router.delete('/templates/:id', verifyToken, (req, res) => {
    try {
        db.prepare('DELETE FROM session_templates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
