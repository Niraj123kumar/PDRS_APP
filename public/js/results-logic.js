document.addEventListener('DOMContentLoaded', async () => {
    auth.requireAuth();
    auth.requireRole('student');

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');

    if (!sessionId) {
        window.location.href = '/student.html';
        return;
    }

    let fullSession = null;
    let replayList = [];
    let replayMeta = { questions: [] };

    const tabBtns = document.querySelectorAll('.results-tabs [data-tab]');
    const tabPanels = {
        overview: document.getElementById('tab-panel-overview'),
        replay: document.getElementById('tab-panel-replay'),
        summary: document.getElementById('tab-panel-summary')
    };
    function switchTab(name) {
        tabBtns.forEach(b => {
            const on = b.getAttribute('data-tab') === name;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        Object.keys(tabPanels).forEach(k => {
            if (tabPanels[k]) tabPanels[k].classList.toggle('active', k === name);
        });
    }
    tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.getAttribute('data-tab'))));

    const exportBtn = document.getElementById('export-session-pdf-btn');
    if (exportBtn) {
        exportBtn.onclick = async () => {
            const res = await fetch(`/api/sessions/${sessionId}/export-pdf`, {
                headers: { Authorization: `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) return showToast('Failed to export PDF', 'error');
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'session.pdf';
            link.click();
            URL.revokeObjectURL(link.href);
        };
    }

    try {
        const token = auth.getToken();
        
        // Fetch session details
        const sessionRes = await fetch(`/api/sessions/${sessionId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const session = await sessionRes.json();
        fullSession = session;

        const replayRes = await fetch(`/api/sessions/${sessionId}/replay`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (replayRes.ok) {
            const rj = await replayRes.json();
            replayList = Array.isArray(rj.replay) ? rj.replay : [];
        }

        // Fetch all sessions to compare
        const allSessionsRes = await fetch('/api/sessions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const allSessions = await allSessionsRes.json();
        const prevSession = allSessions.find(s => s.id != sessionId && s.status === 'completed');

        renderResults(session, prevSession);
        fetchCoaching(session.answers);
        fetchPanelArtifacts(sessionId);
        initReplayUi();
        initSummaryUi();

    } catch (err) {
        console.error('Failed to load results', err);
        showToast('Failed to load results', 'error');
    }

    function renderResults(session, prev) {
        const score = Math.round(session.overall_score);
        
        // Animated Score Circle
        const circle = document.getElementById('circle-fill');
        const scoreVal = document.getElementById('score-val');
        const offset = 440 - (440 * score) / 100;
        
        setTimeout(() => {
            circle.style.strokeDashoffset = offset;
            animateNumber(scoreVal, 0, score, 1500);
        }, 100);

        // Grade Badge
        const gradeBadge = document.getElementById('grade-badge');
        let grade = 'F';
        if (score >= 85) grade = 'A';
        else if (score >= 70) grade = 'B';
        else if (score >= 55) grade = 'C';
        else if (score >= 40) grade = 'D';
        gradeBadge.textContent = grade;

        // Dimensions
        const averages = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
        session.answers.forEach(a => {
            averages.clarity += a.clarity_score;
            averages.reasoning += a.reasoning_score;
            averages.depth += a.depth_score;
            averages.confidence += a.confidence_score;
        });

        const count = session.answers.length || 1;
        Object.keys(averages).forEach(key => {
            const val = Math.round(averages[key] / count);
            document.getElementById(`${key}-val`).textContent = `${val}%`;
            document.getElementById(`${key}-fill`).style.width = `${val}%`;
        });

        // History Compare
        if (prev) {
            const diff = score - Math.round(prev.overall_score);
            const historyDiv = document.getElementById('history-compare');
            if (diff > 0) {
                historyDiv.innerHTML = `Performance is <span class="trend-up">up by ${diff}%</span> compared to your previous session.`;
            } else if (diff < 0) {
                historyDiv.innerHTML = `Performance is <span class="trend-down">down by ${Math.abs(diff)}%</span> compared to your previous session.`;
            } else {
                historyDiv.textContent = `Performance is consistent with your previous session.`;
            }
        }
    }

    async function fetchCoaching(answers) {
        const averages = { Clarity: 0, Reasoning: 0, Depth: 0, Confidence: 0 };
        answers.forEach(a => {
            averages.Clarity += a.clarity_score;
            averages.Reasoning += a.reasoning_score;
            averages.Depth += a.depth_score;
            averages.Confidence += a.confidence_score;
        });

        const count = answers.length || 1;
        const weakDimensions = Object.keys(averages)
            .map(key => ({ name: key, val: averages[key] / count }))
            .sort((a, b) => a.val - b.val)
            .slice(0, 2)
            .map(d => d.name);

        try {
            const res = await fetch('/api/ai/generate-coaching', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ weakDimensions })
            });
            const data = await res.json();
            
            const list = document.getElementById('coaching-list');
            document.getElementById('coaching-loading').style.display = 'none';
            const allQuestions = data.questions ? Object.values(data.questions).flat() : [];
            const tips = data.tips ? Object.entries(data.tips).map(([k, v]) => `${k}: ${v}`) : [];
            list.innerHTML = allQuestions.slice(0, 6).map(q => `<li class="coaching-item">${q}</li>`).join('')
                + tips.slice(0, 4).map(t => `<li class="coaching-item"><strong>Tip:</strong> ${t}</li>`).join('');
        } catch (err) {
            document.getElementById('coaching-loading').textContent = 'AI Coaching temporarily unavailable.';
        }
    }

    async function fetchPanelArtifacts(sessionId) {
        const container = document.getElementById('panel-session-content');
        if (!container) return;
        try {
            const res = await fetch(`/api/panel/session/${sessionId}/details`, {
                headers: { 'Authorization': `Bearer ${auth.getToken()}` }
            });
            if (!res.ok) {
                container.textContent = 'No panel session data available.';
                return;
            }
            const data = await res.json();
            const flagged = computeFlagged(data.scores || []);
            container.innerHTML = `
                <div style="margin-bottom:0.75rem;"><strong>Score Grid</strong></div>
                <div style="font-size:0.9rem; margin-bottom:0.75rem;">
                    ${(data.scores || []).map(s => `${s.faculty_name} (Q${s.question_index + 1}) C${s.clarity} R${s.reasoning} D${s.depth} F${s.confidence}`).join('<br>') || 'No scores yet'}
                </div>
                <div style="margin-bottom:0.75rem; color:${flagged.length ? '#d97706' : 'var(--text-muted)'};">
                    ${flagged.length ? `Flagged disagreements: ${flagged.join(', ')}` : 'No disagreement flags'}
                </div>
                <div style="margin-bottom:0.75rem;"><strong>Attendance</strong><br>${(data.attendance || []).map(a => `${a.user_name} (${a.role}) - ${a.total_minutes || 0}m`).join('<br>') || 'No attendance'}</div>
                <details><summary><strong>Transcript</strong></summary><div style="margin-top:0.5rem;">${data.panelSession.full_transcript || 'No transcript'}</div></details>
                <div style="margin-top:0.75rem;"><strong>Whiteboard Snapshots</strong><br>${(data.whiteboard || []).length} events captured</div>
            `;
        } catch (err) {
            container.textContent = 'Failed to load panel artifacts.';
        }
    }

    function computeFlagged(scores) {
        const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
        return dims.filter(dim => {
            const values = scores.map(s => Number(s[dim])).filter(v => Number.isFinite(v));
            if (!values.length) return false;
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / values.length;
            return Math.sqrt(variance) > 1.0;
        });
    }

    function animateNumber(el, start, end, duration) {
        let startTime = null;
        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            el.textContent = Math.floor(progress * (end - start) + start);
            if (progress < 1) window.requestAnimationFrame(step);
        }
        window.requestAnimationFrame(step);
    }

    function buildQuestionList(sess) {
        let qs = [];
        try {
            qs = JSON.parse(sess.questions_json || '[]');
        } catch (e) { /* */ }
        if (Array.isArray(qs) && qs.length && typeof qs[0] === 'object' && (qs[0].question != null)) {
            return qs;
        }
        if (sess.answers && sess.answers.length) {
            return sess.answers.map((a) => ({ question: a.question, tier: a.tier }));
        }
        return [];
    }

    function cumulativeStats(replay, upToIncl) {
        const slice = replay.slice(0, upToIncl + 1);
        if (!slice.length) {
            return { overall: 0, clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
        }
        const acc = { c: 0, r: 0, d: 0, f: 0 };
        slice.forEach((s) => {
            const sc = s.scoreSnapshot || {};
            acc.c += Number(sc.clarity ?? sc.clarity_score) || 0;
            acc.r += Number(sc.reasoning ?? sc.reasoning_score) || 0;
            acc.d += Number(sc.depth ?? sc.depth_score) || 0;
            acc.f += Number(sc.confidence ?? sc.confidence_score) || 0;
        });
        const n = slice.length;
        const o = (acc.c + acc.r + acc.d + acc.f) / (4 * n);
        return { overall: o, clarity: acc.c / n, reasoning: acc.r / n, depth: acc.d / n, confidence: acc.f / n };
    }

    function initReplayUi() {
        const empty = document.getElementById('replay-empty');
        const content = document.getElementById('replay-content');
        const scrub = document.getElementById('replay-scrub');
        if (!content || !scrub) return;
        const qs = buildQuestionList(fullSession);
        replayMeta.questions = qs;

        if (!replayList.length) {
            empty.style.display = 'block';
            content.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        content.style.display = 'block';
        const maxI = replayList.length - 1;
        scrub.max = String(maxI);
        scrub.value = '0';
        const nav = document.getElementById('replay-q-nav');
        const seen = new Set();
        replayList.forEach((e) => seen.add(e.questionIndex));
        const indices = Array.from(seen).sort((a, b) => a - b);
        nav.innerHTML = indices
            .map((qi) => {
                const last = replayList.map((e, j) => (e.questionIndex === qi ? j : -1)).filter((j) => j >= 0).pop();
                return `<button type="button" data-replay-idx="${last}" data-q="${qi}">Q${qi + 1}</button>`;
            })
            .join('');
        nav.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const j = parseInt(btn.getAttribute('data-replay-idx'), 10);
                if (!Number.isNaN(j)) {
                    scrub.value = String(j);
                    renderReplayFrame(parseInt(scrub.value, 10), true);
                }
            });
        });
        function renderReplayFrame(idx, animate) {
            const n = Math.max(0, Math.min(idx, maxI));
            const step = replayList[n];
            const stats = cumulativeStats(replayList, n);
            document.getElementById('replay-step-label').textContent = `Step ${n + 1} of ${replayList.length}`;

            const circle = document.getElementById('replay-circle-fill');
            const sval = document.getElementById('replay-score-val');
            const sc = step.scoreSnapshot || {};
            const off = 440 - (440 * Math.round(stats.overall)) / 100;
            if (circle) circle.style.strokeDashoffset = off;
            if (sval) {
                if (animate) {
                    sval.textContent = '0';
                    animateNumber(sval, 0, Math.round(stats.overall), 800);
                } else sval.textContent = String(Math.round(stats.overall));
            }

            [['clarity', 'clarity'], ['reasoning', 'reasoning'], ['depth', 'depth'], ['confidence', 'confidence']].forEach(([a, b]) => {
                const v = Math.round(stats[b]);
                const elV = document.getElementById(`replay-${a}-val`);
                const elF = document.getElementById(`replay-${a}-fill`);
                if (elV) elV.textContent = `${v}%`;
                if (elF) elF.style.width = `${v}%`;
            });

            const qList = replayMeta.questions;
            const qText = (qList[step.questionIndex] && qList[step.questionIndex].question) || `Question ${step.questionIndex + 1}`;
            document.getElementById('replay-question').textContent = qText;
            document.getElementById('replay-answer').textContent = step.answerSnapshot || '';

            const curQ = step.questionIndex;
            nav.querySelectorAll('button').forEach((btn) => {
                const qi = parseInt(btn.getAttribute('data-q'), 10);
                btn.classList.toggle('current', !Number.isNaN(qi) && qi === curQ);
            });
        }
        scrub.addEventListener('input', () => renderReplayFrame(parseInt(scrub.value, 10), false));
        renderReplayFrame(0, true);

        let playing = false;
        const playBtn = document.getElementById('replay-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                if (playing) return;
                playing = true;
                playBtn.disabled = true;
                let i = 0;
                const tick = setInterval(() => {
                    scrub.value = String(i);
                    renderReplayFrame(i, i === 0);
                    if (i >= maxI) {
                        clearInterval(tick);
                        playing = false;
                        playBtn.disabled = false;
                    } else i += 1;
                }, 450);
            });
        }
    }

    function initSummaryUi() {
        const prior = document.getElementById('summary-pdf-prior');
        const genBtn = document.getElementById('btn-generate-summary');
        const loadEl = document.getElementById('summary-loading');
        const box = document.getElementById('summary-content');
        const dl = document.getElementById('summary-download-pdf');
        if (!genBtn) return;
        if (fullSession && fullSession.summary_pdf_url) {
            prior.style.display = 'block';
            dl.style.display = 'inline-block';
            dl.href = fullSession.summary_pdf_url;
            dl.setAttribute('download', 'session-summary.pdf');
        }
        const cacheKey = `pdrs_session_summary_${sessionId}`;
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const sum = JSON.parse(cached);
                fillSummaryPanel(sum);
                box.style.display = 'block';
            }
        } catch (e) { /* */ }

        genBtn.addEventListener('click', async () => {
            loadEl.style.display = 'block';
            loadEl.textContent = 'Analyzing your performance...';
            genBtn.disabled = true;
            try {
                const res = await fetch(`/api/sessions/${sessionId}/summarize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.getToken()}` }
                });
                if (!res.ok) throw new Error('fail');
                const data = await res.json();
                localStorage.setItem(cacheKey, JSON.stringify(data.summary));
                fillSummaryPanel(data.summary);
                box.style.display = 'block';
                if (data.summaryUrl) {
                    fullSession.summary_pdf_url = data.summaryUrl;
                    prior.style.display = 'block';
                    dl.style.display = 'inline-block';
                    dl.href = data.summaryUrl;
                }
            } catch (e) {
                showToast('Summary could not be generated', 'error');
            } finally {
                loadEl.style.display = 'none';
                genBtn.disabled = false;
            }
        });
    }

    function fillSummaryPanel(s) {
        if (!s) return;
        const o = document.getElementById('summary-overall');
        const d = document.getElementById('summary-dimensions');
        if (o) o.textContent = s.overallParagraph || '';
        if (d) d.textContent = s.dimensionAnalysis || '';
        const st = document.getElementById('summary-strengths');
        const im = document.getElementById('summary-improve');
        const nx = document.getElementById('summary-next');
        if (st) st.innerHTML = (s.strengths || []).map((x) => `<li class="strength-item">${escapeHtml(x)}</li>`).join('');
        if (im) im.innerHTML = (s.improvements || []).map((x) => `<li class="improve-item">${escapeHtml(x)}</li>`).join('');
        if (nx) nx.innerHTML = (s.nextSteps || []).map((x) => `<li class="next-item">${escapeHtml(x)}</li>`).join('');
    }
    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }
});
