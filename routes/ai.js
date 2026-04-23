const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
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
    const { title, description, tech_stack, sessionId } = req.body;
    
    const systemPrompt = "You are a technical interview expert. Return ONLY raw JSON. No markdown. No explanation. No backticks.";
    const userPrompt = `Generate exactly 10 interview questions for a project titled: ${title}, description: ${description}, tech stack: ${tech_stack}. Return this exact JSON format: 
    [ 
        {
          "question": "...",
          "tier": 1,
          "tier_label": "Fundamentals",
          "modelAnswer": "...",
          "keyPoints": ["point1", "point2", "point3"]
        },
        ...4 tier1, 3 tier2, 3 tier3 questions...
    ]`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);

        if (!Array.isArray(parsed) || parsed.length !== 10) {
            throw new Error(`Invalid question count generated: ${parsed.length}`);
        }

        const enriched = parsed.map((q) => ({
            question: q.question,
            tier: q.tier,
            tier_label: q.tier_label,
            modelAnswer: q.modelAnswer || 'No model answer generated.',
            keyPoints: Array.isArray(q.keyPoints) ? q.keyPoints.slice(0, 3) : []
        }));
        if (sessionId) {
            db.prepare('UPDATE sessions SET questions_json = ? WHERE id = ? AND user_id = ?')
                .run(JSON.stringify(enriched), sessionId, req.user.id);
        }
        res.json(enriched);
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
    const { weakDimensions = [], projectTitle = '', projectStack = '' } = req.body;

    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const systemPrompt = "You are a coaching assistant. Return ONLY raw JSON with keys questions, tips, improvementPlan.";
    const userPrompt = `Create coaching for weak dimensions: ${weakDimensions.join(', ')}.
Project title: ${projectTitle}
Project stack: ${projectStack}
Return JSON:
{
  "questions": {
    "clarity": ["...","...","..."],
    "reasoning": ["...","...","..."],
    "depth": ["...","...","..."],
    "confidence": ["...","...","..."]
  },
  "tips": {
    "clarity": "...",
    "reasoning": "...",
    "depth": "...",
    "confidence": "..."
  },
  "improvementPlan": {
    "week1": "...",
    "week2": "...",
    "week3": "...",
    "week4": "..."
  }
}`;

    try {
        const raw = await askAI(systemPrompt, userPrompt);
        const parsed = parseAIResponse(raw);
        const fallback = {
            questions: {
                clarity: ['Explain your architecture clearly.', 'Summarize your module flow.', 'Explain one feature in 60 seconds.'],
                reasoning: ['Why this stack?', 'What trade-off did you make?', 'Why this DB schema?'],
                depth: ['What are edge cases?', 'How does scaling work?', 'How would you optimize this?'],
                confidence: ['Answer directly in one sentence.', 'Defend one design decision.', 'State a strong conclusion.']
            },
            tips: {
                clarity: 'Structure answers as: Statement, Explanation, Example.',
                reasoning: 'Always explain WHY before HOW.',
                depth: 'Go 3 levels deep: what, how, why it matters.',
                confidence: 'Start every answer with a direct statement.'
            },
            improvementPlan: {
                week1: 'Focus on clarity: practice 3 answers daily',
                week2: 'Focus on reasoning: explain every tradeoff',
                week3: 'Focus on depth: research alternatives',
                week4: 'Full mock defense simulation'
            }
        };
        const response = parsed && parsed.questions ? parsed : fallback;
        db.prepare(`
            INSERT INTO coaching_sessions (user_id, weak_dimensions, questions_json, tips_json, improvement_plan_json, completed)
            VALUES (?, ?, ?, ?, ?, 0)
        `).run(
            req.user.id,
            JSON.stringify(weakDimensions),
            JSON.stringify(response.questions),
            JSON.stringify(response.tips),
            JSON.stringify(response.improvementPlan)
        );
        res.json(response);
    } catch (err) {
        const fallback = {
            questions: Object.fromEntries(dims.map((d) => [d, [`Practice ${d} question 1`, `Practice ${d} question 2`, `Practice ${d} question 3`]])),
            tips: {
                clarity: 'Structure answers as: State, Explain, Example',
                reasoning: 'Always explain WHY before HOW',
                depth: 'Go 3 levels deep: what, how, why it matters',
                confidence: 'Start every answer with a direct statement'
            },
            improvementPlan: {
                week1: 'Focus on clarity: practice 3 answers daily',
                week2: 'Focus on reasoning: explain every tradeoff',
                week3: 'Focus on depth: research alternatives',
                week4: 'Full mock defense simulation'
            }
        };
        res.json(fallback);
    }
});

// POST /api/ai/analyze-confidence
router.post('/analyze-confidence', verifyToken, requireRole('student'), (req, res) => {
    const { answer = '', questionText = '' } = req.body;
    const text = String(answer).toLowerCase();
    const hedgingLex = ['maybe', 'perhaps', 'i think', 'not sure', 'might'];
    const assertiveLex = ['definitely', 'clearly', 'the reason is', 'therefore', 'in conclusion'];
    const fillerLex = ['um', 'uh', 'like', 'you know', 'basically'];
    const hedgingWords = hedgingLex.filter((w) => text.includes(w));
    const fillerCount = fillerLex.reduce((acc, w) => acc + (text.match(new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'g')) || []).length, 0);
    const assertiveCount = assertiveLex.reduce((acc, w) => acc + (text.match(new RegExp(w.replace(/\s+/g, '\\s+'), 'g')) || []).length, 0);
    const qComplexity = Math.max(1, String(questionText).split(/\s+/).length / 8);
    const lengthRatio = Math.min(1.5, String(answer).split(/\s+/).length / (20 * qComplexity));
    let confidenceScore = 60 + assertiveCount * 5 + Math.round(lengthRatio * 10) - hedgingWords.length * 8 - fillerCount * 2;
    confidenceScore = Math.max(0, Math.min(100, confidenceScore));
    res.json({
        confidenceScore,
        hedgingWords,
        fillerCount,
        assertiveCount,
        suggestion: hedgingWords.length > 0
            ? "Try to be more direct. Replace 'I think' with 'The reason is'."
            : 'Good confidence. Keep concise and assertive.'
    });
});

// POST /api/ai/analyze-voice-tone
router.post('/analyze-voice-tone', verifyToken, requireRole('student'), (req, res) => {
    const { transcript = '', wordsPerMinute = 130, pauseCount = 0 } = req.body;
    const pace = Number(wordsPerMinute) < 100 ? 'too-slow' : (Number(wordsPerMinute) > 180 ? 'too-fast' : 'good');
    const fillerLex = ['um', 'uh', 'like', 'you know', 'basically'];
    const lower = String(transcript).toLowerCase();
    const fillerWords = {};
    for (const word of fillerLex) {
        const count = (lower.match(new RegExp(word.replace(/\s+/g, '\\s+'), 'g')) || []).length;
        if (count > 0) fillerWords[word] = count;
    }
    const suggestions = [];
    if (pace === 'too-slow') suggestions.push('Increase pace closer to 130 words per minute.');
    if (pace === 'too-fast') suggestions.push('Slow down to around 130 words per minute.');
    if (Number(pauseCount) > 10) suggestions.push('Reduce long pauses and keep thought flow consistent.');
    Object.entries(fillerWords).forEach(([w, c]) => suggestions.push(`Reduce use of ${w} (used ${c} times)`));
    res.json({ pace, wordsPerMinute, fillerWords, suggestions });
});

// POST /api/ai/predict-score
router.post('/predict-score', verifyToken, requireRole('student'), (req, res) => {
    const userId = Number(req.body.userId || req.user.id);
    if (userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    const history = db.prepare(`
        SELECT * FROM dimension_history
        WHERE user_id = ?
        ORDER BY datetime(recorded_at) DESC
        LIMIT 5
    `).all(userId).reverse();
    if (history.length < 2) {
        return res.json({
            predictedScore: 0,
            predictedGrade: 'N/A',
            confidence: 'low',
            trendPerDimension: {},
            recommendation: 'Complete at least 2 sessions to enable score prediction.'
        });
    }

    function trend(current, projected) {
        const diff = projected - current;
        if (diff > 0.1) return 'improving';
        if (diff < -0.1) return 'declining';
        return 'stable';
    }
    function project(key) {
        const vals = history.map((h) => Number(h[key] || 0));
        const n = vals.length;
        const first = vals[0];
        const last = vals[n - 1];
        const slope = (last - first) / Math.max(1, n - 1);
        const projected = Math.max(0, Math.min(100, last + slope * 3));
        return { current: Number(last.toFixed(1)), projected: Number(projected.toFixed(1)), trend: trend(last, projected) };
    }
    const trendPerDimension = {
        clarity: project('clarity_avg'),
        reasoning: project('reasoning_avg'),
        depth: project('depth_avg'),
        confidence: project('confidence_avg')
    };
    const predictedScore = Number(((trendPerDimension.clarity.projected + trendPerDimension.reasoning.projected + trendPerDimension.depth.projected + trendPerDimension.confidence.projected) / 4).toFixed(1));
    const predictedGrade = predictedScore >= 85 ? 'A' : predictedScore >= 70 ? 'B' : predictedScore >= 55 ? 'C' : predictedScore >= 40 ? 'D' : 'F';
    res.json({
        predictedScore,
        predictedGrade,
        confidence: history.length >= 4 ? 'high' : 'medium',
        trendPerDimension: {
            clarity: trendPerDimension.clarity,
            reasoning: trendPerDimension.reasoning,
            depth: trendPerDimension.depth,
            confidence: trendPerDimension.confidence
        },
        recommendation: `At this pace you will score ${predictedGrade}. Focus on ${trendPerDimension.reasoning.projected < trendPerDimension.clarity.projected ? 'Reasoning' : 'Depth'} to improve your final grade.`
    });
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
