async function apiFetch(url, options = {}) {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    const token = auth.getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
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
    return response;
}

window.apiFetch = apiFetch;
