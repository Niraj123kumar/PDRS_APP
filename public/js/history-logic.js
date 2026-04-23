document.addEventListener('DOMContentLoaded', async () => {
    auth.requireAuth();
    auth.requireRole('student');

    const list = document.getElementById('session-list');
    const loading = document.getElementById('loading-history');
    const empty = document.getElementById('empty-history');
    const historyTabBtns = document.querySelectorAll('[data-history-tab]');
    const historyPanelSessions = document.getElementById('history-panel-sessions');
    const historyPanelTemplates = document.getElementById('history-panel-templates');
    const loadingTemplates = document.getElementById('loading-templates');
    const templatesList = document.getElementById('templates-list');
    const emptyTemplates = document.getElementById('empty-templates');

    async function loadTemplates() {
        if (!templatesList) return;
        if (loadingTemplates) loadingTemplates.style.display = 'block';
        try {
            const res = await fetch('/api/templates', {
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) throw new Error();
            const arr = await res.json();
            if (loadingTemplates) loadingTemplates.style.display = 'none';
            if (!arr.length) {
                templatesList.innerHTML = '';
                if (emptyTemplates) emptyTemplates.style.display = 'block';
                return;
            }
            if (emptyTemplates) emptyTemplates.style.display = 'none';
            templatesList.innerHTML = arr
                .map((t) => {
                    let n = 0;
                    try {
                        n = (JSON.parse(t.questions_json || '[]') || []).length;
                    } catch (e) {
                        n = 0;
                    }
                    return `
            <div class="template-card">
                <div>
                    <strong>${escapeCh(t.name)}</strong>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${escapeCh(t.project_title || 'Project')}</div>
                    <div style="font-size: 0.85rem; margin-top: 0.25rem;">${n} questions</div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button type="button" class="btn" style="width: auto; padding: 0.5rem 1rem;" onclick="useTemplate(${t.id})">Use template</button>
                    <button type="button" class="btn btn-secondary" style="width: auto; padding: 0.5rem 1rem;" onclick="deleteTemplate(${t.id})">Delete</button>
                </div>
            </div>`;
                })
                .join('');
        } catch (e) {
            if (loadingTemplates) loadingTemplates.style.display = 'none';
            showToast('Failed to load templates', 'error');
        }
    }
    function escapeCh(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }
    historyTabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const t = btn.getAttribute('data-history-tab');
            historyTabBtns.forEach((b) => {
                const on = b.getAttribute('data-history-tab') === t;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            if (historyPanelSessions) historyPanelSessions.style.display = t === 'sessions' ? 'block' : 'none';
            if (historyPanelTemplates) historyPanelTemplates.style.display = t === 'templates' ? 'block' : 'none';
            if (t === 'templates') loadTemplates();
        });
    });

    window.useTemplate = (id) => {
        window.location.href = `/session.html?template=${id}`;
    };
    window.deleteTemplate = async (id) => {
        if (!window.confirm('Delete this template?')) return;
        try {
            const res = await fetch(`/api/templates/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) throw new Error();
            showToast('Template removed', 'success');
            loadTemplates();
        } catch (e) {
            showToast('Delete failed', 'error');
        }
    };
    window.createTemplateFromSession = async (sessionId) => {
        const def = `Rehearsal ${new Date().toLocaleDateString()}`;
        const name = window.prompt('Template name:', def);
        if (name === null || !String(name).trim()) return;
        try {
            const res = await fetch(`/api/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) throw new Error();
            const s = await res.json();
            let questions = [];
            try {
                questions = JSON.parse(s.questions_json || '[]');
            } catch (e) {
                questions = [];
            }
            if (!questions.length && s.answers && s.answers.length) {
                questions = s.answers.map((a) => ({
                    question: a.question,
                    tier: a.tier || 1,
                    tier_label: a.tier ? `Tier ${a.tier}` : 'Question',
                    modelAnswer: '',
                    keyPoints: []
                }));
            }
            if (!questions.length) {
                showToast('No questions found for this session', 'error');
                return;
            }
            const r2 = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.getToken()}` },
                body: JSON.stringify({ name: String(name).trim(), projectId: s.project_id, questionsJson: questions })
            });
            if (!r2.ok) throw new Error();
            showToast('Template created', 'success');
            if (historyPanelTemplates && historyPanelTemplates.style.display === 'block') loadTemplates();
        } catch (e) {
            showToast('Could not create template', 'error');
        }
    };

    const exportBtn = document.getElementById('export-progress-btn');
    if (exportBtn) {
        exportBtn.onclick = async () => {
            const res = await fetch('/api/student/export-report', {
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) return showToast('Failed to export report', 'error');
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'progress-report.pdf';
            link.click();
            URL.revokeObjectURL(link.href);
        };
    }

    try {
        const token = auth.getToken();
        const res = await fetch('/api/sessions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessions = await res.json();

        if (sessions.length === 0) {
            loading.style.display = 'none';
            empty.style.display = 'block';
        } else {
            const completedSessions = sessions.filter((s) => s.status === 'completed').reverse();
            const chartLabels = completedSessions.map((s) => new Date(s.created_at).toLocaleDateString());
            const chartScores = completedSessions.map((s) => s.overall_score);
            charts.renderTrendLine('trendChart', chartLabels, chartScores);

            list.innerHTML = sessions
                .map(
                    (s) => `
            <div class="session-row">
                <div class="session-header" onclick="toggleDetails(${s.id})">
                    <div>
                        <strong style="display: block;">${s.project_title}</strong>
                        <small style="color: var(--text-muted);">${new Date(s.created_at).toLocaleDateString()}</small>
                        <div>
                            <button type="button" class="btn btn-secondary" style="width: auto; margin-top: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="event.stopPropagation(); createTemplateFromSession(${s.id})">Create template from session</button>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <span class="status-badge status-${s.status}">${s.status}</span>
                        <span style="font-weight: 800; color: var(--primary-color); font-size: 1.25rem;">
                            ${s.overall_score ? Math.round(s.overall_score) : '--'}
                        </span>
                    </div>
                </div>
                <div id="details-${s.id}" class="session-details">
                    <div class="skeleton" style="height: 100px; width: 100%;"></div>
                </div>
            </div>`
                )
                .join('');

            loading.style.display = 'none';
            list.style.display = 'block';
        }

    } catch (err) {
        console.error('History load error:', err);
        showToast('Failed to load history', 'error');
    }
});

async function toggleDetails(sessionId) {
    const details = document.getElementById(`details-${sessionId}`);
    const isVisible = details.style.display === 'block';

    if (isVisible) {
        details.style.display = 'none';
        return;
    }

    // Close others
    document.querySelectorAll('.session-details').forEach(el => el.style.display = 'none');
    
    details.style.display = 'block';
    
    // Load Q&A if not loaded
    if (details.innerHTML.includes('skeleton')) {
        try {
            const token = auth.getToken();
            const res = await fetch(`/api/sessions/${sessionId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (!data.answers || data.answers.length === 0) {
                details.innerHTML = '<p style="color: var(--text-muted); text-align: center;">No detailed answers available for this session.</p>';
                return;
            }

            details.innerHTML = data.answers.map(a => `
                <div class="qa-item">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; color: var(--primary-color);">Q: ${a.question}</div>
                    <div style="margin-bottom: 0.75rem;">A: ${a.answer}</div>
                    <div class="score-pills">
                        <span class="score-pill">Clarity: ${Math.round(a.clarity_score)}%</span>
                        <span class="score-pill">Reasoning: ${Math.round(a.reasoning_score)}%</span>
                        <span class="score-pill">Depth: ${Math.round(a.depth_score)}%</span>
                        <span class="score-pill">Confidence: ${Math.round(a.confidence_score)}%</span>
                    </div>
                    <div style="margin-top: 0.5rem; font-style: italic; font-size: 0.875rem; color: var(--text-muted);">
                        "${a.feedback}"
                    </div>
                </div>
            `).join('');
        } catch (err) {
            details.innerHTML = '<p style="color: #ef4444;">Failed to load session details.</p>';
        }
    }
}
window.toggleDetails = toggleDetails;
