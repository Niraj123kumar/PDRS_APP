document.addEventListener('DOMContentLoaded', async () => {
    auth.requireAuth();
    auth.requireRole('student');

    const list = document.getElementById('session-list');
    const loading = document.getElementById('loading-history');
    const empty = document.getElementById('empty-history');
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
            return;
        }

        // Render Trend Chart
        const completedSessions = sessions.filter(s => s.status === 'completed').reverse();
        const chartLabels = completedSessions.map(s => new Date(s.created_at).toLocaleDateString());
        const chartScores = completedSessions.map(s => s.overall_score);
        charts.renderTrendLine('trendChart', chartLabels, chartScores);

        // Render Sessions List
        list.innerHTML = sessions.map(s => `
            <div class="session-row">
                <div class="session-header" onclick="toggleDetails(${s.id})">
                    <div>
                        <strong style="display: block;">${s.project_title}</strong>
                        <small style="color: var(--text-muted);">${new Date(s.created_at).toLocaleDateString()}</small>
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
            </div>
        `).join('');

        loading.style.display = 'none';
        list.style.display = 'block';

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
