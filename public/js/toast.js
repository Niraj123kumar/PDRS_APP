function showToast(message, type = 'info', retryFn = null) {
    const container = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        info: '#2563eb',
        warning: '#f59e0b'
    };

    toast.style.cssText = `
        background: var(--card-bg, white);
        color: var(--text-color, #1e293b);
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
        margin-top: 0.5rem;
        border-left: 6px solid ${colors[type]};
        animation: toastSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        display: flex;
        align-items: center;
        gap: 1rem;
        min-width: 320px;
        max-width: 450px;
        font-weight: 600;
        z-index: 10000;
    `;

    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    
    toast.innerHTML = `
        <span style="font-size: 1.25rem;">${icon}</span>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
            <span>${message}</span>
            ${retryFn ? `<button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; width: auto; margin-top: 0.25rem;">Retry</button>` : ''}
        </div>
        <button style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size: 1.25rem;">&times;</button>
    `;

    if (retryFn) {
        toast.querySelector('button.btn').onclick = () => {
            toast.remove();
            retryFn();
        };
    }

    toast.querySelector('button:last-child').onclick = () => {
        toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    `;
    document.body.appendChild(container);
    return container;
}

// Global UI Helpers
window.ui = Object.assign(window.ui || {}, {
    setLoading(btn, isLoading, originalText = null) {
        if (!btn) return;
        if (isLoading) {
            btn.disabled = true;
            btn.dataset.originalText = originalText || btn.innerHTML;
            btn.innerHTML = `<span class="spinner"></span> <span>Loading...</span>`;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText || 'Submit';
        }
    },

    showConfirm(title, message, onConfirm, destructive = true) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content animate-up">
                <button class="modal-close">&times;</button>
                <h3 style="margin-bottom: 1rem;">${title}</h3>
                <p style="margin-bottom: 2rem; color: var(--text-muted);">${message}</p>
                <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="btn btn-secondary" style="width: auto;" id="confirm-cancel">Cancel</button>
                    <button class="btn ${destructive ? 'btn-destructive' : ''}" style="width: auto;" id="confirm-ok">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => {
            modal.classList.remove('active');
            setTimeout(() => modal.remove(), 300);
        };

        modal.querySelector('.modal-close').onclick = close;
        modal.querySelector('#confirm-cancel').onclick = close;

        modal.querySelector('#confirm-ok').onclick = () => {
            onConfirm();
            close();
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        window.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    }
});
