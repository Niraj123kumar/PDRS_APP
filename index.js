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
const adminRoutes = require('./routes/admin');
const goalsRoutes = require('./routes/goals');
const flashcardsRoutes = require('./routes/flashcards');
const bookmarksRoutes = require('./routes/bookmarks');
const peerRoutes = require('./routes/peer');
const templatesRoutes = require('./routes/templates');
const initWebSocket = require('./websocket');
const db = require('./db');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const tokenService = require('./services/tokenService');
const passport = require('./services/googleAuth');
const { runPIIMigrationOnce } = require('./services/migrationService');
const { startCronJobs } = require('./services/cronService');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'pdrs_super_secret_key_123';

// Initialize WebSocket
const wsApp = initWebSocket(server);
app.locals.wsApp = wsApp;

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", 'wss:', 'ws:']
        }
    },
    hsts: true,
    noSniff: true,
    frameguard: { action: 'deny' },
    permissionsPolicy: {
        features: {
            camera: [],
            microphone: [],
            geolocation: []
        }
    }
}));
app.use(cors());

// Rate Limiting
const rateLimitHandler = (req, res) => {
    const resetAt = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + 60000;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(retryAfterSeconds) });
};
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, handler: rateLimitHandler });

app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'pdrs_session_secret_dev',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));
runPIIMigrationOnce();
startCronJobs();

// Configure Multer for Rubrics
const rubricStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/rubrics';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const roomCode = req.params.roomCode;
        cb(null, `${roomCode}.pdf`);
    }
});

const uploadRubric = multer({
    storage: rubricStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDFs are allowed'));
    }
});

// Rubric Upload Route
app.post('/api/panel/room/:roomCode/rubric', (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'faculty') return res.status(403).json({ error: 'Faculty only' });
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}, uploadRubric.single('rubric'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const roomCode = req.params.roomCode;
    const rubricUrl = `/uploads/rubrics/${roomCode}.pdf`;
    
    try {
        db.prepare('UPDATE panel_sessions SET rubric_url = ? WHERE room_code = ?').run(rubricUrl, roomCode);
        res.json({ rubricUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
        const token = tokenService.generateAccessToken(userPayload);
        res.json({ token, user: userPayload });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Routes
app.use('/api/', limiter);
app.use('/api/auth/verify-otp', otpLimiter);
app.use('/api/auth/verify-totp', otpLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/panel', panelRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/flashcards', flashcardsRoutes);
app.use('/api/bookmarks', bookmarksRoutes);
app.use('/api/peer', peerRoutes);
app.use('/api/templates', templatesRoutes);

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

server.listen(port, () => {
    console.log(`PDRS Server running at http://localhost:${port}`);
});
