const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pdrs_super_secret_key_123';

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server });
    const clients = new Map(); // userId -> ws
    const rooms = new Map(); // roomCode -> Set(userIds)
    const userRooms = new Map(); // userId -> roomCode
    const userRoles = new Map(); // userId -> role
    const roomTimers = new Map(); // roomCode -> interval

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
            userRoles.set(userId, decoded.role);

            console.log(`User ${userId} (${decoded.role}) connected via WebSocket`);

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    handleMessage(ws, data, clients, rooms, userRooms, userRoles, roomTimers);
                } catch (err) {
                    console.error('WS Message error:', err);
                }
            });

            ws.on('close', () => {
                const roomCode = userRooms.get(userId);
                if (roomCode) {
                    const room = rooms.get(roomCode);
                    if (room) {
                        room.delete(userId);
                        broadcastToRoom(roomCode, {
                            type: 'room-leave',
                            payload: {
                                userId,
                                role: userRoles.get(userId),
                                participants: Array.from(room).map(id => ({
                                    userId: id,
                                    role: userRoles.get(id)
                                }))
                            }
                        }, clients, rooms);
                        if (room.size === 0) {
                            rooms.delete(roomCode);
                            const roomTimer = roomTimers.get(roomCode);
                            if (roomTimer) {
                                clearInterval(roomTimer);
                                roomTimers.delete(roomCode);
                            }
                        }
                    }
                    userRooms.delete(userId);
                }
                clients.delete(userId);
                userRoles.delete(userId);
                console.log(`User ${userId} disconnected from WebSocket`);
            });

        } catch (err) {
            console.error('WS Auth error:', err);
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
        broadcastRoom: (roomCode, type, payload = {}) => {
            broadcastToRoom(roomCode, { type, payload }, clients, rooms);
        },
        broadcastFacultyRoom: (roomCode, type, payload = {}) => {
            broadcastToFacultyInRoom(roomCode, { type, payload }, clients, rooms, userRoles);
        }
    };
}

function broadcastToRoom(roomCode, data, clients, rooms, excludeUserId = null) {
    const room = rooms.get(roomCode);
    if (room) {
        room.forEach(userId => {
            if (userId !== excludeUserId) {
                const client = clients.get(userId);
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            }
        });
    }
}

function broadcastToFacultyInRoom(roomCode, data, clients, rooms, userRoles) {
    const room = rooms.get(roomCode);
    if (room) {
        room.forEach(userId => {
            if (userRoles.get(userId) === 'faculty') {
                const client = clients.get(userId);
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            }
        });
    }
}

function handleMessage(ws, data, clients, rooms, userRooms, userRoles, roomTimers) {
    const { type, roomCode, payload, targetId } = data;
    const userId = ws.userId;

    switch (type) {
        case 'room-join':
            if (!roomCode) return;
            if (!rooms.has(roomCode)) rooms.set(roomCode, new Set());
            rooms.get(roomCode).add(userId);
            userRooms.set(userId, roomCode);
            
            // Broadcast join to room
            broadcastToRoom(roomCode, {
                type: 'room-join',
                payload: { 
                    userId, 
                    name: payload.name, 
                    role: userRoles.get(userId),
                    participants: Array.from(rooms.get(roomCode)).map(id => ({
                        userId: id,
                        role: userRoles.get(id)
                    }))
                }
            }, clients, rooms);
            break;

        case 'phase-change':
        case 'panel-question-added':
        case 'panel-question-answered':
        case 'session-paused':
        case 'session-resumed':
        case 'transcript-chunk':
            if (roomCode) {
                broadcastToRoom(roomCode, { type, payload, senderId: userId }, clients, rooms);
            }
            break;

        case 'timer-set':
            if (roomCode) {
                const seconds = Number(payload && payload.seconds);
                if (!Number.isFinite(seconds) || seconds < 1) return;

                const existingTimer = roomTimers.get(roomCode);
                if (existingTimer) {
                    clearInterval(existingTimer);
                    roomTimers.delete(roomCode);
                }

                broadcastToRoom(roomCode, { type: 'timer-set', payload: { seconds }, senderId: userId }, clients, rooms);

                let remaining = seconds;
                const interval = setInterval(() => {
                    remaining -= 1;
                    broadcastToRoom(roomCode, { type: 'timer-tick', payload: { seconds: remaining } }, clients, rooms);
                    if (remaining <= 0) {
                        clearInterval(interval);
                        roomTimers.delete(roomCode);
                    }
                }, 1000);
                roomTimers.set(roomCode, interval);
            }
            break;

        case 'timer-tick':
        case 'teacher-interrupt':
        case 'screen-share-start':
        case 'screen-share-stop':
            if (roomCode) {
                broadcastToRoom(roomCode, { type, payload, senderId: userId }, clients, rooms);
            }
            break;

        case 'raise-hand':
            if (roomCode) {
                broadcastToFacultyInRoom(roomCode, { type, payload: { ...payload, userId }, senderId: userId }, clients, rooms, userRoles);
            }
            break;

        case 'raise-hand-resolved':
            if (roomCode) {
                broadcastToRoom(roomCode, { type, payload }, clients, rooms);
            }
            break;

        case 'chat-message':
            if (roomCode) {
                if (payload.isPrivate) {
                    broadcastToFacultyInRoom(roomCode, { type: 'private-chat', payload, senderId: userId }, clients, rooms, userRoles);
                } else {
                    broadcastToRoom(roomCode, { type, payload, senderId: userId }, clients, rooms);
                }
            }
            break;

        case 'webrtc-offer':
        case 'webrtc-answer':
        case 'webrtc-ice':
            if (targetId) {
                const targetClient = clients.get(targetId);
                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    targetClient.send(JSON.stringify({ type, payload, senderId: userId }));
                }
            }
            break;

        case 'peer-join':
        case 'peer-ready':
        case 'peer-question':
        case 'peer-answer-submitted':
        case 'peer-both-submitted':
        case 'peer-scores':
            if (roomCode) {
                broadcastToRoom(roomCode, { type, payload, senderId: userId }, clients, rooms);
            }
            break;

        default:
            // Legacy support
            if (targetId) {
                const targetClient = clients.get(targetId);
                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    targetClient.send(JSON.stringify({ type, payload, senderId: userId }));
                }
            }
    }
}

module.exports = initWebSocket;
