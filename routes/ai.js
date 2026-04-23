const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper function to call Anthropic
async function askAI(systemPrompt, userPrompt) {
    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514", // As requested in technical specifications
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            temperature: 0.7,
        });
        return response.content[0].text;
    } catch (err) {
        console.error("AI API Error:", err);
        throw err;
    }
}

// Helper to clean and parse JSON
function parseAIResponse(raw) {
    try {
        const clean = raw.replace(/```json|```/g, "").trim();
        return JSON.parse(clean);
    } catch (err) {
        console.error("JSON Parse Error:", err, "Raw:", raw);
        throw new Error("Failed to parse AI response as JSON");
    }
}

// POST /api/ai/generate-questions (student auth required)
router.post('/generate-questions', verifyToken, requireRole('student'), async (req, res) => {
    const { title, description, tech_stack } = req.body;
    
    const systemPrompt = "You are a technical interview expert. Return ONLY raw JSON. No markdown. No explanation. No backticks.";
    const userPrompt = `Generate exactly 10 interview questions for a project titled: ${title}, description: ${description}, tech stack: ${tech_stack}. Return this exact JSON format: 
    [ 
        { "question": "...", "tier": 1, "tier_label": "Fundamentals" },
        ...4 tier1, 3 tier2, 3 tier3 questions...
    ]`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);

        if (!Array.isArray(parsed) || parsed.length !== 10) {
            throw new Error(`Invalid question count generated: ${parsed.length}`);
        }

        res.json(parsed);
    } catch (err) {
        res.status(500).json({ error: "AI service unavailable" });
    }
});

// POST /api/ai/score-answer (student auth required)
router.post('/score-answer', verifyToken, requireRole('student'), async (req, res) => {
    const { question, answer } = req.body;

    const systemPrompt = "You are a strict academic evaluator. Return ONLY raw JSON. No markdown. No explanation.";
    const userPrompt = `Score this answer from 0 to 100 for each dimension. 
    Question: ${question}
    Answer: ${answer}
    Return exactly: 
    { 
        "clarity": number, 
        "reasoning": number, 
        "depth": number, 
        "confidence": number, 
        "feedback": "one sentence of constructive feedback" 
    }`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);

        // Clamp and validate scores
        const dimensions = ['clarity', 'reasoning', 'depth', 'confidence'];
        dimensions.forEach(dim => {
            let score = parseFloat(parsed[dim]);
            if (isNaN(score)) score = 0;
            parsed[dim] = Math.min(100, Math.max(0, score));
        });

        res.json(parsed);
    } catch (err) {
        res.status(500).json({ error: "AI service unavailable" });
    }
});

// POST /api/ai/generate-coaching (student auth required)
router.post('/generate-coaching', verifyToken, requireRole('student'), async (req, res) => {
    const { weakDimensions } = req.body;

    const systemPrompt = "You are a coaching assistant. Return ONLY raw JSON.";
    const userPrompt = `Generate 3 practice questions to improve: ${weakDimensions.join(', ')}. Return: { "questions": ["...", "...", "..."] }`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);
        res.json(parsed);
    } catch (err) {
        res.status(500).json({ error: "AI service unavailable" });
    }
});

// POST /api/ai/panel-question-bank (faculty auth required)
router.post('/panel-question-bank', verifyToken, requireRole('faculty'), async (req, res) => {
    const { title, description, tech_stack } = req.body;

    const systemPrompt = "You are a senior technical interviewer. Return ONLY raw JSON.";
    const userPrompt = `Generate 20 follow-up interview questions for project: ${title} using ${tech_stack}. Return: { "questions": [{ "question": "...", "theme": "..." }] }`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);
        res.json(parsed);
    } catch (err) {
        res.status(500).json({ error: "AI service unavailable" });
    }
});

module.exports = router;
