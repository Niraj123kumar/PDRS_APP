function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        info: '#2563eb'
    };

    toast.style.cssText = `
        background: white;
        color: #1e293b;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
        margin-top: 0.5rem;
        border-left: 4px solid ${colors[type]};
        animation: toastSlideIn 0.3s ease-out forwards;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 300px;
        font-weight: 500;
    `;

    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    `;
    document.body.appendChild(container);
    return container;
}

// Global error handler for fetch
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    try {
        const response = await originalFetch(...args);
        if (!response.ok) {
            const data = await response.clone().json().catch(() => ({}));
            if (data.error) showToast(data.error, 'error');
        }
        return response;
    } catch (err) {
        showToast('Network error or server unavailable', 'error');
        throw err;
    }
};

window.showToast = showToast;
