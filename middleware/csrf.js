const crypto = require('crypto');

/**
 * CSRF Protection Middleware
 * Implements Double Submit Cookie pattern
 */
const csrf = {
    /**
     * Middleware to set a CSRF token in a cookie if it doesn't exist
     */
    tokenSetter: (req, res, next) => {
        if (!req.cookies['XSRF-TOKEN']) {
            const token = crypto.randomBytes(32).toString('hex');
            const isProduction = process.env.NODE_ENV === 'production';
            const disableSecure = process.env.DISABLE_SECURE_COOKIES === 'true';
            
            res.cookie('XSRF-TOKEN', token, {
                httpOnly: false, // Must be accessible by client-side JS
                secure: isProduction && !disableSecure,
                sameSite: 'Lax',
                path: '/'
            });
        }
        next();
    },

    /**
     * Middleware to verify the CSRF token from the header against the cookie
     */
    verify: (req, res, next) => {
        // Skip for GET, HEAD, OPTIONS
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        const cookieToken = req.cookies['XSRF-TOKEN'];
        const headerToken = req.headers['x-xsrf-token'];

        if (!cookieToken || !headerToken || cookieToken !== headerToken) {
            return res.status(403).json({ error: 'Invalid or missing CSRF token' });
        }

        next();
    }
};

module.exports = csrf;
