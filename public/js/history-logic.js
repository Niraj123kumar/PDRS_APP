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
        if (loadingTemplates) {
            loadingTemplates.style.display = 'block';
            ui.showSkeleton('loading-templates', 3, 'card');
        }
        if (emptyTemplates) emptyTemplates.style.display = 'none';
        
        try {
            const res = await fetch('/api/templates', {
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) throw new Error();
            const arr = await res.json();
            if (loadingTemplates) loadingTemplates.style.display = 'none';
            if (!arr.length) {
                templatesList.innerHTML = '';
                ui.showEmptyState('empty-templates', '📋', 'No templates yet', 'Create a template from a completed session in the Sessions tab.');
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
                    <button type="button" class="btn" style="width: auto; padding: 0.5rem 1rem;" onclick="useTemplate(${t.id}, this)">Use template</button>
                    <button type="button" class="btn btn-secondary" style="width: auto; padding: 0.5rem 1rem;" onclick="deleteTemplate(${t.id}, this)">Delete</button>
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

    window.useTemplate = (id, btn) => {
        if (btn) ui.setLoading(btn, true, 'Using...');
        window.location.href = `/session.html?template=${id}`;
    };
    window.deleteTemplate = async (id, btn) => {
        ui.showConfirm(
            'Delete Template',
            'Are you sure? This cannot be undone.',
            async () => {
                if (btn) ui.setLoading(btn, true);
                try {
                    const res = await fetch(`/api/templates/${id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${auth.getToken()}` }
                    });
                    if (!res.ok) throw new Error();
                    showToast('Template removed ✅', 'success');
                    loadTemplates();
                } catch (e) {
                    showToast('Delete failed', 'error');
                } finally {
                    if (btn) ui.setLoading(btn, false);
                }
            }
        );
    };
    window.createTemplateFromSession = async (sessionId, btn) => {
        const def = `Rehearsal ${new Date().toLocaleDateString()}`;
        const name = window.prompt('Template name:', def);
        if (name === null || !String(name).trim()) return;
        
        if (btn) ui.setLoading(btn, true);
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
            showToast('Template created ✅', 'success');
            if (historyPanelTemplates && historyPanelTemplates.style.display === 'block') loadTemplates();
        } catch (e) {
            showToast('Could not create template', 'error');
        } finally {
            if (btn) ui.setLoading(btn, false);
        }
    };

    const exportBtn = document.getElementById('export-progress-btn');
    const searchInput = document.getElementById('session-search');
    const statusFilter = document.getElementById('status-filter');
    const sortFilter = document.getElementById('sort-filter');
    const paginationContainer = document.getElementById('pagination-container');
    
    let allSessions = [];
    let currentPage = 1;
    const itemsPerPage = 5;

    function renderSessions(sessions) {
        const totalPages = Math.ceil(sessions.length / itemsPerPage);
        if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
        
        const start = (currentPage - 1) * itemsPerPage;
        const paginatedSessions = sessions.slice(start, start + itemsPerPage);

        if (sessions.length === 0) {
            list.innerHTML = '';
            paginationContainer.innerHTML = '';
            ui.showEmptyState('empty-history', '🔍', 'No sessions found', 'Try adjusting your search or filters.');
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        list.innerHTML = paginatedSessions
            .map(
                (s) => `
        <div class="session-row">
            <div class="session-header" onclick="toggleDetails(${s.id})">
                <div>
                    <strong style="display: block;">${escapeCh(s.project_title)}</strong>
                    <small style="color: var(--text-muted);">${new Date(s.created_at).toLocaleDateString()}</small>
                    <div>
                        <button type="button" class="btn btn-secondary" style="width: auto; margin-top: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="event.stopPropagation(); createTemplateFromSession(${s.id}, this)">Create template from session</button>
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

        renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let html = '';
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="btn ${i === currentPage ? '' : 'btn-secondary'}" style="width:auto; padding: 0.4rem 0.8rem;" onclick="changePage(${i})">${i}</button>`;
        }
        paginationContainer.innerHTML = html;
    }

    window.changePage = (page) => {
        currentPage = page;
        filterSessions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    function filterSessions() {
        const query = (searchInput?.value || '').toLowerCase();
        const status = statusFilter?.value || 'all';
        const sort = sortFilter?.value || 'date-desc';

        let filtered = allSessions.filter(s => {
            const matchesSearch = (s.project_title || '').toLowerCase().includes(query);
            const matchesStatus = status === 'all' || s.status === status;
            return matchesSearch && matchesStatus;
        });

        // Sorting
        filtered.sort((a, b) => {
            if (sort === 'date-desc') return new Date(b.created_at) - new Date(a.created_at);
            if (sort === 'date-asc') return new Date(a.created_at) - new Date(b.created_at);
            if (sort === 'score-desc') return (b.overall_score || 0) - (a.overall_score || 0);
            if (sort === 'score-asc') return (a.overall_score || 0) - (b.overall_score || 0);
            return 0;
        });

        renderSessions(filtered);
    }

    if (searchInput) searchInput.oninput = () => { currentPage = 1; filterSessions(); };
    if (statusFilter) statusFilter.onchange = () => { currentPage = 1; filterSessions(); };
    if (sortFilter) sortFilter.onchange = () => { currentPage = 1; filterSessions(); };

    if (exportBtn) {
        exportBtn.onclick = async () => {
            ui.setLoading(exportBtn, true);
            try {
                const res = await fetch('/api/student/export-report', {
                    headers: { Authorization: `Bearer ${auth.getToken()}` }
                });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'progress-report.pdf';
                link.click();
                URL.revokeObjectURL(link.href);
                showToast('Report exported successfully ✅', 'success');
            } catch (err) {
                showToast('Failed to export report', 'error');
            } finally {
                ui.setLoading(exportBtn, false);
            }
        };
    }

    try {
        const token = auth.getToken();
        
        if (loading) {
            loading.style.display = 'block';
            ui.showSkeleton('loading-history', 5, 'list');
        }
        if (empty) empty.style.display = 'none';

        const res = await fetch('/api/sessions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        allSessions = await res.json();

        if (allSessions.length === 0) {
            if (loading) loading.style.display = 'none';
            ui.showEmptyState('empty-history', '📜', 'No history found', 'Complete your first defense rehearsal to see your progress here.', 'Start Rehearsal', '/session.html');
            if (empty) empty.style.display = 'block';
        } else {
            const completedSessions = allSessions.filter((s) => s.status === 'completed').reverse();
            const chartLabels = completedSessions.map((s) => new Date(s.created_at).toLocaleDateString());
            const chartScores = completedSessions.map((s) => s.overall_score);
            charts.renderTrendLine('trendChart', chartLabels, chartScores);

            renderSessions(allSessions);

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
