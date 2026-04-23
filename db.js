const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'pdrs.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('student', 'faculty', 'admin')) NOT NULL,
    defense_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tech_stack TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    questions_json TEXT,
    status TEXT CHECK(status IN ('pending', 'active', 'completed')) DEFAULT 'pending',
    overall_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    tier TEXT,
    clarity_score REAL,
    reasoning_score REAL,
    depth_score REAL,
    confidence_score REAL,
    feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panel_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    faculty_id INTEGER NOT NULL,
    student_id INTEGER,
    status TEXT CHECK(status IN ('scheduled', 'ongoing', 'ended')) DEFAULT 'scheduled',
    room_code TEXT UNIQUE,
    phase TEXT DEFAULT 'waiting',
    panel_questions_json TEXT DEFAULT '[]',
    rubric_url TEXT,
    full_transcript TEXT DEFAULT '',
    is_paused INTEGER DEFAULT 0,
    time_per_question INTEGER DEFAULT 180,
    started_at DATETIME,
    ended_at DATETIME,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panel_chat ( 
   id INTEGER PRIMARY KEY AUTOINCREMENT, 
   panel_session_id INTEGER, 
   sender_id INTEGER, 
   sender_name TEXT, 
   message TEXT, 
   is_private INTEGER DEFAULT 0, 
   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
   FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
   FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
); 
 
CREATE TABLE IF NOT EXISTS raise_hand_events ( 
   id INTEGER PRIMARY KEY AUTOINCREMENT, 
   panel_session_id INTEGER, 
   student_id INTEGER, 
   reason TEXT, 
   resolved INTEGER DEFAULT 0, 
   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
   FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
   FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
); 

CREATE TABLE IF NOT EXISTS panel_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_session_id INTEGER,
    faculty_id INTEGER,
    faculty_name TEXT,
    question_index INTEGER,
    clarity INTEGER,
    reasoning INTEGER,
    depth INTEGER,
    confidence INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whiteboard_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_session_id INTEGER,
    faculty_id INTEGER,
    event_type TEXT,
    data_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panel_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_session_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    role TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    left_at DATETIME,
    total_minutes INTEGER,
    FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER,
    question TEXT NOT NULL,
    category TEXT,
    difficulty TEXT DEFAULT 'medium',
    times_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS breakout_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_session_id INTEGER,
    room_name TEXT,
    faculty_ids_json TEXT,
    messages_json TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS totp_secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    secret TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    device_name TEXT,
    device_type TEXT,
    browser TEXT,
    ip_address TEXT,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_email TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    faculty_id INTEGER NOT NULL,
    message TEXT,
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT,
    title TEXT NOT NULL,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panel_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_session_id INTEGER NOT NULL,
    faculty_id INTEGER NOT NULL,
    question_index INTEGER,
    note TEXT,
    score_override REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_session_id) REFERENCES panel_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip TEXT,
    success INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(schema);

// Seed demo accounts
const seedUsers = () => {
    const checkUser = db.prepare('SELECT id FROM users WHERE email = ?');
    const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');

    const users = [
        { name: 'Demo Student', email: 'demo_student@pdrs.com', password: 'demo1234', role: 'student' },
        { name: 'Demo Faculty', email: 'demo_faculty@pdrs.com', password: 'demo1234', role: 'faculty' }
    ];

    for (const user of users) {
        if (!checkUser.get(user.email)) {
            const hash = bcrypt.hashSync(user.password, 10);
            insertUser.run(user.name, user.email, hash, user.role);
        }
    }
};

seedUsers();

module.exports = db;
