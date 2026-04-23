const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const path = require('path');
const fs = require('fs');

// POST /api/panel/create-room (faculty auth)
router.post('/create-room', verifyToken, requireRole('faculty'), (req, res) => {
    const faculty_id = req.user.id;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    
    const generateCode = () => {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    };

    try {
        let roomCode;
        let collision = true;
        let attempts = 0;

        while (collision && attempts < 10) {
            roomCode = generateCode();
            const existing = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
            if (!existing) collision = false;
            attempts++;
        }

        if (collision) throw new Error('Failed to generate unique room code');

        const info = db.prepare('INSERT INTO panel_sessions (faculty_id, room_code, status, phase) VALUES (?, ?, ?, ?)')
            .run(faculty_id, roomCode, 'ongoing', 'waiting');
        
        const sessionId = info.lastInsertRowid;

        res.json({
            roomCode,
            sessionId,
            studentInviteUrl: `/panel.html?room=${roomCode}&role=student`,
            teacherInviteUrl: `/panel.html?room=${roomCode}&role=teacher`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/panel/room/:roomCode (auth)
router.get('/room/:roomCode', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare(`
            SELECT ps.*, u.name as faculty_name 
            FROM panel_sessions ps
            JOIN users u ON ps.faculty_id = u.id
            WHERE ps.room_code = ?
        `).get(roomCode);

        if (!session) return res.status(404).json({ error: 'Room not found' });

        res.json(session);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/panel/room/:roomCode/question (faculty auth)
router.post('/room/:roomCode/question', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { question } = req.body;
    const teacherName = req.user.name;

    try {
        const session = db.prepare('SELECT id, panel_questions_json FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ error: 'Room not found' });

        const questions = JSON.parse(session.panel_questions_json || '[]');
        const newQuestion = {
            id: Date.now(),
            teacherName,
            question,
            answered: false,
            addedAt: new Date().toISOString()
        };
        questions.push(newQuestion);

        db.prepare('UPDATE panel_sessions SET panel_questions_json = ? WHERE id = ?')
            .run(JSON.stringify(questions), session.id);

        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/question/:id (faculty auth)
router.patch('/room/:roomCode/question/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode, id } = req.params;
    try {
        const session = db.prepare('SELECT id, panel_questions_json FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ error: 'Room not found' });

        const questions = JSON.parse(session.panel_questions_json || '[]');
        const updatedQuestions = questions.map(q => q.id == id ? { ...q, answered: true } : q);

        db.prepare('UPDATE panel_sessions SET panel_questions_json = ? WHERE id = ?')
            .run(JSON.stringify(updatedQuestions), session.id);

        res.json(updatedQuestions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/phase (faculty auth)
router.patch('/room/:roomCode/phase', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { phase } = req.body;
    try {
        db.prepare('UPDATE panel_sessions SET phase = ? WHERE room_code = ?').run(phase, roomCode);
        res.json({ success: true, phase });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/panel/room/:roomCode/raise-hand (student auth)
router.post('/room/:roomCode/raise-hand', verifyToken, requireRole('student'), (req, res) => {
    const { roomCode } = req.params;
    const { reason } = req.body;
    try {
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ error: 'Room not found' });

        db.prepare('INSERT INTO raise_hand_events (panel_session_id, student_id, reason) VALUES (?, ?, ?)')
            .run(session.id, req.user.id, reason);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/raise-hand/:id/resolve (faculty)
router.patch('/room/:roomCode/raise-hand/:id/resolve', verifyToken, requireRole('faculty'), (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('UPDATE raise_hand_events SET resolved = 1 WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/panel/room/:roomCode/chat (auth)
router.post('/room/:roomCode/chat', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    const { message, isPrivate } = req.body;
    try {
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ error: 'Room not found' });

        const info = db.prepare('INSERT INTO panel_chat (panel_session_id, sender_id, sender_name, message, is_private) VALUES (?, ?, ?, ?, ?)')
            .run(session.id, req.user.id, req.user.name, message, isPrivate ? 1 : 0);

        res.json({
            id: info.lastInsertRowid,
            sender_id: req.user.id,
            sender_name: req.user.name,
            message,
            is_private: isPrivate ? 1 : 0,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/panel/room/:roomCode/chat (auth)
router.get('/room/:roomCode/chat', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ error: 'Room not found' });

        let chat;
        if (req.user.role === 'faculty') {
            chat = db.prepare('SELECT * FROM panel_chat WHERE panel_session_id = ? ORDER BY created_at ASC').all(session.id);
        } else {
            chat = db.prepare('SELECT * FROM panel_chat WHERE panel_session_id = ? AND is_private = 0 ORDER BY created_at ASC').all(session.id);
        }

        res.json(chat);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/panel/room/:roomCode/transcript (auth)
router.post('/room/:roomCode/transcript', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    const { chunk } = req.body;
    try {
        db.prepare("UPDATE panel_sessions SET full_transcript = full_transcript || ? WHERE room_code = ?")
            .run(chunk, roomCode);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/panel/room/:roomCode/rubric (auth)
router.get('/room/:roomCode/rubric', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT rubric_url FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session || !session.rubric_url) return res.status(404).json({ error: 'Rubric not found' });

        const filePath = path.join(__dirname, '..', 'public', session.rubric_url);
        if (fs.existsSync(filePath)) {
            res.contentType("application/pdf");
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: 'File not found on server' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/pause (faculty auth)
router.patch('/room/:roomCode/pause', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT is_paused FROM panel_sessions WHERE room_code = ?').get(roomCode);
        const newStatus = session.is_paused ? 0 : 1;
        db.prepare('UPDATE panel_sessions SET is_paused = ? WHERE room_code = ?').run(newStatus, roomCode);
        res.json({ isPaused: !!newStatus });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/timer (faculty auth)
router.patch('/room/:roomCode/timer', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { seconds } = req.body;
    try {
        db.prepare('UPDATE panel_sessions SET time_per_question = ? WHERE room_code = ?').run(seconds, roomCode);
        res.json({ success: true, seconds });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Original routes preserved
router.post('/request', verifyToken, requireRole('student'), (req, res) => {
    const { faculty_id, message } = req.body;
    const student_id = req.user.id;
    try {
        const info = db.prepare('INSERT INTO session_requests (student_id, faculty_id, message) VALUES (?, ?, ?)')
            .run(student_id, faculty_id, message);
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'panel_request', 'New Session Request', ?)")
            .run(faculty_id, `Student ${req.user.name} has requested a mock defense session.`);
        res.json({ id: info.lastInsertRowid, message: "Request sent" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/sessions/:id/annotations', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;
    const faculty_id = req.user.id;
    const { question_index, note, score_override } = req.body;
    try {
        db.prepare('INSERT INTO panel_annotations (panel_session_id, faculty_id, question_index, note, score_override) VALUES (?, ?, ?, ?, ?)')
            .run(panel_session_id, faculty_id, question_index, note, score_override);
        res.json({ message: "Annotation saved" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/sessions/:id/report', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;
    try {
        const panel = db.prepare('SELECT * FROM panel_sessions WHERE id = ?').get(panel_session_id);
        if (!panel) return res.status(404).json({ error: "Panel session not found" });
        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(panel.session_id);
        const annotations = db.prepare('SELECT * FROM panel_annotations WHERE panel_session_id = ?').all(panel_session_id);
        res.json({ panel, answers, annotations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
