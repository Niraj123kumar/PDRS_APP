window.charts = {
    renderTrendLine(canvasId, labels, scores) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Overall Score',
                    data: scores,
                    borderColor: '#2563eb',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#2563eb',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { display: false } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    },

    renderCohortBarChart(canvasId, labels, values) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const colors = values.map(v => {
            if (v >= 80) return '#166534';
            if (v >= 60) return '#2563eb';
            if (v >= 40) return '#f59e0b';
            return '#ef4444';
        });

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    },

    renderHeatmap(canvasId, data) {
        // Simple implementation using a bar chart with custom coloring for "heatmap" feel
        const ctx = document.getElementById(canvasId).getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    data: data.map(d => d.value),
                    backgroundColor: data.map(d => `rgba(37, 99, 235, ${d.value / 100})`)
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } }
            }
        });
    },

    renderScoreTimeline(canvasId, sessions) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const labels = sessions.map(s => new Date(s.created_at).toLocaleDateString()).reverse();
        
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Clarity', data: sessions.map(s => s.avg_clarity).reverse(), borderColor: '#2dd4bf' },
                    { label: 'Reasoning', data: sessions.map(s => s.avg_reasoning).reverse(), borderColor: '#fbbf24' },
                    { label: 'Depth', data: sessions.map(s => s.avg_depth).reverse(), borderColor: '#f87171' },
                    { label: 'Confidence', data: sessions.map(s => s.avg_confidence).reverse(), borderColor: '#2563eb' }
                ]
            },
            options: {
                responsive: true,
                scales: { y: { min: 0, max: 100 } }
            }
        });
    },

    /**
     * @param {string} axis - 'x' for horizontal bar
     */
    renderHorizontalBarChart(canvasId, labels, values, { axis = 'x', color = '#2563eb' } = {}) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const isY = axis === 'y';
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ data: values, backgroundColor: color, borderRadius: 4 }]
            },
            options: {
                indexAxis: isY ? 'y' : 'x',
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true }, y: { beginAtZero: true } }
            }
        });
    },

    renderHistogram(canvasId, bins, color = 'rgba(37, 99, 235, 0.6)') {
        const ctx = document.getElementById(canvasId).getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: bins.map((b) => b.label),
                datasets: [{ data: bins.map((b) => b.count), backgroundColor: color, borderRadius: 2 }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Sessions' } },
                    x: { title: { display: true, text: 'Duration (min)' } } }
            }
        });
    },

    renderYoYLine(canvasId, labels, cur, prev) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Current year', data: cur, borderColor: '#16a34a', tension: 0.2, fill: false },
                    { label: 'Previous year', data: prev, borderColor: '#94a3b8', borderDash: [4, 4], tension: 0.2, fill: false }
                ]
            },
            options: {
                responsive: true,
                spanGaps: true,
                scales: { y: { min: 0, max: 4, title: { display: true, text: 'Avg score (0-4)' } } }
            }
        });
    }
};
