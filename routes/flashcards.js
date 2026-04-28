const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

router.use(verifyToken, requireRole('student'));

function nextReviewFromDifficulty(difficulty) {
    const map = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };
    const days = map[Number(difficulty)] || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// GET /api/flashcards
router.get('/', (req, res) => {
    try {
        const cards = db.prepare(`
            SELECT * FROM flashcards
            WHERE user_id = ? AND (next_review IS NULL OR datetime(next_review) <= datetime('now'))
            ORDER BY datetime(created_at) ASC
        `).all(req.user.id);
        res.json({ success: true, data: { dueCount: cards.length, cards } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/flashcards
router.post('/', (req, res) => {
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ success: false, error: 'Question and answer are required' });
    try {
        const info = db.prepare(`
            INSERT INTO flashcards (user_id, question, answer, next_review, review_count)
            VALUES (?, ?, ?, datetime('now'), 0)
        `).run(req.user.id, question, answer);
        const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json({ success: true, data: card });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/flashcards/generate
router.post('/generate', (req, res) => {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ success: false, error: 'projectId is required' });
    try {
        const project = db.prepare('SELECT title, description, tech_stack FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

        const generated = Array.from({ length: 10 }).map((_, i) => ({
            question: `Explain ${project.title} concept ${i + 1}`,
            answer: `Model answer for ${project.title} concept ${i + 1} using ${project.tech_stack || 'your stack'}.`
        }));

        const tx = db.transaction((cards) => {
            for (const card of cards) {
                db.prepare(`
                    INSERT INTO flashcards (user_id, question, answer, next_review, review_count)
                    VALUES (?, ?, ?, datetime('now'), 0)
                `).run(req.user.id, card.question, card.answer);
            }
        });
        tx(generated);
        res.json({ success: true, data: { cards: generated } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/flashcards/:id/review
router.patch('/:id/review', (req, res) => {
    const { difficulty } = req.body;
    if (difficulty === undefined) return res.status(400).json({ success: false, error: 'Difficulty is required' });
    try {
        const nextReview = nextReviewFromDifficulty(difficulty);
        const result = db.prepare(`
            UPDATE flashcards
            SET difficulty = ?, review_count = review_count + 1, next_review = ?
            WHERE id = ? AND user_id = ?
        `).run(Number(difficulty), nextReview, req.params.id, req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Flashcard not found' });
        res.json({ success: true, data: { nextReview } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/flashcards/:id
router.delete('/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM flashcards WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Flashcard not found' });
        res.json({ success: true, data: null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
