const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const path = require('path');
const fs = require('fs');
const auditService = require('../services/auditService');

const SCORE_DIMS = ['clarity', 'reasoning', 'depth', 'confidence'];

function getPanelSessionByRoom(roomCode) {
    return db.prepare('SELECT * FROM panel_sessions WHERE room_code = ?').get(roomCode);
}

function getCurrentQuestionIndex(session) {
    const questions = JSON.parse(session.panel_questions_json || '[]');
    const idx = questions.findIndex(q => !q.answered);
    return idx >= 0 ? idx : Math.max(questions.length - 1, 0);
}

function computeScoreSummary(scoreRows, facultyCount) {
    const scoreGrid = {};
    scoreRows.forEach(row => {
        scoreGrid[row.faculty_name] = {
            clarity: row.clarity,
            reasoning: row.reasoning,
            depth: row.depth,
            confidence: row.confidence
        };
    });

    const flagged = SCORE_DIMS.filter(dim => {
        const values = scoreRows.map(row => Number(row[dim])).filter(v => Number.isFinite(v));
        if (values.length === 0) return false;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, x) => sum + ((x - mean) ** 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        return stdDev > 1.0;
    });

    return {
        scoreGrid,
        flagged,
        disagreementAlert: flagged.length > 0,
        canClose: scoreRows.length >= facultyCount
    };
}

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

        const latestSession = db.prepare('SELECT id, user_id FROM sessions ORDER BY id DESC LIMIT 1').get();
        if (!latestSession) return res.status(400).json({ error: 'Cannot create room without an existing session record' });
        const studentId = latestSession.user_id || db.prepare("SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 1").get()?.id;
        if (!studentId) return res.status(400).json({ error: 'No student account available to initialize room' });
        const info = db.prepare('INSERT INTO panel_sessions (session_id, faculty_id, student_id, room_code, status, phase) VALUES (?, ?, ?, ?, ?, ?)')
            .run(latestSession.id, faculty_id, studentId, roomCode, 'ongoing', 'waiting');
        
        const sessionId = info.lastInsertRowid;
        auditService.logAction(req.user.id, req.user.email, 'CREATE_PANEL', 'panel_session', sessionId, req, { roomCode });

        res.json({
            success: true,
            data: {
                roomCode,
                sessionId,
                studentInviteUrl: `/panel.html?room=${roomCode}&role=student`,
                teacherInviteUrl: `/panel.html?room=${roomCode}&role=teacher`
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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

        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        res.json({ success: true, data: session });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/participants (auth)
router.get('/room/:roomCode/participants', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const wsApp = req.app.locals.wsApp;
        if (!wsApp) {
            return res.status(500).json({ success: false, error: 'WebSocket service not available' });
        }
        const participants = wsApp.getParticipants(roomCode);
        res.json({ success: true, data: participants });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/question (faculty auth)
router.post('/room/:roomCode/question', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { question } = req.body;
    const teacherName = req.user.name;

    try {
        if (!question || !String(question).trim()) {
            return res.status(400).json({ success: false, error: 'question is required' });
        }
        const session = db.prepare('SELECT id, panel_questions_json FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

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

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'panel-question-added', questions);
        }

        res.json({ success: true, data: questions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/question/:id (faculty auth)
router.patch('/room/:roomCode/question/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode, id } = req.params;
    try {
        const session = db.prepare('SELECT id, panel_questions_json FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const questions = JSON.parse(session.panel_questions_json || '[]');
        const updatedQuestions = questions.map(q => q.id == id ? { ...q, answered: true } : q);

        db.prepare('UPDATE panel_sessions SET panel_questions_json = ? WHERE id = ?')
            .run(JSON.stringify(updatedQuestions), session.id);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'panel-question-answered', updatedQuestions);
        }

        res.json({ success: true, data: updatedQuestions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/phase (faculty auth)
router.patch('/room/:roomCode/phase', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { phase } = req.body;
    const allowedPhases = new Set(['waiting', 'briefing', 'questioning', 'scoring', 'complete']);
    try {
        if (!allowedPhases.has(phase)) return res.status(400).json({ success: false, error: 'Invalid phase' });

        db.prepare('UPDATE panel_sessions SET phase = ? WHERE room_code = ?').run(phase, roomCode);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'phase-change', { phase });
        }

        res.json({ success: true, data: { phase } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/raise-hand (student auth)
router.post('/room/:roomCode/raise-hand', verifyToken, requireRole('student'), (req, res) => {
    const { roomCode } = req.params;
    const { reason } = req.body;
    try {
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const info = db.prepare('INSERT INTO raise_hand_events (panel_session_id, student_id, reason) VALUES (?, ?, ?)')
            .run(session.id, req.user.id, reason || null);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastFacultyRoom(roomCode, 'raise-hand', {
                id: info.lastInsertRowid,
                studentId: req.user.id,
                studentName: req.user.name,
                reason: reason || ''
            });
        }

        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/raise-hand/:id/resolve (faculty)
router.patch('/room/:roomCode/raise-hand/:id/resolve', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode, id } = req.params;
    try {
        const result = db.prepare('UPDATE raise_hand_events SET resolved = 1 WHERE id = ?').run(id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Raise hand event not found' });

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'raise-hand-resolved', { id: Number(id) });
        }

        res.json({ success: true, data: { id: Number(id) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/chat (auth)
router.post('/room/:roomCode/chat', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    const { message, isPrivate } = req.body;
    try {
        if (!message || !String(message).trim()) {
            return res.status(400).json({ success: false, error: 'message is required' });
        }
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const info = db.prepare('INSERT INTO panel_chat (panel_session_id, sender_id, sender_name, message, is_private) VALUES (?, ?, ?, ?, ?)')
            .run(session.id, req.user.id, req.user.name, message, isPrivate ? 1 : 0);

        const savedMessage = {
            id: info.lastInsertRowid,
            sender_id: req.user.id,
            sender_name: req.user.name,
            message,
            is_private: isPrivate ? 1 : 0,
            created_at: new Date().toISOString()
        };

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            if (isPrivate) {
                wsApp.broadcastFacultyRoom(roomCode, 'private-chat', savedMessage);
            } else {
                wsApp.broadcastRoom(roomCode, 'chat-message', savedMessage);
            }
        }

        res.json({ success: true, data: savedMessage });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/chat (auth)
router.get('/room/:roomCode/chat', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT id FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        let chat;
        if (req.user.role === 'faculty') {
            chat = db.prepare('SELECT * FROM panel_chat WHERE panel_session_id = ? ORDER BY created_at ASC').all(session.id);
        } else {
            chat = db.prepare('SELECT * FROM panel_chat WHERE panel_session_id = ? AND is_private = 0 ORDER BY created_at ASC').all(session.id);
        }

        res.json({ success: true, data: chat });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/transcript (auth)
router.post('/room/:roomCode/transcript', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    const { chunk, isFinal } = req.body;
    try {
        if (typeof chunk !== 'string' || chunk.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'chunk is required' });
        }
        db.prepare("UPDATE panel_sessions SET full_transcript = COALESCE(full_transcript, '') || ? WHERE room_code = ?")
            .run(chunk, roomCode);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'transcript-chunk', {
                chunk,
                isFinal: !!isFinal
            });
        }

        res.json({ success: true, data: { message: 'Chunk added' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/rubric (auth)
router.get('/room/:roomCode/rubric', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT rubric_url FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session || !session.rubric_url) return res.status(404).json({ success: false, error: 'Rubric not found' });

        const filePath = path.join(__dirname, '..', 'public', session.rubric_url);
        if (fs.existsSync(filePath)) {
            res.contentType("application/pdf");
            res.sendFile(filePath);
        } else {
            res.status(404).json({ success: false, error: 'File not found on server' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/pause (faculty auth)
router.patch('/room/:roomCode/pause', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = db.prepare('SELECT is_paused FROM panel_sessions WHERE room_code = ?').get(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });
        const newStatus = session.is_paused ? 0 : 1;
        db.prepare('UPDATE panel_sessions SET is_paused = ? WHERE room_code = ?').run(newStatus, roomCode);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, newStatus ? 'session-paused' : 'session-resumed', { isPaused: !!newStatus });
        }

        res.json({ success: true, data: { isPaused: !!newStatus } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/room/:roomCode/timer (faculty auth)
router.patch('/room/:roomCode/timer', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { seconds } = req.body;
    try {
        if (!Number.isInteger(seconds) || seconds < 1) {
            return res.status(400).json({ success: false, error: 'seconds must be a positive integer' });
        }
        db.prepare('UPDATE panel_sessions SET time_per_question = ? WHERE room_code = ?').run(seconds, roomCode);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            wsApp.broadcastRoom(roomCode, 'timer-set', { seconds });
        }

        res.json({ success: true, data: { seconds } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/score (faculty auth)
router.post('/room/:roomCode/score', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { clarity, reasoning, depth, confidence, questionIndex } = req.body;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const resolvedQuestionIndex = Number.isInteger(questionIndex) ? questionIndex : getCurrentQuestionIndex(session);
        const values = [clarity, reasoning, depth, confidence].map(Number);
        if (values.some(v => !Number.isInteger(v) || v < 1 || v > 5)) {
            return res.status(400).json({ success: false, error: 'Scores must be integers from 1 to 5' });
        }

        db.prepare(`
            INSERT INTO panel_scores (panel_session_id, faculty_id, faculty_name, question_index, clarity, reasoning, depth, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(session.id, req.user.id, req.user.name, resolvedQuestionIndex, ...values);

        const scoreRows = db.prepare(`
            SELECT faculty_id, faculty_name, clarity, reasoning, depth, confidence
            FROM panel_scores
            WHERE panel_session_id = ? AND question_index = ?
            ORDER BY created_at ASC
        `).all(session.id, resolvedQuestionIndex);

        const facultyCount = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as total
            FROM panel_attendance
            WHERE panel_session_id = ? AND role IN ('faculty','teacher')
        `).get(session.id).total || 1;

        const summary = computeScoreSummary(scoreRows, facultyCount);
        const payload = { questionIndex: resolvedQuestionIndex, ...summary };
        const wsApp = req.app.locals.wsApp;
        if (wsApp) wsApp.broadcastRoom(roomCode, 'score-update', payload);

        res.json({ success: true, data: payload });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/scores (auth)
router.get('/room/:roomCode/scores', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const qIndex = getCurrentQuestionIndex(session);
        const scoreRows = db.prepare(`
            SELECT faculty_id, faculty_name, clarity, reasoning, depth, confidence
            FROM panel_scores
            WHERE panel_session_id = ? AND question_index = ?
            ORDER BY created_at ASC
        `).all(session.id, qIndex);

        const facultyCount = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as total
            FROM panel_attendance
            WHERE panel_session_id = ? AND role IN ('faculty','teacher')
        `).get(session.id).total || 1;

        res.json({ success: true, data: { questionIndex: qIndex, ...computeScoreSummary(scoreRows, facultyCount) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/whiteboard (faculty auth)
router.post('/room/:roomCode/whiteboard', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { eventType, data } = req.body;
    const allowed = new Set(['draw', 'erase', 'clear', 'text', 'shape']);
    try {
        if (!allowed.has(eventType)) return res.status(400).json({ success: false, error: 'Invalid eventType' });
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const info = db.prepare(`
            INSERT INTO whiteboard_events (panel_session_id, faculty_id, event_type, data_json)
            VALUES (?, ?, ?, ?)
        `).run(session.id, req.user.id, eventType, JSON.stringify(data || {}));

        const payload = { id: info.lastInsertRowid, eventType, data: data || {}, facultyId: req.user.id };
        const wsApp = req.app.locals.wsApp;
        if (wsApp) wsApp.broadcastRoom(roomCode, 'whiteboard-event', payload);
        res.json({ success: true, data: payload });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/whiteboard (auth)
router.get('/room/:roomCode/whiteboard', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });
        const events = db.prepare(`
            SELECT id, event_type, data_json, created_at
            FROM whiteboard_events
            WHERE panel_session_id = ?
            ORDER BY id ASC
        `).all(session.id).map(row => ({
            id: row.id,
            eventType: row.event_type,
            data: JSON.parse(row.data_json || '{}'),
            createdAt: row.created_at
        }));
        res.json({ success: true, data: events });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/breakout (faculty auth)
router.post('/room/:roomCode/breakout', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    const { roomName, facultyIds } = req.body;
    try {
        const ids = Array.isArray(facultyIds) ? facultyIds.map(Number).filter(Number.isFinite) : [];
        if (!roomName || ids.length === 0) return res.status(400).json({ success: false, error: 'roomName and facultyIds required' });
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const uniqueIds = Array.from(new Set([...ids, req.user.id]));
        const info = db.prepare(`
            INSERT INTO breakout_rooms (panel_session_id, room_name, faculty_ids_json)
            VALUES (?, ?, ?)
        `).run(session.id, roomName, JSON.stringify(uniqueIds));

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            uniqueIds.forEach(uid => {
                wsApp.notifyUser(uid, {
                    type: 'breakout-created',
                    payload: { breakoutId: info.lastInsertRowid, roomName, facultyIds: uniqueIds, roomCode }
                });
            });
        }
        res.json({ success: true, data: { breakoutId: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/breakout/:id/message (faculty auth)
router.post('/breakout/:id/message', verifyToken, requireRole('faculty'), (req, res) => {
    const breakoutId = Number(req.params.id);
    const { message } = req.body;
    try {
        if (!message || !String(message).trim()) return res.status(400).json({ success: false, error: 'message required' });
        const breakout = db.prepare('SELECT * FROM breakout_rooms WHERE id = ? AND closed_at IS NULL').get(breakoutId);
        if (!breakout) return res.status(404).json({ success: false, error: 'Breakout not found' });

        const facultyIds = JSON.parse(breakout.faculty_ids_json || '[]');
        if (!facultyIds.includes(req.user.id)) return res.status(403).json({ success: false, error: 'Not in breakout room' });

        const messages = JSON.parse(breakout.messages_json || '[]');
        const msg = { senderId: req.user.id, senderName: req.user.name, message, sentAt: new Date().toISOString() };
        messages.push(msg);
        db.prepare('UPDATE breakout_rooms SET messages_json = ? WHERE id = ?').run(JSON.stringify(messages), breakoutId);

        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            facultyIds.forEach(uid => {
                wsApp.notifyUser(uid, { type: 'breakout-message', payload: { breakoutId, ...msg } });
            });
        }
        res.json({ success: true, data: msg });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/panel/breakout/:id (faculty auth)
router.delete('/breakout/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const breakoutId = Number(req.params.id);
    if (!breakoutId) return res.status(400).json({ success: false, error: 'Invalid breakout ID' });
    try {
        const breakout = db.prepare('SELECT * FROM breakout_rooms WHERE id = ? AND closed_at IS NULL').get(breakoutId);
        if (!breakout) return res.status(404).json({ success: false, error: 'Breakout not found' });

        const facultyIds = JSON.parse(breakout.faculty_ids_json || '[]');
        if (!facultyIds.includes(req.user.id)) return res.status(403).json({ success: false, error: 'Not in breakout room' });

        db.prepare("UPDATE breakout_rooms SET closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(breakoutId);
        const wsApp = req.app.locals.wsApp;
        if (wsApp) {
            facultyIds.forEach(uid => wsApp.notifyUser(uid, { type: 'breakout-closed', payload: { breakoutId } }));
        }
        res.json({ success: true, data: { message: 'Breakout closed' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/panel/room/:roomCode/attendance (auth)
router.post('/room/:roomCode/attendance', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });

        const info = db.prepare(`
            INSERT INTO panel_attendance (panel_session_id, user_id, user_name, role)
            VALUES (?, ?, ?, ?)
        `).run(session.id, req.user.id, req.user.name, req.user.role);
        auditService.logAction(req.user.id, req.user.email, 'JOIN_PANEL', 'panel_session', session.id, req, { roomCode });
        res.json({ success: true, data: { attendanceId: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/panel/attendance/:id/leave (auth)
router.patch('/attendance/:id/leave', verifyToken, (req, res) => {
    const attendanceId = Number(req.params.id);
    if (!attendanceId) return res.status(400).json({ success: false, error: 'Invalid attendance ID' });
    try {
        const row = db.prepare('SELECT * FROM panel_attendance WHERE id = ? AND user_id = ?').get(attendanceId, req.user.id);
        if (!row) return res.status(404).json({ success: false, error: 'Attendance entry not found' });
        db.prepare(`
            UPDATE panel_attendance
            SET left_at = CURRENT_TIMESTAMP,
                total_minutes = CAST((julianday(CURRENT_TIMESTAMP) - julianday(joined_at)) * 24 * 60 AS INTEGER)
            WHERE id = ?
        `).run(attendanceId);
        auditService.logAction(req.user.id, req.user.email, 'END_PANEL', 'panel_attendance', attendanceId, req, {});
        res.json({ success: true, data: { message: 'Leave recorded' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/attendance (faculty auth)
router.get('/room/:roomCode/attendance', verifyToken, requireRole('faculty'), (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });
        const rows = db.prepare(`
            SELECT id, user_id, user_name, role, joined_at, left_at,
                   COALESCE(total_minutes, CAST((julianday(CURRENT_TIMESTAMP) - julianday(joined_at)) * 24 * 60 AS INTEGER)) as total_minutes
            FROM panel_attendance
            WHERE panel_session_id = ?
            ORDER BY joined_at ASC
        `).all(session.id);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/room/:roomCode/details (auth)
router.get('/room/:roomCode/details', verifyToken, (req, res) => {
    const { roomCode } = req.params;
    try {
        const session = getPanelSessionByRoom(roomCode);
        if (!session) return res.status(404).json({ success: false, error: 'Room not found' });
        const attendance = db.prepare(`
            SELECT user_name, role, joined_at, left_at, total_minutes
            FROM panel_attendance WHERE panel_session_id = ? ORDER BY joined_at ASC
        `).all(session.id);
        const scores = db.prepare(`
            SELECT faculty_name, question_index, clarity, reasoning, depth, confidence
            FROM panel_scores WHERE panel_session_id = ? ORDER BY question_index ASC, created_at ASC
        `).all(session.id);
        const whiteboard = db.prepare(`
            SELECT event_type, data_json, created_at
            FROM whiteboard_events WHERE panel_session_id = ? ORDER BY id ASC
        `).all(session.id).map(row => ({ eventType: row.event_type, data: JSON.parse(row.data_json || '{}'), createdAt: row.created_at }));
        res.json({ success: true, data: { session, attendance, scores, whiteboard } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/panel/session/:sessionId/details (auth)
router.get('/session/:sessionId/details', verifyToken, (req, res) => {
    const { sessionId } = req.params;
    try {
        const panelSession = db.prepare(`
            SELECT * FROM panel_sessions
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT 1
        `).get(sessionId);
        if (!panelSession) return res.status(404).json({ success: false, error: 'Panel session not found' });

        const attendance = db.prepare(`
            SELECT user_name, role, joined_at, left_at, total_minutes
            FROM panel_attendance WHERE panel_session_id = ? ORDER BY joined_at ASC
        `).all(panelSession.id);
        const scores = db.prepare(`
            SELECT faculty_name, question_index, clarity, reasoning, depth, confidence
            FROM panel_scores WHERE panel_session_id = ? ORDER BY question_index ASC, created_at ASC
        `).all(panelSession.id);
        const whiteboard = db.prepare(`
            SELECT event_type, data_json, created_at
            FROM whiteboard_events WHERE panel_session_id = ? ORDER BY id ASC
        `).all(panelSession.id).map(row => ({ eventType: row.event_type, data: JSON.parse(row.data_json || '{}'), createdAt: row.created_at }));
        res.json({ success: true, data: { panelSession, attendance, scores, whiteboard } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Original routes preserved
router.post('/request', verifyToken, requireRole('student'), (req, res) => {
    const { faculty_id, message } = req.body;
    const student_id = req.user.id;
    if (!faculty_id) return res.status(400).json({ success: false, error: 'faculty_id is required' });
    try {
        const info = db.prepare('INSERT INTO session_requests (student_id, faculty_id, message) VALUES (?, ?, ?)')
            .run(student_id, faculty_id, message || null);
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'panel_request', 'New Session Request', ?)")
            .run(faculty_id, `Student ${req.user.name} has requested a mock defense session.`);
        res.json({ success: true, data: { id: info.lastInsertRowid, message: "Request sent" } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/sessions/:id/annotations', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;
    const faculty_id = req.user.id;
    const { question_index, note, score_override } = req.body;
    if (question_index === undefined) return res.status(400).json({ success: false, error: 'question_index is required' });
    try {
        db.prepare('INSERT INTO panel_annotations (panel_session_id, faculty_id, question_index, note, score_override) VALUES (?, ?, ?, ?, ?)')
            .run(panel_session_id, faculty_id, question_index, note || null, score_override || null);
        res.json({ success: true, data: { message: "Annotation saved" } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/sessions/:id/report', verifyToken, requireRole('faculty'), (req, res) => {
    const panel_session_id = req.params.id;
    try {
        const panel = db.prepare('SELECT * FROM panel_sessions WHERE id = ?').get(panel_session_id);
        if (!panel) return res.status(404).json({ success: false, error: "Panel session not found" });
        const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(panel.session_id);
        const annotations = db.prepare('SELECT * FROM panel_annotations WHERE panel_session_id = ?').all(panel_session_id);
        auditService.logAction(req.user.id, req.user.email, 'EXPORT_REPORT', 'panel_session', panel_session_id, req, {});
        res.json({ success: true, data: { panel, answers, annotations } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
