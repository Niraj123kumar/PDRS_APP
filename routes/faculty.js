const express = require('express');
const archiver = require('archiver');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const auditService = require('../services/auditService');
const pushService = require('../services/pushService');
const emailService = require('../services/email');
const pdfService = require('../services/pdfService');
const cacheService = require('../services/cacheService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function csvEscape(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function buildStudentProfile(studentId) {
    const s = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ? AND role = 'student'").get(studentId);
    if (!s) return null;
    const sessions = db.prepare('SELECT s.*, p.title as project_title FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.user_id = ? ORDER BY s.created_at DESC')
        .all(studentId);
    const answers = db.prepare(`
        SELECT a.* FROM answers a
        JOIN sessions s ON s.id = a.session_id
        WHERE s.user_id = ?
    `).all(studentId);
    const dimAvgs = {
        clarity: 0, reasoning: 0, depth: 0, confidence: 0
    };
    if (answers.length) {
        for (const a of answers) {
            dimAvgs.clarity += a.clarity_score || 0;
            dimAvgs.reasoning += a.reasoning_score || 0;
            dimAvgs.depth += a.depth_score || 0;
            dimAvgs.confidence += a.confidence_score || 0;
        }
        const n = answers.length;
        for (const k of Object.keys(dimAvgs)) dimAvgs[k] = Math.round((dimAvgs[k] / n) * 10) / 10;
    }
    return { student: s, sessions, answers, dimAvgs, avgScore: sessions.length
        ? Math.round((sessions.reduce((acc, x) => acc + (Number(x.overall_score) || 0), 0) / sessions.length) * 10) / 10
        : 0
    };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDisplayScore(raw) {
    if (raw == null || Number.isNaN(Number(raw))) return 0;
    return Math.round((Number(raw) / 25) * 10) / 10;
}

function fmtPctChange(curr, prev) {
    if (prev == null || prev === 0) return curr > 0 ? '+100.0%' : '0%';
    const p = ((curr - prev) / prev) * 100;
    return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

// GET /api/faculty/stats (faculty auth)
router.get('/stats', verifyToken, requireRole('faculty'), async (req, res) => {
    try {
        const cacheKey = `faculty:stats:${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.json(cached);

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

        const result = {
            totalStudents,
            sessionsThisWeek,
            avgCohortScore: Math.round(avgCohortScore * 10) / 10,
            atRiskCount
        };

        await cacheService.set(cacheKey, result, 300); // 5 mins
        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/cohort (faculty auth)
router.get('/cohort', verifyToken, requireRole('faculty'), async (req, res) => {
    try {
        const cacheKey = `cohort:chart:${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.json({ success: true, data: cached });

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

        const result = { students, cohortChart: distribution };
        await cacheService.set(cacheKey, result, 300); // 5 mins
        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.json({
            success: true,
            data: atRisk
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.json({
            success: true,
            data: students
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/student/:id (faculty auth)
router.get('/student/:id', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const student = db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ? AND role = 'student'").get(req.params.id);
        if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

        const sessions = db.prepare('SELECT s.*, p.title as project_title FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.user_id = ? ORDER BY s.created_at DESC').all(req.params.id);
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(req.params.id);
        auditService.logAction(req.user.id, req.user.email, 'VIEW_STUDENT', 'student', req.params.id, req, {});

        res.json({
            success: true,
            data: { student, sessions, projects }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.json({
            success: true,
            data: requests
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/faculty/session-requests/:id (faculty auth)
router.patch('/session-requests/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const { action, reason } = req.body;
    const request_id = req.params.id;
    const faculty_id = req.user.id;

    if (!['accept', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Invalid action. Must be accept or reject.' });
    }

    try {
        const request = db.prepare('SELECT * FROM session_requests WHERE id = ? AND faculty_id = ?').get(request_id, faculty_id);
        if (!request) return res.status(404).json({ success: false, error: 'Request not found' });

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

        res.json({
            success: true,
            data: { message: `Request ${action}ed successfully` }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/question-bank (faculty auth)
router.get('/question-bank', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT id, question, category, difficulty, times_used, created_at
            FROM custom_questions
            WHERE faculty_id = ?
            ORDER BY created_at DESC
        `).all(req.user.id);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/faculty/question-bank (faculty auth)
router.post('/question-bank', verifyToken, requireRole('faculty'), (req, res) => {
    const { question, category, difficulty } = req.body;
    const allowed = new Set(['easy', 'medium', 'hard']);
    try {
        if (!question || !String(question).trim()) return res.status(400).json({ success: false, error: 'question is required' });
        const safeDifficulty = allowed.has(difficulty) ? difficulty : 'medium';
        const info = db.prepare(`
            INSERT INTO custom_questions (faculty_id, question, category, difficulty)
            VALUES (?, ?, ?, ?)
        `).run(req.user.id, String(question).trim(), category || null, safeDifficulty);
        const saved = db.prepare('SELECT * FROM custom_questions WHERE id = ?').get(info.lastInsertRowid);
        res.json({ success: true, data: saved });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/faculty/question-bank/:id (faculty auth)
router.delete('/question-bank/:id', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const result = db.prepare('DELETE FROM custom_questions WHERE id = ? AND faculty_id = ?')
            .run(req.params.id, req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Question not found' });
        res.json({ success: true, data: { message: 'Question deleted' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/faculty/question-bank/:id/use (faculty auth)
router.patch('/question-bank/:id/use', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const result = db.prepare(`
            UPDATE custom_questions
            SET times_used = times_used + 1
            WHERE id = ? AND faculty_id = ?
        `).run(req.params.id, req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Question not found' });
        res.json({ success: true, data: { message: 'Usage updated' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/heatmap
router.get('/analytics/heatmap', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT
                CAST(tier AS INTEGER) AS t,
                COUNT(*) AS attemptCount,
                AVG((clarity_score + reasoning_score + depth_score + confidence_score) / 4.0) AS avgAll,
                AVG(clarity_score) AS ac,
                AVG(reasoning_score) AS ar,
                AVG(depth_score) AS ad,
                AVG(confidence_score) AS af
            FROM answers
            WHERE clarity_score IS NOT NULL
            AND tier IS NOT NULL
            AND TRIM(CAST(tier AS TEXT)) IN ('1', '2', '3')
            GROUP BY CAST(tier AS INTEGER)
        `).all();

        const tier = (n) => rows.find((r) => r.t === n) || null;
        const buildTier = (n) => {
            const r = tier(n);
            if (!r || !r.attemptCount) {
                return { avgScore: 0, attemptCount: 0 };
            }
            return { avgScore: toDisplayScore(r.avgAll), attemptCount: r.attemptCount };
        };
        const byDim = (col) => {
            const out = { tier1: 0, tier2: 0, tier3: 0 };
            for (const n of [1, 2, 3]) {
                const r = tier(n);
                out[`tier${n}`] = r && r[col] != null ? toDisplayScore(r[col]) : 0;
            }
            return out;
        };
        res.json({
            success: true,
            data: {
                tier1: buildTier(1),
                tier2: buildTier(2),
                tier3: buildTier(3),
                byDimension: {
                    clarity: byDim('ac'),
                    reasoning: byDim('ar'),
                    depth: byDim('ad'),
                    confidence: byDim('af')
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/dropoff
router.get('/analytics/dropoff', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const counts = db.prepare(`
            SELECT abandoned_at_question AS q, COUNT(*) AS c
            FROM sessions
            WHERE abandoned_at_question IS NOT NULL
            GROUP BY abandoned_at_question
        `).all();
        const abandonedAt = {};
        for (let i = 1; i <= 10; i++) abandonedAt[i] = 0;
        counts.forEach((row) => {
            if (row.q >= 1 && row.q <= 10) abandonedAt[row.q] = row.c;
        });
        const total = db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c;
        const completed = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE status = 'completed'").get().c;
        const completionRate = total ? Math.round((100 * completed) / total) : 0;
        const rows = db.prepare('SELECT id, status, abandoned_at_question FROM sessions').all();
        let sumQ = 0;
        for (const r of rows) {
            if (r.status === 'completed') sumQ += 10;
            else {
                const n = db.prepare('SELECT COUNT(*) AS c FROM answers WHERE session_id = ?').get(r.id).c;
                sumQ += n;
            }
        }
        const avgQuestionsCompleted = rows.length ? Math.round((sumQ / rows.length) * 10) / 10 : 0;
        res.json({
            success: true,
            data: { abandonedAt, completionRate, avgQuestionsCompleted }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/time
router.get('/analytics/time', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const rows = db.prepare("SELECT id, time_per_question_json FROM sessions WHERE time_per_question_json IS NOT NULL AND TRIM(time_per_question_json) != ''").all();
        const secByTier = { 1: [], 2: [], 3: [] };
        const timeByDim = { clarity: [], reasoning: [], depth: [], confidence: [] };
        const durations = [];
        for (const s of rows) {
            let tmap;
            try {
                tmap = JSON.parse(s.time_per_question_json);
            } catch (e) {
                continue;
            }
            const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY id ASC').all(s.id);
            let totalSec = 0;
            for (let i = 0; i < answers.length; i++) {
                const key = String(i + 1);
                const entry = tmap[key] !== undefined ? tmap[key] : tmap[i + 1];
                const sec = entry && typeof entry === 'object' && entry.seconds != null ? entry.seconds : Number(entry);
                if (sec == null || Number.isNaN(sec)) continue;
                totalSec += sec;
                const tr = parseInt(answers[i].tier, 10) || 1;
                if (tr >= 1 && tr <= 3) secByTier[tr].push(sec);
                const a = answers[i];
                [ ['clarity', a.clarity_score], ['reasoning', a.reasoning_score], ['depth', a.depth_score], ['confidence', a.confidence_score] ].forEach(([d, sc]) => {
                    const w = Number(sc) || 0.25;
                    timeByDim[d].push((sec * w) / (Number(a.clarity_score) + Number(a.reasoning_score) + Number(a.depth_score) + Number(a.confidence_score) + 0.0001));
                });
            }
            if (totalSec > 0) durations.push(Math.round((totalSec / 60) * 10) / 10);
        }
        const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
        const dimAvg = {};
        for (const d of Object.keys(timeByDim)) {
            const arr = timeByDim[d];
            let sum = 0;
            for (const x of arr) sum += x;
            dimAvg[d] = arr.length ? Math.round((sum / arr.length) * 10) / 10 : 0;
        }
        const edges = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
        const durationHistogram = [];
        for (let i = 0; i < edges.length; i++) {
            const lo = edges[i];
            const hi = i < edges.length - 1 ? edges[i + 1] : null;
            const count = !hi
                ? durations.filter((m) => m >= lo).length
                : durations.filter((m) => m >= lo && m < hi).length;
            const label = hi ? `${lo}-${hi}m` : `${lo}m+`;
            durationHistogram.push({ label, count, lo, hi: hi || Infinity });
        }
        res.json({
            success: true,
            data: {
                avgTimePerQuestion: { tier1: avg(secByTier[1]), tier2: avg(secByTier[2]), tier3: avg(secByTier[3]) },
                avgSessionDuration: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : 0,
                fastestCompletion: durations.length ? Math.min(...durations) : 0,
                slowestCompletion: durations.length ? Math.max(...durations) : 0,
                timeByDimension: dimAvg,
                durationHistogram
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/department?scope=all|semester
router.get('/analytics/department', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const scope = (req.query.scope || 'all') === 'semester' ? 'semester' : 'all';
        const dateFilter = scope === 'semester' ? "AND s.created_at >= datetime('now', '-120 days') " : '';
        const deptRows = db.prepare('SELECT id, name FROM departments ORDER BY name').all();
        const departments = deptRows.map((d) => {
            const st = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ? AND department_id = ?').get('student', d.id);
            const sess = db.prepare(`
                SELECT COUNT(*) AS c FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE u.department_id = ? ${dateFilter}
            `).get(d.id);
            const avg = db.prepare(`
                SELECT AVG(s.overall_score) AS a FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE u.department_id = ? ${dateFilter}
            `).get(d.id);
            return {
                name: d.name,
                studentCount: st.c,
                sessionCount: sess.c,
                avgScore: avg && avg.a != null ? toDisplayScore(avg.a) : 0
            };
        });
        const withStudents = departments.filter((x) => x.studentCount > 0);
        res.json({
            success: true,
            data: { departments, crossDeptComparison: withStudents.length > 1 }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/yearly?year=2025&compare=2024
router.get('/analytics/yearly', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const yCur = String(req.query.year || new Date().getFullYear());
        const yPrev = String(req.query.compare || (Number(yCur) - 1));
        const loadYear = (y) => db.prepare(`
            SELECT AVG(overall_score) AS avgScore, COUNT(*) AS sessions
            FROM sessions
            WHERE strftime('%Y', created_at) = ? AND status = 'completed' AND overall_score IS NOT NULL
        `).get(y);

        const dimForYear = (year) => db.prepare(`
            SELECT
                AVG(clarity_score) AS clarity,
                AVG(reasoning_score) AS reasoning,
                AVG(depth_score) AS depth,
                AVG(confidence_score) AS confidence
            FROM answers a
            JOIN sessions s ON s.id = a.session_id
            WHERE strftime('%Y', s.created_at) = ?
        `).get(year);

        const curRow = loadYear(yCur);
        const cur = curRow && (curRow.sessions != null)
            ? { avgScore: toDisplayScore(curRow.avgScore), sessions: curRow.sessions }
            : { avgScore: 0, sessions: 0 };
        const prevRow = loadYear(yPrev);
        const previous = prevRow && (prevRow.sessions != null)
            ? { avgScore: toDisplayScore(prevRow.avgScore), sessions: prevRow.sessions }
            : { avgScore: 0, sessions: 0 };

        const dCur = dimForYear(yCur) || {};
        const dPrev = dimForYear(yPrev) || {};
        const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
        const byDimension = {};
        for (const d of dims) {
            const a = dCur[d];
            const b = dPrev[d];
            if (a == null && b == null) {
                byDimension[d] = '0%';
            } else {
                byDimension[d] = fmtPctChange(
                    a != null ? toDisplayScore(a) : 0,
                    b != null ? toDisplayScore(b) : 0
                );
            }
        }

        const improvementPct = (() => {
            const c = toDisplayScore((curRow && curRow.avgScore) || 0);
            const p = toDisplayScore((prevRow && prevRow.avgScore) || 0);
            if (c === 0 && p === 0) return '0%';
            return fmtPctChange(c, p);
        })();

        const monthly = (year) => {
            const out = [];
            for (let m = 1; m <= 12; m++) {
                const mm = String(m).padStart(2, '0');
                const row = db.prepare(`
                    SELECT AVG(overall_score) AS a, COUNT(*) AS c FROM sessions
                    WHERE strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?
                    AND status = 'completed' AND overall_score IS NOT NULL
                `).get(String(year), mm);
                out.push({
                    month: m,
                    label: MONTH_LABELS[m - 1],
                    avgScore: row && row.a != null ? toDisplayScore(row.a) : null,
                    sessions: row ? row.c : 0
                });
            }
            return out;
        };

        res.json({
            success: true,
            data: {
                currentYear: cur,
                previousYear: previous,
                improvement: improvementPct,
                byDimension,
                monthlyTrend: { current: monthly(yCur), previous: monthly(yPrev) }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/analytics/weakdimensions
router.get('/analytics/weakdimensions', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
        const dimCount = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
        let withData = 0;
        for (const { id } of students) {
            const avgs = db.prepare(`
                SELECT AVG(clarity_score) AS c, AVG(reasoning_score) AS r, AVG(depth_score) AS d, AVG(confidence_score) AS f
                FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)
            `).get(id);
            if (!avgs) continue;
            const dims = {
                clarity: avgs.c || 0,
                reasoning: avgs.r || 0,
                depth: avgs.d || 0,
                confidence: avgs.f || 0
            };
            if (!Object.values(dims).some((v) => v > 0)) continue;
            withData += 1;
            const sorted = Object.entries(dims).sort((a, b) => a[1] - b[1]);
            const weakest = sorted[0][0];
            dimCount[weakest] += 1;
        }
        const ranking = Object.entries(dimCount)
            .map(([dimension, weakCount]) => ({
                dimension,
                weakCount,
                percentage: withData ? Math.round((100 * weakCount) / withData) : 0
            }))
            .sort((a, b) => b.weakCount - a.weakCount);

        const cohort = db.prepare(`
            SELECT
                AVG(clarity_score) AS clarity,
                AVG(reasoning_score) AS reasoning,
                AVG(depth_score) AS depth,
                AVG(confidence_score) AS confidence
            FROM answers
        `).get();
        const cohortAverage = {
            clarity: cohort && cohort.clarity != null ? toDisplayScore(cohort.clarity) : 0,
            reasoning: cohort && cohort.reasoning != null ? toDisplayScore(cohort.reasoning) : 0,
            depth: cohort && cohort.depth != null ? toDisplayScore(cohort.depth) : 0,
            confidence: cohort && cohort.confidence != null ? toDisplayScore(cohort.confidence) : 0
        };

        res.json({
            success: true,
            data: { ranking, cohortAverage }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/export-all (ZIP of CSVs)
router.get('/export-all', verifyToken, requireRole('faculty'), (req, res) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="pdrs_students_export.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        if (!res.headersSent) res.status(500).end(String(err.message));
    });
    archive.pipe(res);
    const students = db.prepare("SELECT id, name, email FROM users WHERE role = 'student'").all();
    for (const st of students) {
        const prof = buildStudentProfile(st.id);
        if (!prof) continue;
        const lines = [
            'session_id,project_title,created_at,status,overall_score,question,clarity,reasoning,depth,confidence,feedback',
        ];
        for (const sess of prof.sessions) {
            const ans = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY id').all(sess.id);
            if (ans.length === 0) {
                lines.push([
                    sess.id, csvEscape(sess.project_title), csvEscape(sess.created_at), csvEscape(sess.status), sess.overall_score ?? '',
                    '', '', '', '', '', ''
                ].join(','));
            } else {
                for (const a of ans) {
                    lines.push([
                        sess.id, csvEscape(sess.project_title), csvEscape(sess.created_at), csvEscape(sess.status), sess.overall_score ?? '',
                        csvEscape(a.question), a.clarity_score, a.reasoning_score, a.depth_score, a.confidence_score, csvEscape(a.feedback)
                    ].join(','));
                }
            }
        }
        const safe = String(st.name || 'student').replace(/[^\w\-\.]+/g, '_') || 'student';
        archive.append(lines.join('\n'), { name: `student_${st.id}_${safe}.csv` });
    }
    archive.finalize();
});

// GET /api/faculty/compare/:studentAId/:studentBId
router.get('/compare/:studentAId/:studentBId', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const a = buildStudentProfile(req.params.studentAId);
        const b = buildStudentProfile(req.params.studentBId);
        if (!a || !b) return res.status(404).json({ success: false, error: 'Students not found' });
        const winner = (dim) => {
            const k = ['clarity', 'reasoning', 'depth', 'confidence'];
            if (!k.includes(dim)) return 'tie';
            const d = a.dimAvgs[dim] - b.dimAvgs[dim];
            if (Math.abs(d) < 0.1) return 'tie';
            return d > 0 ? 'A' : 'B';
        };
        const compOverall = a.avgScore > b.avgScore ? 'A' : (a.avgScore < b.avgScore ? 'B' : 'tie');
        let closestDim = 'clarity';
        let minDiff = 9999;
        let biggestGap = { dimension: 'clarity', gap: 0 };
        for (const d of ['clarity', 'reasoning', 'depth', 'confidence']) {
            const g = Math.abs(a.dimAvgs[d] - b.dimAvgs[d]);
            if (g < minDiff) {
                minDiff = g;
                closestDim = d;
            }
            if (g > biggestGap.gap) biggestGap = { dimension: d, gap: Math.round(g * 10) / 10 };
        }
        res.json({
            success: true,
            data: {
                studentA: { name: a.student.name, avgScore: a.avgScore, sessions: a.sessions, dimensions: a.dimAvgs },
                studentB: { name: b.student.name, avgScore: b.avgScore, sessions: b.sessions, dimensions: b.dimAvgs },
                comparison: {
                    winner: {
                        overall: compOverall,
                        clarity: winner('clarity'),
                        reasoning: winner('reasoning'),
                        depth: winner('depth'),
                        confidence: winner('confidence')
                    },
                    closestDimension: closestDim,
                    biggestGap
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/faculty/flag-student
router.post('/flag-student', verifyToken, requireRole('faculty'), (req, res) => {
    const { studentId, reason } = req.body;
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId required' });
    try {
        const st = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId);
        if (!st) return res.status(404).json({ success: false, error: 'Student not found' });
        const info = db.prepare(`
            INSERT INTO flagged_students (student_id, faculty_id, reason) VALUES (?, ?, ?)
        `).run(Number(studentId), req.user.id, String(reason || ''));
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'account', ?, ?)").run(
            Number(studentId),
            'Account notice',
            'Your instructor has flagged your account for additional practice. Meet with your instructor if you have questions.'
        );
        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/faculty/flag-student/:id/resolve
router.patch('/flag-student/:id/resolve', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM flagged_students WHERE id = ? AND faculty_id = ?').get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ success: false, error: 'Not found' });
        db.prepare('UPDATE flagged_students SET resolved = 1 WHERE id = ?').run(req.params.id);
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'account', 'Flag cleared', 'Your instructor has resolved the practice flag. Keep up the good work!')")
            .run(row.student_id);
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/flagged
router.get('/flagged', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT f.*, u.name AS student_name, u.email AS student_email
            FROM flagged_students f
            JOIN users u ON u.id = f.student_id
            WHERE f.faculty_id = ? AND f.resolved = 0
            ORDER BY f.created_at DESC
        `).all(req.user.id);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/faculty/announcements
router.post('/announcements', verifyToken, requireRole('faculty'), async (req, res) => {
    const { title, message, targetRole = 'student' } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, error: 'title and message required' });
    try {
        const tr = (targetRole === 'faculty' || targetRole === 'admin') ? targetRole : 'student';
        const info = db.prepare('INSERT INTO announcements (faculty_id, title, message, target_role) VALUES (?, ?, ?, ?)')
            .run(req.user.id, String(title), String(message), tr);
        const users = db.prepare('SELECT id FROM users WHERE role = ?').all(tr);
        for (const u of users) {
            db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'announcement', ?, ?)")
                .run(u.id, String(title), String(message).slice(0, 2000));
        }
        try {
            await pushService.sendToRole(tr, String(title), String(message).slice(0, 200), '/notifications.html');
        } catch (e) { /* optional */ }
        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/announcements
router.get('/announcements', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.patch('/announcements/:id', verifyToken, requireRole('faculty'), (req, res) => {
    const { title, message } = req.body;
    try {
        const a = db.prepare('SELECT * FROM announcements WHERE id = ? AND faculty_id = ?').get(req.params.id, req.user.id);
        if (!a) return res.status(404).json({ success: false, error: 'Not found' });
        db.prepare('UPDATE announcements SET title = COALESCE(?, title), message = COALESCE(?, message) WHERE id = ?')
            .run(title != null ? String(title) : null, message != null ? String(message) : null, req.params.id);
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/announcements/:id', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const r = db.prepare('DELETE FROM announcements WHERE id = ? AND faculty_id = ?').run(req.params.id, req.user.id);
        if (r.changes === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/faculty/schedule-defense
router.post('/schedule-defense', verifyToken, requireRole('faculty'), async (req, res) => {
    const { studentId, date, location, panelMembers, notes } = req.body;
    if (!studentId || !date) return res.status(400).json({ success: false, error: 'studentId and date required' });
    try {
        const st = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId);
        if (!st) return res.status(404).json({ success: false, error: 'Student not found' });
        const panel = typeof panelMembers === 'string' ? panelMembers : (Array.isArray(panelMembers) ? panelMembers.join(', ') : String(panelMembers || ''));
        const info = db.prepare(`
            INSERT INTO defense_schedule (student_id, faculty_id, scheduled_date, location, panel_members, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
        `).run(Number(studentId), req.user.id, String(date), String(location || ''), panel, String(notes || ''));
        db.prepare('UPDATE users SET defense_date = ? WHERE id = ?').run(String(date), Number(studentId));
        const msg = `Defense: ${String(date)}. Location: ${String(location || 'TBA')}. Panel: ${panel || 'TBA'}`;
        db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'defense', 'Defense scheduled', ?)")
            .run(Number(studentId), msg.slice(0, 2000));
        try {
            await emailService.sendDefenseScheduledEmail(st.email, st.name, { date, location, panel, notes });
        } catch (e) { /* */ }
        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/faculty/defense-schedule?upcoming=true | ?all=true
router.get('/defense-schedule', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const upcoming = req.query.upcoming === 'true';
        const all = req.query.all === 'true' || !upcoming;
        let q = `
            SELECT d.*, u.name AS student_name, u.email AS student_email
            FROM defense_schedule d
            JOIN users u ON u.id = d.student_id
            WHERE d.faculty_id = ?
        `;
        const p = [req.user.id];
        if (upcoming && !all) {
            q += " AND d.scheduled_date >= datetime('now', '-1 day') ";
        }
        q += ' ORDER BY d.scheduled_date ASC';
        res.json({ success: true, data: db.prepare(q).all(...p) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.patch('/defense-schedule/:id', verifyToken, requireRole('faculty'), (req, res) => {
    try {
        const d = db.prepare('SELECT * FROM defense_schedule WHERE id = ? AND faculty_id = ?').get(req.params.id, req.user.id);
        if (!d) return res.status(404).json({ success: false, error: 'Not found' });
        const { date, location, status, panelMembers, notes } = req.body;
        db.prepare(`
            UPDATE defense_schedule SET
            scheduled_date = COALESCE(?, scheduled_date),
            location = COALESCE(?, location),
            status = COALESCE(?, status),
            panel_members = COALESCE(?, panel_members),
            notes = COALESCE(?, notes)
            WHERE id = ?
        `).run(
            date != null ? String(date) : null,
            location != null ? String(location) : null,
            status != null ? String(status) : null,
            panelMembers != null ? String(panelMembers) : null,
            notes != null ? String(notes) : null,
            req.params.id
        );
        if (date) {
            db.prepare('UPDATE users SET defense_date = ? WHERE id = ?').run(String(date), d.student_id);
        }
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(d.student_id);
        if (u) {
            db.prepare("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'defense', 'Defense updated', 'Your defense schedule was updated. Check the app for new details.')")
                .run(d.student_id);
        }
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function askClaudePaper(system, user) {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: system,
        messages: [{ role: 'user', content: user }],
        temperature: 0.5
    });
    return response.content[0].text;
}

// POST /api/faculty/generate-question-paper
router.post('/generate-question-paper', verifyToken, requireRole('faculty'), async (req, res) => {
    const { studentIds, difficulty = 'medium', questionCount = 5 } = req.body;
    const ids = Array.isArray(studentIds) ? studentIds : [];
    if (ids.length === 0) return res.status(400).json({ error: 'studentIds[] required' });
    const n = Math.min(20, Math.max(1, parseInt(questionCount, 10) || 5));
    const system = 'You are a technical interview expert. Return only HTML fragments (section per student) using <h2>, <h3>, <p>, <ol>. No full document shell.';
    const sections = [];
    for (const sid of ids.slice(0, 30)) {
        const p = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(sid);
        const s = db.prepare("SELECT name FROM users WHERE id = ? AND role = 'student'").get(sid);
        if (!p) {
            sections.push(`<h2>Student ${sid}</h2><p>No project on file.</p>`);
            continue;
        }
        const name = s ? s.name : `Student ${sid}`;
        const userP = `Generate ${n} unique questions for a mock defense. Difficulty: ${difficulty}.
Project title: ${p.title}
Description: ${p.description || 'N/A'}
Stack: ${p.tech_stack || 'N/A'}
Number each question.`;
        let html;
        try {
            html = await askClaudePaper(system, userP);
        } catch (e) {
            html = '<p>Failed to generate for this student.</p>';
        }
        sections.push(`<h2>${name}</h2><p><em>${(p.title || '').replace(/</g, '')}</em></p>${html}`);
    }
    const buffer = await pdfService.generateQuestionPaper(sections.join('<div style="page-break-before:always"></div>'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="question_paper.pdf"');
    res.send(buffer);
});

module.exports = router;
