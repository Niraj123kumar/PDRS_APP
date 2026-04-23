const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const githubService = require('../services/githubService');

// POST /api/projects (auth required)
router.post('/', verifyToken, (req, res) => {
    const { title, description, tech_stack } = req.body;
    const user_id = req.user.id;

    if (!title) {
        return res.status(400).json({ error: 'Project title is required' });
    }

    try {
        const info = db.prepare('INSERT INTO projects (user_id, title, description, tech_stack) VALUES (?, ?, ?, ?)').run(user_id, title, description, tech_stack);
        res.status(201).json({ id: info.lastInsertRowid, user_id, title, description, tech_stack });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/projects (auth required)
router.get('/', verifyToken, (req, res) => {
    const user_id = req.user.id;
    try {
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/projects/import-github (student auth required)
router.post('/import-github', verifyToken, requireRole('student'), async (req, res) => {
    const { repoUrl } = req.body;
    if (!githubService.validateRepoUrl(repoUrl)) {
        return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    try {
        const preview = await githubService.importFromReadme(repoUrl);
        return res.json(preview);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to import GitHub repository' });
    }
});

// POST /api/projects/confirm-github (student auth required)
router.post('/confirm-github', verifyToken, requireRole('student'), (req, res) => {
    const { title, description, techStack, repoUrl } = req.body;
    if (!title || !repoUrl) {
        return res.status(400).json({ error: 'Title and repo URL are required' });
    }
    if (!githubService.validateRepoUrl(repoUrl)) {
        return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    try {
        const info = db.prepare(`
            INSERT INTO projects (user_id, title, description, tech_stack, github_repo_url)
            VALUES (?, ?, ?, ?, ?)
        `).run(req.user.id, title, description || '', techStack || '', repoUrl);
        return res.status(201).json({
            id: info.lastInsertRowid,
            user_id: req.user.id,
            title,
            description: description || '',
            tech_stack: techStack || '',
            github_repo_url: repoUrl
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
