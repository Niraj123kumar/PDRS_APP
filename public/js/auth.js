const auth = {
    saveToken(token, user) {
        window.__pdrsAccessToken = token || null;
        if (token) localStorage.setItem('pdrs_access_token', token);
        if (user) localStorage.setItem('pdrs_user', JSON.stringify(user));
    },

    getToken() {
        if (!window.__pdrsAccessToken) {
            window.__pdrsAccessToken = localStorage.getItem('pdrs_access_token');
        }
        return window.__pdrsAccessToken || null;
    },

    getUser() {
        const user = localStorage.getItem('pdrs_user');
        return user ? JSON.parse(user) : null;
    },

    logout() {
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include'
        }).finally(() => {
            window.__pdrsAccessToken = null;
            Object.keys(localStorage).filter(k => k.startsWith('pdrs_')) 
                .forEach(k => localStorage.removeItem(k));
            window.location.href = '/login.html';
        });
    },

    requireAuth() {
        if (window.__authChecked) return;
        window.__authChecked = true;
        if (!localStorage.getItem('pdrs_user')) {
            if (!window.location.pathname.endsWith('/login.html')) {
                window.location.href = '/login.html';
            }
        }
    },

    requireRole(role) {
        const user = this.getUser();
        if (!user) return; // Let requireAuth handle missing user
        if (user.role !== role) {
            const redirect = user.role === 'admin' ? '/admin.html' : (user.role === 'faculty' ? '/faculty.html' : '/student.html');
            if (!window.location.pathname.endsWith(redirect)) {
                window.location.href = redirect;
            }
        }
    },

    getDeviceId() {
        return localStorage.getItem('pdrs_device_id');
    },

    getHeaders(extraHeaders = {}) {
        const headers = { ...extraHeaders };
        const token = this.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const csrfToken = document.cookie.split('; ').find(row => row.startsWith('XSRF-TOKEN='))?.split('=')[1];
        if (csrfToken) headers['X-XSRF-TOKEN'] = csrfToken;
        
        return headers;
    },

    setDeviceId(deviceId) {
        if (deviceId) localStorage.setItem('pdrs_device_id', String(deviceId));
    },

    getTimeoutMs() {
        const enabled = localStorage.getItem('pdrs_auto_logout_enabled');
        if (enabled === 'false') return null;
        const pref = localStorage.getItem('pdrs_timeout_ms');
        return Number(pref) || 30 * 60 * 1000;
    },

    startInactivityMonitor() {
        if (!this.getToken()) return;
        const timeoutMs = this.getTimeoutMs();
        if (!timeoutMs) return;

        const warningMs = 2 * 60 * 1000;
        let lastInteraction = Date.now();
        let warningShown = false;
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        const reset = () => {
            lastInteraction = Date.now();
            if (warningShown) {
                const warning = document.getElementById('session-timeout-warning');
                if (warning) warning.remove();
                warningShown = false;
            }
        };

        events.forEach(evt => window.addEventListener(evt, reset, { passive: true }));

        setInterval(() => {
            const idle = Date.now() - lastInteraction;
            if (!warningShown && idle > Math.max(timeoutMs - warningMs, 0)) {
                warningShown = true;
                this.showTimeoutWarning(reset);
            }
            if (idle >= timeoutMs) {
                this.logout();
            }
        }, 60000);
    },

    showTimeoutWarning(stayCallback) {
        if (document.getElementById('session-timeout-warning')) return;
        const modal = document.createElement('div');
        modal.id = 'session-timeout-warning';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:12px;max-width:420px;width:90%;padding:20px;">
                <h3 style="margin:0 0 10px;">Session Timeout Warning</h3>
                <p style="margin:0 0 16px;color:#334155;">You will be logged out in 2 minutes due to inactivity.</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="stay-logged-btn" style="padding:8px 12px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;">Stay Logged In</button>
                    <button id="logout-now-btn" style="padding:8px 12px;background:#e2e8f0;border:none;border-radius:8px;cursor:pointer;">Log Out Now</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('stay-logged-btn').onclick = () => {
            stayCallback();
        };
        document.getElementById('logout-now-btn').onclick = () => this.logout();
    },

    _refreshPromise: null,

    async refreshAccessToken() {
        if (this._refreshPromise) return this._refreshPromise;

        this._refreshPromise = (async () => {
            try {
                const res = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: this.getHeaders(),
                    credentials: 'include'
                });
                if (!res.ok) throw new Error('refresh failed');
                const data = await res.json();
                window.__pdrsAccessToken = data.token;
                return data.token;
            } catch (err) {
                this.logout();
                throw err;
            } finally {
                this._refreshPromise = null;
            }
        })();

        return this._refreshPromise;
    }
};

window.auth = auth;
auth.startInactivityMonitor();
(function bootstrapAccessToken() {
    if (localStorage.getItem('pdrs_user') && !window.__pdrsAccessToken) {
        auth.refreshAccessToken().catch(() => {});
    }
})();
