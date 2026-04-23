class PDRS_WS {
    constructor() {
        this.ws = null;
        this.handlers = new Map();
        this.queue = [];
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000;
        this.statusDot = null;
        this.connect();
    }

    connect() {
        const token = auth.getToken();
        if (!token) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}?token=${token}`;
        
        this.ws = new WebSocket(url);
        this.updateStatus('amber');

        this.ws.onopen = () => {
            console.log('Connected to PDRS WebSocket');
            this.reconnectAttempts = 0;
            this.updateStatus('green');
            this.flushQueue();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const handler = this.handlers.get(data.type);
                if (handler) handler(data.payload || data);
            } catch (err) {
                console.error('WS parse error:', err);
            }
        };

        this.ws.onclose = () => {
            this.updateStatus('red');
            this.attemptReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket Error:', err);
            this.ws.close();
        };
    }

    attemptReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
        this.reconnectAttempts++;
        console.log(`Reconnecting in ${delay/1000}s...`);
        this.updateStatus('amber');
        setTimeout(() => this.connect(), delay);
    }

    updateStatus(color) {
        if (!this.statusDot) {
            this.statusDot = document.getElementById('ws-status');
        }
        if (this.statusDot) {
            this.statusDot.style.backgroundColor = color === 'green' ? '#22c55e' : color === 'amber' ? '#f59e0b' : '#ef4444';
        }
    }

    on(type, handler) {
        this.handlers.set(type, handler);
    }

    emit(type, payload = {}, roomCode = null, targetId = null) {
        const msg = JSON.stringify({ type, payload, roomCode, targetId });
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.queue.push(msg);
        }
    }

    flushQueue() {
        while (this.queue.length > 0) {
            this.ws.send(this.queue.shift());
        }
    }
}

window.pdrsWS = new PDRS_WS();
