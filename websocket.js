const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server });
    const clients = new Map(); // userId -> ws

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            ws.close(1008, 'Token required');
            return;
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const userId = decoded.id;
            clients.set(userId, ws);
            ws.userId = userId;

            console.log(`User ${userId} connected via WebSocket`);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    handleMessage(ws, data, clients);
                } catch (err) {
                    console.error('WS Message error:', err);
                }
            });

            ws.on('close', () => {
                clients.delete(userId);
                console.log(`User ${userId} disconnected from WebSocket`);
            });

        } catch (err) {
            ws.close(1008, 'Invalid token');
        }
    });

    return {
        notifyUser: (userId, data) => {
            const client = clients.get(userId);
            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        },
        broadcastToFaculty: (data) => {
            // This would require checking user roles, which we can store in the clients map or a separate set
            // For now, simple implementation
            clients.forEach((ws) => {
                // In a real app, we'd verify if the user is faculty before sending
                ws.send(JSON.stringify(data));
            });
        }
    };
}

function handleMessage(ws, data, clients) {
    const { type, targetId, payload } = data;

    // Handle signaling for WebRTC and Real-time Panel
    if (['offer', 'answer_sdp', 'ice_candidate', 'question', 'answer', 'score', 'interrupt', 'end'].includes(type)) {
        const targetClient = clients.get(targetId);
        if (targetClient && targetClient.readyState === WebSocket.OPEN) {
            targetClient.send(JSON.stringify({
                type,
                senderId: ws.userId,
                payload
            }));
        }
    }
}

module.exports = initWebSocket;
