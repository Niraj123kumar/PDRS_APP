const db = require('../db');

const BADGES = {
    first_session: { name: 'First Session', description: 'Completed your first rehearsal session.' },
    five_sessions: { name: 'Five Sessions', description: 'Completed 5 rehearsal sessions.' },
    ten_sessions: { name: 'Ten Sessions', description: 'Completed 10 rehearsal sessions.' },
    first_perfect: { name: 'Perfect Dimension', description: 'Scored 100 in at least one dimension.' },
    consistency: { name: 'Consistency', description: 'Practiced 7 days in a row.' },
    improvement: { name: 'Improvement', description: 'Improved overall score by 20% from baseline.' },
    coaching_complete: { name: 'Coaching Complete', description: 'Completed a coaching session.' },
    panel_veteran: { name: 'Panel Veteran', description: 'Participated in 3 panel sessions.' },
    speed_demon: { name: 'Speed Demon', description: 'Completed a session in under 20 minutes.' },
    deep_diver: { name: 'Deep Diver', description: 'Scored 4.5+ equivalent in depth.' },
    comeback: { name: 'Comeback', description: 'Recovered after 3 below-average sessions.' }
};

function hasBadge(userId, type) {
    return !!db.prepare('SELECT id FROM badges WHERE user_id = ? AND badge_type = ?').get(userId, type);
}

function awardBadge(userId, type) {
    if (!BADGES[type] || hasBadge(userId, type)) return false;
    const info = BADGES[type];
    db.prepare('INSERT INTO badges (user_id, badge_type, badge_name, description) VALUES (?, ?, ?, ?)')
        .run(userId, type, info.name, info.description);
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)')
        .run(userId, 'badge', `Badge Earned: ${info.name}`, info.description);
    return true;
}

function checkAndAward(userId) {
    const completedSessions = db.prepare(`
        SELECT * FROM sessions
        WHERE user_id = ? AND status = 'completed'
        ORDER BY datetime(created_at) ASC
    `).all(userId);
    const awarded = [];

    if (completedSessions.length >= 1 && awardBadge(userId, 'first_session')) awarded.push('first_session');
    if (completedSessions.length >= 5 && awardBadge(userId, 'five_sessions')) awarded.push('five_sessions');
    if (completedSessions.length >= 10 && awardBadge(userId, 'ten_sessions')) awarded.push('ten_sessions');

    const perfect = db.prepare(`
        SELECT a.id FROM answers a
        JOIN sessions s ON s.id = a.session_id
        WHERE s.user_id = ? AND (
            a.clarity_score >= 100 OR a.reasoning_score >= 100 OR a.depth_score >= 100 OR a.confidence_score >= 100
        )
        LIMIT 1
    `).get(userId);
    if (perfect && awardBadge(userId, 'first_perfect')) awarded.push('first_perfect');

    const depthElite = db.prepare(`
        SELECT a.id FROM answers a
        JOIN sessions s ON s.id = a.session_id
        WHERE s.user_id = ? AND a.depth_score >= 90
        LIMIT 1
    `).get(userId);
    if (depthElite && awardBadge(userId, 'deep_diver')) awarded.push('deep_diver');

    const coachingDone = db.prepare('SELECT id FROM coaching_sessions WHERE user_id = ? AND completed = 1 LIMIT 1').get(userId);
    if (coachingDone && awardBadge(userId, 'coaching_complete')) awarded.push('coaching_complete');

    const panelCount = db.prepare('SELECT COUNT(*) AS n FROM panel_sessions WHERE student_id = ?').get(userId).n;
    if (panelCount >= 3 && awardBadge(userId, 'panel_veteran')) awarded.push('panel_veteran');

    if (completedSessions.length >= 2) {
        const baseline = completedSessions[0].overall_score || 0;
        const latest = completedSessions[completedSessions.length - 1].overall_score || 0;
        if (baseline > 0 && latest >= baseline * 1.2 && awardBadge(userId, 'improvement')) awarded.push('improvement');
    }

    const sevenStreak = db.prepare(`
        SELECT COUNT(DISTINCT date(created_at)) AS days
        FROM sessions
        WHERE user_id = ? AND status = 'completed' AND datetime(created_at) >= datetime('now', '-7 days')
    `).get(userId).days;
    if (sevenStreak >= 7 && awardBadge(userId, 'consistency')) awarded.push('consistency');

    const speed = db.prepare(`
        SELECT s.id AS session_id FROM sessions s
        JOIN (
            SELECT session_id, MIN(created_at) AS start_at, MAX(created_at) AS end_at
            FROM answers GROUP BY session_id
        ) a ON a.session_id = s.id
        WHERE s.user_id = ? AND s.status = 'completed'
          AND ((strftime('%s', a.end_at) - strftime('%s', a.start_at)) / 60.0) < 20
        LIMIT 1
    `).get(userId);
    if (speed && awardBadge(userId, 'speed_demon')) awarded.push('speed_demon');

    if (completedSessions.length >= 4) {
        const scores = completedSessions.map((s) => Number(s.overall_score || 0));
        const last4 = scores.slice(-4);
        const first3Avg = (last4[0] + last4[1] + last4[2]) / 3;
        if (first3Avg < 60 && last4[3] > first3Avg && awardBadge(userId, 'comeback')) awarded.push('comeback');
    }

    return awarded;
}

function getBadges(userId) {
    return db.prepare('SELECT * FROM badges WHERE user_id = ? ORDER BY datetime(earned_at) DESC').all(userId);
}

module.exports = {
    checkAndAward,
    getBadges,
    BADGES
};
