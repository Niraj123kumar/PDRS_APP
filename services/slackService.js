const { IncomingWebhook } = require('@slack/webhook');

/**
 * Send a generic message to a Slack webhook
 */
async function sendMessage(webhookUrl, message) {
    if (!webhookUrl) return;
    const webhook = new IncomingWebhook(webhookUrl);
    try {
        await webhook.send(message);
    } catch (error) {
        console.error('Slack sendMessage error:', error);
        throw error;
    }
}

/**
 * Send a formatted defense session alert
 */
async function sendDefenseAlert(webhookUrl, studentName, score, details = {}) {
    const message = {
        text: `Defense Rehearsal Completed: ${studentName}`,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '🚀 Defense Rehearsal Completed',
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Student:*\n${studentName}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Overall Score:*\n${score}/100`
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Score Breakdown:*\nClarity: ${details.clarity || 0} | Reasoning: ${details.reasoning || 0} | Depth: ${details.depth || 0} | Confidence: ${details.confidence || 0}`
                }
            },
            {
                type: 'divider'
            }
        ]
    };
    return sendMessage(webhookUrl, message);
}

/**
 * Send a weekly cohort summary
 */
async function sendWeeklyDigest(webhookUrl, cohortStats) {
    const { cohortName, totalSessions, avgScore, topStudent } = cohortStats;
    const message = {
        text: `Weekly Cohort Digest: ${cohortName}`,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `📊 Weekly Digest: ${cohortName}`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Total Sessions:*\n${totalSessions}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Average Score:*\n${avgScore}%`
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Top Performer:*\n${topStudent || 'N/A'}`
                }
            }
        ]
    };
    return sendMessage(webhookUrl, message);
}

module.exports = {
    sendMessage,
    sendDefenseAlert,
    sendWeeklyDigest
};
