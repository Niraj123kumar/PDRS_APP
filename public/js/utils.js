
window.ui = Object.assign(window.ui || {}, {
    /**
     * Set loading state on a button
     * @param {HTMLElement} btn - The button element
     * @param {boolean} isLoading - Whether it's loading
     * @param {string} [loadingText] - Optional text/html to show during loading
     */
    setLoading: (btn, isLoading, loadingText) => {
        if (!btn) return;
        if (isLoading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = loadingText || '<span class="spinner"></span> Loading...';
        } else {
            btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
            btn.disabled = false;
        }
    },

    /**
     * Show an error message on an input
     * @param {HTMLElement} input - The input element
     * @param {string} message - The error message
     */
    showError: (input, message) => {
        if (!input) return;
        input.classList.remove('valid');
        input.classList.add('invalid');
        const parent = input.parentElement;
        let errorMsg = parent.querySelector('.error-msg');
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.className = 'error-msg';
            parent.appendChild(errorMsg);
        }
        errorMsg.textContent = message;
        errorMsg.style.display = 'block';
        
        const clear = () => {
            input.classList.remove('invalid');
            if (input.value) input.classList.add('valid');
            errorMsg.style.display = 'none';
        };
        input.addEventListener('input', clear, { once: true });
    },

    /**
     * Clear error state
     * @param {HTMLElement} input 
     */
    clearError: (input) => {
        if (!input) return;
        input.classList.remove('invalid');
        if (input.value) input.classList.add('valid');
        const errorMsg = input.parentElement.querySelector('.error-msg');
        if (errorMsg) errorMsg.style.display = 'none';
    },

    /**
     * Initialize basic form validation
     * @param {string} formId - The ID of the form
     */
    initFormValidation: (formId) => {
        const form = document.getElementById(formId);
        if (!form) return;
        
        form.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('blur', () => {
                if (input.hasAttribute('required') && !input.value) {
                    ui.showError(input, 'This field is required');
                } else if (input.value) {
                    input.classList.add('valid');
                    input.classList.remove('invalid');
                }
            });

            input.addEventListener('input', () => {
                if (input.classList.contains('invalid')) {
                    ui.clearError(input);
                }
            });
        });
    },

    /**
     * Format a date string
     * @param {string} dateStr - ISO date string
     * @returns {string} Formatted date
     */
    formatDate: (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Show empty state UI
     * @param {string} containerId - Container to render in
     * @param {string} icon - Emoji icon
     * @param {string} title - Main title
     * @param {string} message - Description
     * @param {string} btnText - Action button text
     * @param {string} btnLink - Action button link
     */
    showEmptyState: (containerId, icon, title, message, btnText, btnLink) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                <div style="font-size: 3rem; margin-bottom: 1rem;">${icon}</div>
                <h3 style="margin-bottom: 0.5rem; color: var(--text-color);">${title}</h3>
                <p style="margin-bottom: 1.5rem; max-width: 300px; margin-left: auto; margin-right: auto;">${message}</p>
                ${btnText ? `<a href="${btnLink}" class="btn btn-secondary">${btnText}</a>` : ''}
            </div>
        `;
    },

    /**
     * Show skeleton loaders
     * @param {string} containerId - Container to render in
     * @param {number} count - Number of items
     * @param {string} type - 'list' or 'card'
     */
    showSkeleton: (containerId, count = 3, type = 'list') => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const skeleton = type === 'list' 
            ? `<div class="skeleton skeleton-text" style="height: 50px; margin-bottom: 1rem; border-radius: 8px;"></div>`
            : `<div class="skeleton" style="height: 150px; margin-bottom: 1rem; border-radius: 12px;"></div>`;
            
        container.innerHTML = Array(count).fill(skeleton).join('');
    },

    /**
     * Show a confirmation modal
     * @param {string} title - Modal title
     * @param {string} message - Modal message
     * @param {Function} onConfirm - Callback for confirm button
     */
    showConfirm: (title, message, onConfirm) => {
        let modal = document.getElementById('confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirm-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <button class="modal-close">&times;</button>
                    <h2 style="margin-bottom: 1rem;">${title}</h2>
                    <p style="margin-bottom: 2rem; color: var(--text-muted);">${message}</p>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button class="btn btn-secondary cancel-btn" style="width: auto;">Cancel</button>
                        <button class="btn btn-destructive confirm-btn" style="width: auto;">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.querySelector('h2').textContent = title;
            modal.querySelector('p').textContent = message;
        }

        const close = () => modal.classList.remove('active');
        const confirmBtn = modal.querySelector('.confirm-btn');
        const cancelBtn = modal.querySelector('.cancel-btn');
        const closeBtn = modal.querySelector('.modal-close');

        modal.classList.add('active');

        confirmBtn.onclick = () => {
            onConfirm();
            close();
        };
        cancelBtn.onclick = close;
        closeBtn.onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
        
        // Escape key listener
        const escListener = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escListener);
            }
        };
        document.addEventListener('keydown', escListener);
    },

    /**
     * Show a prompt modal with an input field
     * @param {string} title - Modal title
     * @param {string} message - Modal message
     * @param {string} defaultValue - Default input value
     * @param {Function} onConfirm - Callback with input value
     */
    showPrompt: (title, message, defaultValue, onConfirm) => {
        let modal = document.getElementById('prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'prompt-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <button class="modal-close">&times;</button>
                    <h2 style="margin-bottom: 1rem;">${title}</h2>
                    <p style="margin-bottom: 1rem; color: var(--text-muted);">${message}</p>
                    <div class="form-group" style="margin-bottom: 2rem;">
                        <input type="text" id="prompt-input" class="btn-input" style="width: 100%;" />
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button class="btn btn-secondary cancel-btn" style="width: auto;">Cancel</button>
                        <button class="btn confirm-btn" style="width: auto;">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.querySelector('h2').textContent = title;
            modal.querySelector('p').textContent = message;
        }

        const input = modal.querySelector('#prompt-input');
        input.value = defaultValue || '';
        
        const close = () => modal.classList.remove('active');
        const confirmBtn = modal.querySelector('.confirm-btn');
        const cancelBtn = modal.querySelector('.cancel-btn');
        const closeBtn = modal.querySelector('.modal-close');

        modal.classList.add('active');
        setTimeout(() => input.focus(), 100);

        confirmBtn.onclick = () => {
            const val = input.value.trim();
            if (val) {
                onConfirm(val);
                close();
            } else {
                input.classList.add('invalid');
            }
        };
        cancelBtn.onclick = close;
        closeBtn.onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
        
        const escListener = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escListener);
            }
        };
        document.addEventListener('keydown', escListener);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') confirmBtn.click();
        };
    },

    /**
     * Initialize character counter for a textarea
     * @param {string} textareaId - ID of the textarea
     * @param {string} counterId - ID of the counter element
     * @param {number} maxLength - Maximum length
     */
    initCharCounter: (textareaId, counterId, maxLength) => {
        const textarea = document.getElementById(textareaId);
        const counter = document.getElementById(counterId);
        if (!textarea || !counter) return;

        const update = () => {
            const length = textarea.value.length;
            counter.textContent = `${length}/${maxLength}`;
            
            counter.classList.remove('warning', 'danger');
            if (length >= maxLength * 0.95) {
                counter.classList.add('danger');
            } else if (length >= maxLength * 0.8) {
                counter.classList.add('warning');
            }
        };

        textarea.addEventListener('input', update);
        update();
    },

    /**
     * Toggle password visibility
     * @param {string} inputId - ID of the password input
     * @param {HTMLElement} btn - The toggle button element
     */
    togglePassword: (inputId, btn) => {
        const input = document.getElementById(inputId);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
        }
    }
});
