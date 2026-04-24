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

// Global UI Helpers
const ui = {
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
            close();
            onConfirm();
        };
        modal.onclick = (e) => { if (e.target === modal) close(); };
        window.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    },

    initFormValidation(formId) {
        const form = document.getElementById(formId);
        if (!form) return;
        
        form.querySelectorAll('input, textarea').forEach(input => {
            input.oninput = () => {
                input.classList.remove('invalid', 'valid');
                const error = input.parentElement.querySelector('.error-msg');
                if (error) error.remove();
            };

            input.onblur = () => {
                if (input.required && !input.value) {
                    this.showError(input, 'This field is required');
                } else if (input.type === 'email' && input.value && !input.value.includes('@')) {
                    this.showError(input, 'Please enter a valid email');
                } else if (input.value) {
                    input.classList.add('valid');
                }
            };
        });
    },

    showError(input, msg) {
        input.classList.add('invalid');
        let error = input.parentElement.querySelector('.error-msg');
        if (!error) {
            error = document.createElement('div');
            error.className = 'error-msg';
            input.parentElement.appendChild(error);
        }
        error.textContent = msg;
    },

    initCharCounter(id, max) {
        const el = document.getElementById(id);
        if (!el) return;
        const counter = document.createElement('div');
        counter.className = 'char-counter';
        el.parentElement.style.position = 'relative';
        el.parentElement.appendChild(counter);

        const update = () => {
            const len = el.value.length;
            counter.textContent = `${len} / ${max}`;
            counter.classList.toggle('warning', len > max * 0.8);
            counter.classList.toggle('danger', len > max * 0.95);
        };
        el.oninput = update;
        update();
    },

    showSkeleton(containerId, count = 3, type = 'card') {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = Array(count).fill(0).map(() => `
            <div class="skeleton" style="height: ${type === 'card' ? '150px' : '40px'}; width: 100%; margin-bottom: 1rem; border-radius: 12px;"></div>
        `).join('');
    },

    showEmptyState(containerId, icon, title, msg, btnText = null, btnLink = null) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = `
            <div class="empty-state animate-up">
                <span class="empty-state-icon">${icon}</span>
                <h3>${title}</h3>
                <p>${msg}</p>
                ${btnText ? `<button class="btn" style="width: auto;" onclick="window.location.href='${btnLink}'">${btnText}</button>` : ''}
            </div>
        `;
    }
};

window.ui = ui;
window.showToast = showToast;


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
