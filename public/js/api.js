function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

async function apiFetch(url, options = {}) {
    const opts = { ...options };
    
    // Use centralized auth.getHeaders() which handles both Auth and CSRF tokens
    opts.headers = auth.getHeaders(options.headers || {});
    opts.credentials = 'include';

    let response = await fetch(url, opts);
    if (response.status === 401) {
        try {
            await auth.refreshAccessToken();
            const retryOpts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${auth.getToken()}` } };
            response = await fetch(url, retryOpts);
            if (response.status === 401) {
                auth.logout();
                throw new Error('Authentication expired');
            }
        } catch (err) {
            auth.logout();
            throw err;
        }
    }

    if (!response.ok) {
        let msg = 'Request failed';
        try {
            const data = await response.json();
            msg = data.error || msg;
        } catch (_) {}
        if (window.showToast) showToast(msg, 'error');
        throw new Error(msg);
    }
    
    // Auto-unwrap standardized response
    const json = await response.json();
    if (json.success) {
        return json.data;
    }
    return json;
}

window.apiFetch = apiFetch;
