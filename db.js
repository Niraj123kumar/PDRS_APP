const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'pdrs.db'));

// Performance and Integrity pragmas
db.pragma('journal_mode = WAL');
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
    google_id TEXT,
    github_username TEXT,
    avatar_url TEXT,
    calendar_token TEXT,
    google_event_id TEXT,
    google_event_url TEXT,
    encrypted_email TEXT,
    encrypted_name TEXT,
    is_suspended INTEGER DEFAULT 0,
    suspension_reason TEXT,
    force_password_change INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tech_stack TEXT,
    github_repo_url TEXT,
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
    user_id INTEGER,
    email TEXT NOT NULL,
    ip TEXT,
    success INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suspicious_logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    email TEXT,
    ip_address TEXT,
    reason TEXT,
    resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS coaching_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    weak_dimensions TEXT,
    questions_json TEXT,
    tips_json TEXT,
    improvement_plan_json TEXT,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dimension_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id INTEGER,
    clarity_avg REAL,
    reasoning_avg REAL,
    depth_avg REAL,
    confidence_avg REAL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id INTEGER,
    question_index INTEGER,
    question_text TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS question_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id INTEGER,
    question_index INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    dimension TEXT,
    target_score REAL,
    current_score REAL,
    achieved INTEGER DEFAULT 0,
    achieved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    badge_type TEXT,
    badge_name TEXT,
    description TEXT,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    question TEXT,
    answer TEXT,
    difficulty INTEGER DEFAULT 3,
    next_review DATETIME,
    review_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    endpoint TEXT,
    p256dh TEXT,
    auth TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    scheduled_for DATETIME,
    sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

db.exec(schema);

// Performance Indexes
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_answers_session_id ON answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_user_id ON flashcards(user_id);
    CREATE INDEX IF NOT EXISTS idx_badges_user_id ON badges(user_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS peer_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_a_id INTEGER,
    student_b_id INTEGER,
    room_code TEXT UNIQUE,
    status TEXT DEFAULT 'waiting',
    questions_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flagged_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    faculty_id INTEGER,
    reason TEXT,
    resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER,
    title TEXT,
    message TEXT,
    target_role TEXT DEFAULT 'student',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS defense_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    faculty_id INTEGER,
    scheduled_date DATETIME,
    location TEXT,
    panel_members TEXT,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    project_id INTEGER,
    questions_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function addColumnIfMissing(tableName, columnName, definition) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = columns.some((col) => col.name === columnName);
    if (!exists) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

addColumnIfMissing('users', 'google_id', 'TEXT');
addColumnIfMissing('users', 'github_username', 'TEXT');
addColumnIfMissing('users', 'avatar_url', 'TEXT');
addColumnIfMissing('users', 'calendar_token', 'TEXT');
addColumnIfMissing('users', 'google_event_id', 'TEXT');
addColumnIfMissing('users', 'google_event_url', 'TEXT');
addColumnIfMissing('users', 'encrypted_email', 'TEXT');
addColumnIfMissing('users', 'encrypted_name', 'TEXT');
addColumnIfMissing('users', 'is_suspended', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'suspension_reason', 'TEXT');
addColumnIfMissing('users', 'force_password_change', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'phone_number', 'TEXT');
addColumnIfMissing('users', 'phone_verified', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'sms_notifications', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'push_notifications', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'email_notifications', 'INTEGER DEFAULT 1');
addColumnIfMissing('users', 'email_weekly_reports', 'INTEGER DEFAULT 1');
addColumnIfMissing('users', 'email_defense_reminders', 'INTEGER DEFAULT 1');
addColumnIfMissing('users', 'email_inactivity_alerts', 'INTEGER DEFAULT 1');
addColumnIfMissing('users', 'slack_webhook_url', 'TEXT');
addColumnIfMissing('users', 'whatsapp_number', 'TEXT');
addColumnIfMissing('users', 'zoom_user_id', 'TEXT');
addColumnIfMissing('projects', 'github_repo_url', 'TEXT');
addColumnIfMissing('login_attempts', 'user_id', 'INTEGER');
addColumnIfMissing('users', 'department_id', 'INTEGER');
addColumnIfMissing('sessions', 'time_per_question_json', 'TEXT');
addColumnIfMissing('sessions', 'abandoned_at_question', 'INTEGER');
addColumnIfMissing('peer_sessions', 'current_question_index', 'INTEGER DEFAULT 0');
addColumnIfMissing('peer_sessions', 'answers_json', 'TEXT');
addColumnIfMissing('peer_sessions', 'ready_a', 'INTEGER DEFAULT 0');
addColumnIfMissing('peer_sessions', 'ready_b', 'INTEGER DEFAULT 0');
addColumnIfMissing('sessions', 'replay_data_json', 'TEXT');
addColumnIfMissing('sessions', 'time_stamps_json', 'TEXT');
addColumnIfMissing('sessions', 'summary_pdf_url', 'TEXT');
addColumnIfMissing('sessions', 'hints_state_json', 'TEXT');

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

const seedAdminUser = () => {
    const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existingAdmin) return;
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@pdrs.local';
    const generatedPassword = crypto.randomBytes(10).toString('hex');
    const hash = bcrypt.hashSync(generatedPassword, 12);
    db.prepare(`
        INSERT INTO users (name, email, password_hash, role, force_password_change)
        VALUES (?, ?, ?, 'admin', 1)
    `).run('Platform Admin', adminEmail, hash);
    console.log(`[security] Admin account created: ${adminEmail}`);
    console.log(`[security] Temporary admin password (change immediately): ${generatedPassword}`);
};

seedAdminUser();

module.exports = db;
