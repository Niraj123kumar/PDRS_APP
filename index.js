require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const sessionRoutes = require('./routes/sessions');
const notificationRoutes = require('./routes/notifications');
const studentRoutes = require('./routes/student');
const aiRoutes = require('./routes/ai');
const facultyRoutes = require('./routes/faculty');
const panelRoutes = require('./routes/panel');
const initWebSocket = require('./websocket');
const db = require('./db');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'pdrs_super_secret_key_123';

// Initialize WebSocket
const wsApp = initWebSocket(server);

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check for AI provider
app.get('/api/health', (req, res) => {
    const provider = process.env.ANTHROPIC_API_KEY ? 'claude' : 'other';
    res.json({ provider, status: 'ok' });
});

// Demo login endpoint
app.get('/api/demo/student', (req, res) => {
    try {
        const user = db.prepare("SELECT * FROM users WHERE email = 'demo_student@pdrs.com'").get();
        if (!user) return res.status(404).json({ error: 'Demo user not found' });
        
        const userPayload = { id: user.id, name: user.name, email: user.email, role: user.role };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: userPayload });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/panel', panelRoutes);

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

server.listen(port, () => {
    console.log(`PDRS Server running at http://localhost:${port}`);
});
