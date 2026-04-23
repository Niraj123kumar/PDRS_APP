const auth = {
    saveToken(token, user) {
        localStorage.setItem('pdrs_token', token);
        localStorage.setItem('pdrs_user', JSON.stringify(user));
    },

    getToken() {
        return localStorage.getItem('pdrs_token');
    },

    getUser() {
        const user = localStorage.getItem('pdrs_user');
        return user ? JSON.parse(user) : null;
    },

    logout() {
        localStorage.removeItem('pdrs_token');
        localStorage.removeItem('pdrs_user');
        window.location.href = '/login.html';
    },

    requireAuth() {
        if (!this.getToken()) {
            window.location.href = '/login.html';
        }
    },

    requireRole(role) {
        const user = this.getUser();
        if (!user || user.role !== role) {
            const redirect = user?.role === 'faculty' ? '/faculty.html' : '/student.html';
            window.location.href = redirect;
        }
    }
};

window.auth = auth;
