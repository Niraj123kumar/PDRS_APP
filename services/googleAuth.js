const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const db = require('../db');
const { encryptField } = require('./encryption');

const hasGoogleConfig = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
);

if (hasGoogleConfig) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL
            },
            (accessToken, refreshToken, profile, done) => {
                try {
                    const googleId = profile.id;
                    const email = profile.emails?.[0]?.value?.toLowerCase();
                    const displayName = profile.displayName || email || 'Google User';
                    const avatarUrl = profile.photos?.[0]?.value || null;

                    if (!email) {
                        return done(new Error('Google account email is required'));
                    }

                    const existingGoogle = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
                    if (existingGoogle) {
                        return done(null, { ...existingGoogle, googleAccessToken: accessToken, googleRefreshToken: refreshToken });
                    }

                    const existingEmail = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
                    if (existingEmail) {
                        db.prepare(`
                            UPDATE users
                            SET google_id = ?, avatar_url = COALESCE(?, avatar_url),
                                encrypted_email = COALESCE(encrypted_email, ?),
                                encrypted_name = COALESCE(encrypted_name, ?)
                            WHERE id = ?
                        `).run(googleId, avatarUrl, encryptField(email), encryptField(displayName), existingEmail.id);
                        const linked = db.prepare('SELECT * FROM users WHERE id = ?').get(existingEmail.id);
                        return done(null, { ...linked, googleAccessToken: accessToken, googleRefreshToken: refreshToken });
                    }

                    const randomPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
                    const info = db.prepare(`
                        INSERT INTO users (name, email, password_hash, role, google_id, avatar_url, encrypted_email, encrypted_name)
                        VALUES (?, ?, ?, 'student', ?, ?, ?, ?)
                    `).run(displayName, email, randomPasswordHash, googleId, avatarUrl, encryptField(email), encryptField(displayName));
                    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
                    return done(null, { ...created, googleAccessToken: accessToken, googleRefreshToken: refreshToken });
                } catch (err) {
                    return done(err);
                }
            }
        )
    );
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        done(null, user || null);
    } catch (err) {
        done(err);
    }
});

module.exports = passport;
