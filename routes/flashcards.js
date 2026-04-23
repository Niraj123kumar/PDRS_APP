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
    const cards = db.prepare(`
        SELECT * FROM flashcards
        WHERE user_id = ? AND (next_review IS NULL OR datetime(next_review) <= datetime('now'))
        ORDER BY datetime(created_at) ASC
    `).all(req.user.id);
    res.json({ dueCount: cards.length, cards });
});

// POST /api/flashcards
router.post('/', (req, res) => {
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
    const info = db.prepare(`
        INSERT INTO flashcards (user_id, question, answer, next_review, review_count)
        VALUES (?, ?, ?, datetime('now'), 0)
    `).run(req.user.id, question, answer);
    const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(card);
});

// POST /api/flashcards/generate
router.post('/generate', (req, res) => {
    const { projectId } = req.body;
    const project = db.prepare('SELECT title, description, tech_stack FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

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
    res.json({ cards: generated });
});

// PATCH /api/flashcards/:id/review
router.patch('/:id/review', (req, res) => {
    const { difficulty } = req.body;
    const nextReview = nextReviewFromDifficulty(difficulty);
    const result = db.prepare(`
        UPDATE flashcards
        SET difficulty = ?, review_count = review_count + 1, next_review = ?
        WHERE id = ? AND user_id = ?
    `).run(Number(difficulty), nextReview, req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Flashcard not found' });
    res.json({ success: true, nextReview });
});

// DELETE /api/flashcards/:id
router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM flashcards WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
});

module.exports = router;
