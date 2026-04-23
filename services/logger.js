const Sentry = require('@sentry/node');

function logInfo(message, context = {}) {
    console.log(`[INFO] ${message}`, context);
}

function logWarn(message, context = {}) {
    console.warn(`[WARN] ${message}`, context);
}

function logError(error, context = {}) {
    console.error(`[ERROR] ${error.message || error}`, context);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
}

function logCritical(message, context = {}) {
    console.error(`[CRITICAL] ${message}`, context);
    if (process.env.SENTRY_DSN) {
        Sentry.captureMessage(message, {
            level: 'fatal',
            extra: context
        });
    }
}

module.exports = {
    logInfo,
    logWarn,
    logError,
    logCritical
};
