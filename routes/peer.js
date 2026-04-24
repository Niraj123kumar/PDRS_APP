const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function makeRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(0, chars.length)];
    return s;
}

async function askAI(systemPrompt, userPrompt) {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.6
    });
    return response.content[0].text;
}

function parseJSON(raw) {
    const clean = String(raw).replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
}

async function generatePeerQuestions(project) {
    const system = 'You are a technical interview expert. Return ONLY valid JSON array. No markdown.';
    const user = `Generate ${6} short interview questions for a peer practice session.
Project title: ${project.title}
Description: ${project.description || 'N/A'}
Tech: ${project.tech_stack || 'N/A'}
Return a JSON array of objects: { "question": string, "tier": 1|2|3, "tier_label": string, "modelAnswer": string, "keyPoints": string[] }.
Use 2 tier-1, 2 tier-2, 2 tier-3 questions.`;
    const raw = await askAI(system, user);
    const parsed = parseJSON(raw);
    if (!Array.isArray(parsed) || parsed.length < 4) throw new Error('Invalid questions from AI');
    return parsed.slice(0, 6).map((q) => ({
        question: String(q.question || '').slice(0, 2000),
        tier: q.tier || 1,
        tier_label: q.tier_label || 'Question',
        modelAnswer: q.modelAnswer || '',
        keyPoints: Array.isArray(q.keyPoints) ? q.keyPoints.slice(0, 3) : []
    }));
}

async function scoreAnswer(question, answer) {
    const system = 'You are a strict academic evaluator. Return ONLY raw JSON. No markdown.';
    const user = `Score this answer from 0 to 100 for each dimension. 
    Question: ${question}
    Answer: ${String(answer).slice(0, 8000)}
    Return exactly: 
    { "clarity": number, "reasoning": number, "depth": number, "confidence": number, "feedback": "one sentence" }`;
    const raw = await askAI(system, user);
    const p = parseJSON(raw);
    ['clarity', 'reasoning', 'depth', 'confidence'].forEach((d) => {
        let s = parseFloat(p[d]);
        if (Number.isNaN(s)) s = 0;
        p[d] = Math.min(100, Math.max(0, s));
    });
    return p;
}

function loadAnswers(ps) {
    try {
        return ps.answers_json ? JSON.parse(ps.answers_json) : {};
    } catch (e) {
        return {};
    }
}

// POST /api/peer/create
router.post('/create', verifyToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.id;
        const project = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
        if (!project) return res.status(400).json({ error: 'Create a project first' });

        let room;
        for (let i = 0; i < 8; i++) {
            const code = makeRoomCode();
            const ex = db.prepare('SELECT 1 FROM peer_sessions WHERE room_code = ?').get(code);
            if (!ex) { room = code; break; }
        }
        if (!room) return res.status(500).json({ error: 'Could not allocate room' });

        const questions = await generatePeerQuestions(project);
        const info = db.prepare(`
            INSERT INTO peer_sessions (student_a_id, room_code, status, questions_json, answers_json, current_question_index, ready_a, ready_b)
            VALUES (?, ?, 'waiting', ?, '{}', 0, 0, 0)
        `).run(userId, room, JSON.stringify(questions));

        const base = (process.env.APP_URL || (req.get('x-forwarded-proto') ? `${req.get('x-forwarded-proto')}://${req.get('host')}` : `http://${req.get('host') || 'localhost:3000'}`));
        res.status(201).json({
            roomCode: room,
            inviteUrl: `${base}/peer.html?room=${room}`,
            sessionId: info.lastInsertRowid,
            questions
        });
    } catch (err) {
        console.error('peer create', err);
        res.status(500).json({ error: 'Failed to create peer room' });
    }
});

// POST /api/peer/join/:roomCode
router.post('/join/:roomCode', verifyToken, requireRole('student'), (req, res) => {
    try {
        const { roomCode } = req.params;
        const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(roomCode);
        if (!ps) return res.status(404).json({ error: 'Room not found' });
        const uid = req.user.id;

        if (ps.student_a_id === uid) {
            return res.status(400).json({ error: "Cannot join your own room" });
        }

        if (ps.student_b_id && ps.student_b_id !== uid) {
            return res.status(400).json({ error: 'Room is full' });
        }
        if (!ps.student_b_id) {
            db.prepare("UPDATE peer_sessions SET student_b_id = ?, status = 'active' WHERE id = ?").run(uid, ps.id);
        }
        const updated = db.prepare('SELECT * FROM peer_sessions WHERE id = ?').get(ps.id);
        const wasEmpty = !ps.student_b_id;
        const targetA = ps.student_a_id;
        const wsApp = req.app.locals.wsApp;
        if (wsApp && wasEmpty) {
            const un = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
            wsApp.notifyUser(targetA, {
                type: 'peer-join',
                payload: { roomCode, joinedBy: uid, name: (un && un.name) || 'Student' }
            });
        }
        res.json(serializeSession(updated, uid));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/peer/:roomCode/ready
router.post('/:roomCode/ready', verifyToken, requireRole('student'), (req, res) => {
    try {
        const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(req.params.roomCode);
        if (!ps) return res.status(404).json({ error: 'Not found' });
        const uid = req.user.id;
        if (ps.student_a_id !== uid && ps.student_b_id !== uid) return res.status(403).json({ error: 'Not in room' });
        if (ps.student_a_id === uid) {
            db.prepare('UPDATE peer_sessions SET ready_a = 1 WHERE id = ?').run(ps.id);
        } else {
            db.prepare('UPDATE peer_sessions SET ready_b = 1 WHERE id = ?').run(ps.id);
        }
        const u = db.prepare('SELECT * FROM peer_sessions WHERE id = ?').get(ps.id);
        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            const room = ps.room_code;
            wsApp.broadcastRoom(room, 'peer-ready', { roomCode: room, readyA: !!u.ready_a, readyB: !!u.ready_b, both: !!(u.ready_a && u.ready_b) });
        }
        if (u.ready_a && u.ready_b && u.status !== 'in_progress') {
            db.prepare("UPDATE peer_sessions SET status = 'in_progress' WHERE id = ?").run(ps.id);
        }
        res.json(serializeSession(db.prepare('SELECT * FROM peer_sessions WHERE id = ?').get(ps.id), uid));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/peer/:roomCode/answer — submit answer for current question; scores when both
router.post('/:roomCode/answer', verifyToken, requireRole('student'), async (req, res) => {
    const { roomCode } = req.params;
    const { questionIndex, answer } = req.body;
    const idx = Math.max(0, parseInt(questionIndex, 10) || 0);
    const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(roomCode);
    if (!ps) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    if (ps.student_a_id !== uid && ps.student_b_id !== uid) return res.status(403).json({ error: 'Not in room' });
    if (!ps.student_b_id) return res.status(400).json({ error: 'Waiting for partner' });

    const qlist = (() => {
        try {
            return ps.questions_json ? JSON.parse(ps.questions_json) : [];
        } catch (e) {
            return [];
        }
    })();
    if (!qlist[idx]) return res.status(400).json({ error: 'Invalid question' });

    const data = loadAnswers(ps);
    const key = String(idx);
    if (!data[key]) data[key] = { a: null, b: null, scoreA: null, scoreB: null, scored: false };
    const isA = ps.student_a_id === uid;
    if (isA) data[key].a = String(answer || '');
    else data[key].b = String(answer || '');

    db.prepare('UPDATE peer_sessions SET answers_json = ?, current_question_index = ? WHERE id = ?')
        .run(JSON.stringify(data), idx, ps.id);

    const wsApp = req.app.locals.wsApp;
    if (wsApp) {
        wsApp.broadcastRoom(roomCode, 'peer-answer-submitted', { roomCode, questionIndex: idx, from: uid, side: isA ? 'A' : 'B' });
    }

    const slot = data[key];
    const both = slot.a && slot.b && String(slot.a).length && String(slot.b).length;
    if (both && !slot.scored) {
        const qText = qlist[idx].question;
        try {
            const [sA, sB] = await Promise.all([scoreAnswer(qText, slot.a), scoreAnswer(qText, slot.b)]);
            slot.scoreA = sA;
            slot.scoreB = sB;
            slot.scored = true;
        } catch (e) {
            return res.status(500).json({ error: 'Scoring failed' });
        }
        db.prepare('UPDATE peer_sessions SET answers_json = ? WHERE id = ?').run(JSON.stringify(data), ps.id);
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'peer-both-submitted', { roomCode, questionIndex: idx, scores: { A: slot.scoreA, B: slot.scoreB } });
            wsApp.broadcastRoom(roomCode, 'peer-scores', { roomCode, questionIndex: idx, scoreA: slot.scoreA, scoreB: slot.scoreB });
        }
    }

    const fresh = db.prepare('SELECT * FROM peer_sessions WHERE id = ?').get(ps.id);
    res.json(serializeSession(fresh, uid, data));
});

function namesFor(sid) {
    if (sid == null) return 'Peer';
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(sid);
    return (u && u.name) || `User ${sid}`;
}

function serializeSession(ps, viewerId, preParsed) {
    const q = (() => {
        try {
            return ps.questions_json ? JSON.parse(ps.questions_json) : [];
        } catch (e) {
            return [];
        }
    })();
    const a = preParsed != null && typeof preParsed === 'object' ? preParsed : loadAnswers(ps);
    return {
        id: ps.id,
        roomCode: ps.room_code,
        status: ps.status,
        currentQuestionIndex: ps.current_question_index,
        questions: q,
        studentA: ps.student_a_id,
        studentB: ps.student_b_id,
        nameA: namesFor(ps.student_a_id),
        nameB: namesFor(ps.student_b_id),
        readyA: !!ps.ready_a,
        readyB: !!ps.ready_b,
        answers: a,
        isViewerA: ps.student_a_id === viewerId,
        isViewerB: ps.student_b_id === viewerId
    };
}

// POST /api/peer/:roomCode/comment
router.post('/:roomCode/comment', verifyToken, requireRole('student'), (req, res) => {
    const { roomCode } = req.params;
    const { questionIndex, comment } = req.body;
    const idx = Math.max(0, parseInt(questionIndex, 10) || 0);
    const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(roomCode);
    if (!ps) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    if (ps.student_a_id !== uid && ps.student_b_id !== uid) return res.status(403).json({ error: 'Not in room' });
    const data = loadAnswers(ps);
    const key = String(idx);
    if (!data[key]) return res.status(400).json({ error: 'No question' });
    const field = ps.student_a_id === uid ? 'commentA' : 'commentB';
    data[key][field] = String(comment || '');
    db.prepare('UPDATE peer_sessions SET answers_json = ? WHERE id = ?').run(JSON.stringify(data), ps.id);
    res.json({ success: true });
});

// advance question (optional)
router.post('/:roomCode/next', verifyToken, requireRole('student'), (req, res) => {
    const { roomCode } = req.params;
    const { questionIndex } = req.body;
    const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(roomCode);
    if (!ps) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    if (ps.student_a_id !== uid && ps.student_b_id !== uid) return res.status(403).json({ error: 'Not in room' });
    const next = questionIndex != null ? parseInt(questionIndex, 10) : ps.current_question_index + 1;
    db.prepare('UPDATE peer_sessions SET current_question_index = ? WHERE id = ?').run(next, ps.id);
    const ws = req.app.locals.wsApp;
    if (ws) ws.broadcastRoom(roomCode, 'peer-question', { roomCode, questionIndex: next });
    const f = db.prepare('SELECT * FROM peer_sessions WHERE id = ?').get(ps.id);
    res.json(serializeSession(f, uid));
});

// GET /api/peer/:roomCode (keep last: generic :roomCode)
router.get('/:roomCode', verifyToken, (req, res) => {
    try {
        const ps = db.prepare('SELECT * FROM peer_sessions WHERE room_code = ?').get(req.params.roomCode);
        if (!ps) return res.status(404).json({ error: 'Not found' });
        const uid = req.user.id;
        const isParticipant = ps.student_a_id === uid || ps.student_b_id === uid;
        if (!isParticipant && req.user.role === 'student') {
            return res.status(403).json({ error: 'Not a participant' });
        }
        const viewAs = (req.user.role === 'faculty' || req.user.role === 'admin') ? ps.student_a_id : uid;
        res.json(serializeSession(ps, viewAs));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
