const axios = require('axios');

const ZOOM_API_KEY = process.env.ZOOM_API_KEY;
const ZOOM_API_SECRET = process.env.ZOOM_API_SECRET;
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;

/**
 * Get Zoom Access Token using Server-to-Server OAuth
 */
async function getAccessToken() {
    const auth = Buffer.from(`${ZOOM_API_KEY}:${ZOOM_API_SECRET}`).toString('base64');
    try {
        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
            {},
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Zoom getAccessToken error:', error.response?.data || error.message);
        throw new Error('Failed to get Zoom access token');
    }
}

/**
 * Create a Zoom meeting
 */
async function createMeeting(topic, startTime, duration) {
    const token = await getAccessToken();
    try {
        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic,
                type: 2, // Scheduled meeting
                start_time: startTime,
                duration,
                timezone: 'UTC',
                settings: {
                    host_video: true,
                    participant_video: true,
                    join_before_host: false,
                    mute_upon_entry: true,
                    waiting_room: true
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return {
            meetingId: response.data.id,
            joinUrl: response.data.join_url,
            startUrl: response.data.start_url
        };
    } catch (error) {
        console.error('Zoom createMeeting error:', error.response?.data || error.message);
        throw new Error('Failed to create Zoom meeting');
    }
}

/**
 * Get details of a Zoom meeting
 */
async function getMeeting(meetingId) {
    const token = await getAccessToken();
    try {
        const response = await axios.get(`https://api.zoom.us/v2/meetings/${meetingId}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Zoom getMeeting error:', error.response?.data || error.message);
        throw new Error('Failed to fetch Zoom meeting details');
    }
}

module.exports = {
    getAccessToken,
    createMeeting,
    getMeeting
};
