require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const port = process.env.PORT || 3000;

// Anthropic Client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get all projects
app.get('/api/projects', (req, res) => {
    try {
        const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new project
app.post('/api/projects', (req, res) => {
    const { title, description } = req.body;
    try {
        const info = db.prepare('INSERT INTO projects (title, description) VALUES (?, ?)').run(title, description);
        res.json({ id: info.lastInsertRowid, title, description });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start a rehearsal session
app.post('/api/rehearsals', (req, res) => {
    const { project_id } = req.body;
    try {
        const info = db.prepare('INSERT INTO rehearsals (project_id) VALUES (?)').run(project_id);
        res.json({ id: info.lastInsertRowid, project_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get rehearsal details with questions
app.get('/api/rehearsals/:id', (req, res) => {
    try {
        const rehearsal = db.prepare('SELECT * FROM rehearsals WHERE id = ?').get(req.params.id);
        if (!rehearsal) return res.status(404).json({ error: 'Rehearsal not found' });
        
        const questions = db.prepare('SELECT * FROM questions WHERE rehearsal_id = ?').all(req.params.id);
        res.json({ ...rehearsal, questions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Server listener
app.listen(port, () => {
    console.log(`PDRS Server running at http://localhost:${port}`);
});
