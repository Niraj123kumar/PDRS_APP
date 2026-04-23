document.addEventListener('DOMContentLoaded', () => {
    auth.requireAuth();
    auth.requireRole('student');

    const projectStep = document.getElementById('project-step');
    const questionStep = document.getElementById('question-step');
    const projectList = document.getElementById('project-list');
    const startBtn = document.getElementById('start-btn');
    const saveProjectBtn = document.getElementById('save-project-btn');
    const projectTitleInput = document.getElementById('project-title');
    const projectDescriptionInput = document.getElementById('project-description');
    const projectTechStackInput = document.getElementById('project-tech-stack');
    const githubImportBtn = document.getElementById('github-import-btn');
    const githubModal = document.getElementById('github-modal');
    const githubRepoUrl = document.getElementById('github-repo-url');
    const githubPreviewBtn = document.getElementById('github-preview-btn');
    const githubPreview = document.getElementById('github-preview');
    const githubCloseBtn = document.getElementById('github-close-btn');
    const githubConfirmBtn = document.getElementById('github-confirm-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const questionText = document.getElementById('question-text');
    const tierBadge = document.getElementById('tier-badge');
    const answerInput = document.getElementById('answer-input');
    const charCounter = document.getElementById('char-counter');
    const progressFill = document.getElementById('progress-fill');
    const submitBtn = document.getElementById('submit-answer');
    const voiceBtn = document.getElementById('voice-btn');
    const bookmarkBtn = document.getElementById('bookmark-btn');
    const questionNote = document.getElementById('question-note');
    const confidenceFill = document.getElementById('confidence-fill');
    const confidenceLabel = document.getElementById('confidence-label');
    const voiceAnalysisEl = document.getElementById('voice-analysis');
    const offlineBanner = document.getElementById('offline-banner');
    const syncLine = document.getElementById('sync-line');
    const autosaveLine = document.getElementById('autosave-line');
    const splitRoot = document.getElementById('split-root');
    const btnSplit = document.getElementById('btn-split');
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnSaveLocal = document.getElementById('btn-save-local');
    const btnAbandon = document.getElementById('btn-abandon');
    const btnHints = document.getElementById('btn-hints');
    const hintLeft = document.getElementById('hint-left');
    const hintPanel = document.getElementById('hint-panel');
    const modalRestore = document.getElementById('modal-restore');
    const modalAbandon = document.getElementById('modal-abandon');

    let currentSessionId = null;
    let questions = [];
    let currentIndex = 0;
    let totalScore = 0;
    let questionStartedAt = 0;
    const timeByQuestion = {};
    let sessionCompleted = false;
    let projects = [];
    let importedPreview = null;
    let lastWordsPerMinute = 130;
    let lastPauseCount = 0;
    let paused = false;
    let splitOn = false;
    let lastAutosave = 0;
    let hintPenalty = 0;
    const replayData = [];
    const timeStamps = [];
    let autosaveSec = 0;
    const LS = () => `pdrs_session_${currentSessionId}_draft`;
    const SYNCQ = 'pdrs_offline_sync';

    function draftPayload() {
        const draftByQ = (() => {
            try {
                const raw = localStorage.getItem(LS());
                const p = raw ? JSON.parse(raw) : {};
                return { ...(p.draftByQ || {}), [currentIndex]: { text: answerInput.value, note: questionNote.value } };
            } catch (e) {
                return { [currentIndex]: { text: answerInput.value, note: questionNote.value } };
            }
        })();
        return {
            currentIndex,
            draftByQ,
            timeByQuestion: { ...timeByQuestion },
            totalScore
        };
    }

    function saveLocalDraft() {
        if (!currentSessionId) return;
        try {
            const raw = localStorage.getItem(LS());
            const prev = raw ? JSON.parse(raw) : {};
            const merged = { ...prev, ...draftPayload(), t: Date.now() };
            localStorage.setItem(LS(), JSON.stringify(merged));
            lastAutosave = Date.now();
            autosaveSec = 0;
            if (autosaveLine) {
                autosaveLine.textContent = 'Last saved: just now';
            }
        } catch (e) { /* */ }
    }

    function offerRestore() {
        if (!currentSessionId) return;
        try {
            const d = localStorage.getItem(LS());
            if (!d) return;
            const p = JSON.parse(d);
            const hasDraft =
                (p.draftByQ && Object.keys(p.draftByQ).length) || (Array.isArray(p.answers) && p.answers.length);
            if (p.t && hasDraft && (Date.now() - p.t < 7 * 24 * 60 * 60 * 1000)) {
                modalRestore.style.display = 'flex';
                document.getElementById('modal-restore-yes').onclick = () => {
                    if (p.currentIndex != null) currentIndex = p.currentIndex;
                    if (p.draftByQ && p.draftByQ[currentIndex]) {
                        answerInput.value = p.draftByQ[currentIndex].text || '';
                        questionNote.value = p.draftByQ[currentIndex].note || '';
                    }
                    if (p.timeByQuestion) Object.assign(timeByQuestion, p.timeByQuestion);
                    if (p.totalScore != null) totalScore = p.totalScore;
                    updateCharCount();
                    modalRestore.style.display = 'none';
                    renderQuestion(true);
                };
                document.getElementById('modal-restore-no').onclick = () => { modalRestore.style.display = 'none'; };
            }
        } catch (e) { /* */ }
    }

    setInterval(() => {
        if (!currentSessionId || questionStep.style.display === 'none') return;
        if (lastAutosave && autosaveLine) {
            autosaveSec = Math.floor((Date.now() - lastAutosave) / 1000);
            autosaveLine.textContent = `Last saved: ${autosaveSec}s ago`;
        }
    }, 1000);

    setInterval(() => {
        if (currentSessionId && questionStep.style.display === 'block') saveLocalDraft();
    }, 10000);

    function setOfflineUI() {
        const on = navigator.onLine;
        if (offlineBanner) offlineBanner.classList.toggle('show', !on);
    }
    window.addEventListener('online', () => {
        setOfflineUI();
        flushSyncQueue();
    });
    window.addEventListener('offline', setOfflineUI);
    setOfflineUI();

    function pushSync(body) {
        try {
            const q = JSON.parse(localStorage.getItem(SYNCQ) || '[]');
            q.push({ ...body, t: Date.now() });
            localStorage.setItem(SYNCQ, JSON.stringify(q));
        } catch (e) { /* */ }
    }

    async function flushSyncQueue() {
        if (!navigator.onLine) return;
        let q;
        try {
            q = JSON.parse(localStorage.getItem(SYNCQ) || '[]');
        } catch (e) {
            return;
        }
        if (!q.length) return;
        syncLine.style.display = 'block';
        syncLine.textContent = 'Syncing saved answers...';
        const rest = [];
        for (const item of q) {
            try {
                if (item.type === 'answer' && currentSessionId) {
                    const r = await fetch(`/api/sessions/${item.sessionId}/answers`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.getToken()}` },
                        body: JSON.stringify(item.payload)
                    });
                    if (!r.ok) rest.push(item);
                } else rest.push(item);
            } catch (e) {
                rest.push(item);
            }
        }
        localStorage.setItem(SYNCQ, JSON.stringify(rest));
        syncLine.textContent = rest.length ? 'Some items still pending' : 'All synced';
        setTimeout(() => { syncLine.style.display = 'none'; }, 3000);
    }

    // Load projects
    async function loadProjects() {
        try {
            const res = await fetch('/api/projects', {
                headers: { 'Authorization': `Bearer ${auth.getToken()}` }
            });
            projects = await res.json();
            projectList.innerHTML = '<option value="">-- Select a Project --</option>' + projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
        } catch (err) {
            console.error('Failed to load projects', err);
        }
    }

    loadProjects();

    const searchParams = new URLSearchParams(window.location.search);
    const templateId = searchParams.get('template');
    if (templateId) {
        (async () => {
            showLoading('Loading template...');
            try {
                const res = await fetch(`/api/sessions/from-template/${templateId}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${auth.getToken()}` }
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                currentSessionId = data.id;
                questions = data.questions || [];
                projectStep.style.display = 'none';
                questionStep.style.display = 'block';
                currentIndex = 0;
                renderQuestion();
                setTimeout(offerRestore, 100);
            } catch (e) {
                alert('Could not start from template');
            } finally {
                hideLoading();
            }
        })();
    }

    async function saveReplayRemote() {
        if (!currentSessionId) return;
        try {
            await fetch(`/api/sessions/${currentSessionId}/save-replay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` },
                body: JSON.stringify({ replayData, timeStamps })
            });
        } catch (e) { /* */ }
    }

    async function saveProject() {
        const title = projectTitleInput.value.trim();
        const description = projectDescriptionInput.value.trim();
        const techStack = projectTechStackInput.value.trim();
        if (!title) return alert('Project title is required');

        const endpoint = importedPreview?.repoUrl ? '/api/projects/confirm-github' : '/api/projects';
        const payload = importedPreview?.repoUrl
            ? { title, description, techStack, repoUrl: importedPreview.repoUrl }
            : { title, description, tech_stack: techStack };
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.getToken()}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save project');
        importedPreview = null;
        projectTitleInput.value = '';
        projectDescriptionInput.value = '';
        projectTechStackInput.value = '';
        await loadProjects();
        projectList.value = String(data.id);
    }

    saveProjectBtn.addEventListener('click', async () => {
        try {
            await saveProject();
        } catch (err) {
            alert(err.message);
        }
    });

    // Start Session
    startBtn.addEventListener('click', async () => {
        if (templateId) return;
        const projectId = projectList.value;
        if (!projectId) return alert('Please select a project');

        const project = projects.find(p => p.id == projectId);
        
        showLoading('Initializing defense panel...');
        
        try {
            const sessionRes = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ project_id: projectId })
            });
            const sessionData = await sessionRes.json();
            currentSessionId = sessionData.id;

            // Generate questions
            showLoading('Generating technical questions...');
            const aiRes = await fetch('/api/ai/generate-questions', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ 
                    sessionId: currentSessionId,
                    title: project.title, 
                    description: project.description, 
                    tech_stack: project.tech_stack 
                })
            });
            questions = await aiRes.json();

            projectStep.style.display = 'none';
            questionStep.style.display = 'block';
            renderQuestion();
            setTimeout(offerRestore, 100);
        } catch (err) {
            alert('AI Service is busy. Please try again.');
        } finally {
            hideLoading();
        }
    });

    function openGithubModal() {
        githubModal.style.display = 'flex';
    }

    function closeGithubModal() {
        githubModal.style.display = 'none';
    }

    githubImportBtn.addEventListener('click', openGithubModal);
    githubCloseBtn.addEventListener('click', closeGithubModal);

    githubPreviewBtn.addEventListener('click', async () => {
        const repoUrl = githubRepoUrl.value.trim();
        if (!repoUrl) return alert('Please enter a GitHub repository URL');
        const res = await fetch('/api/projects/import-github', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.getToken()}`
            },
            body: JSON.stringify({ repoUrl })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.error || 'Failed to import from GitHub');
        importedPreview = data;
        document.getElementById('preview-title').textContent = data.title;
        document.getElementById('preview-description').textContent = data.description;
        document.getElementById('preview-tech').textContent = data.techStack;
        githubPreview.style.display = 'block';
    });

    githubConfirmBtn.addEventListener('click', () => {
        if (!importedPreview) return;
        projectTitleInput.value = importedPreview.title || '';
        projectDescriptionInput.value = importedPreview.description || '';
        projectTechStackInput.value = importedPreview.techStack || '';
        closeGithubModal();
    });

    function mediaSplit() {
        if (window.innerWidth < 900) {
            splitRoot.classList.remove('split-mode');
            splitOn = false;
            btnSplit.textContent = 'Split screen';
        }
    }
    window.addEventListener('resize', mediaSplit);

    btnSplit.addEventListener('click', () => {
        if (window.innerWidth < 900) {
            if (typeof showToast === 'function') showToast('Split view needs a wider screen', 'info');
            return;
        }
        splitOn = !splitOn;
        splitRoot.classList.toggle('split-mode', splitOn);
        btnSplit.textContent = splitOn ? 'Exit split' : 'Split screen';
    });

    btnPause.addEventListener('click', () => {
        paused = true;
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-block';
        submitBtn.disabled = true;
    });
    btnResume.addEventListener('click', () => {
        paused = false;
        btnResume.style.display = 'none';
        btnPause.style.display = 'inline-block';
        submitBtn.disabled = false;
    });
    btnSaveLocal.addEventListener('click', () => {
        saveLocalDraft();
        if (typeof showToast === 'function') showToast('Progress saved in browser', 'success');
    });
    btnAbandon.addEventListener('click', () => { modalAbandon.style.display = 'flex'; });
    document.getElementById('modal-abandon-no').onclick = () => { modalAbandon.style.display = 'none'; };
    document.getElementById('modal-abandon-yes').onclick = () => {
        sessionCompleted = true;
        window.location.href = '/student.html';
    };

    btnHints.addEventListener('click', async () => {
        const q = questions[currentIndex];
        if (!q || !currentSessionId) return;
        if (hintPanel.style.display === 'block') {
            hintPanel.style.display = 'none';
            return;
        }
        try {
            const res = await fetch(`/api/sessions/${currentSessionId}/hint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` },
                body: JSON.stringify({ questionIndex: currentIndex, questionText: q.question, tier: q.tier })
            });
            const d = await res.json();
            if (!res.ok) {
                if (typeof showToast === 'function') showToast(d.error || 'No hints', 'error');
                return;
            }
            hintPenalty += d.penaltyPoints || 5;
            const h = d.hints || {};
            hintPanel.innerHTML = `<strong>Key concept:</strong> ${(h.keyConcept || '').replace(/</g, '&lt;')}<br><strong>Example idea:</strong> ${(h.example || '').replace(/</g, '&lt;')}<br><strong>Common mistake:</strong> ${(h.commonMistake || '').replace(/</g, '&lt;')}`;
            hintPanel.style.display = 'block';
            if (hintLeft) hintLeft.textContent = String(d.remaining != null ? d.remaining : 0);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Hint failed', 'error');
        }
    });

    function renderQuestion(preserveDraft) {
        const q = questions[currentIndex];
        questionText.textContent = q.question;
        tierBadge.textContent = `TIER ${q.tier}: ${q.tier_label || 'Question'}`;
        tierBadge.className = `tier-badge tier-${q.tier}`;
        if (!preserveDraft) {
            answerInput.value = '';
            questionNote.value = '';
        }
        updateCharCount();
        const modelAnswer = document.getElementById('model-answer');
        const keyPoints = document.getElementById('key-points');
        modelAnswer.textContent = q.modelAnswer || 'No model answer available.';
        keyPoints.innerHTML = (q.keyPoints || []).map((kp) => `<li>${kp}</li>`).join('');
        confidenceFill.style.width = '0%';
        confidenceLabel.textContent = 'Confidence: --';
        voiceAnalysisEl.textContent = '';
        if (hintPanel) {
            hintPanel.style.display = 'none';
            hintPanel.textContent = '';
        }
        if (hintLeft) hintLeft.textContent = '3';
        
        const progress = ((currentIndex) / 10) * 100;
        progressFill.style.width = `${progress}%`;
        questionStartedAt = Date.now();
        mediaSplit();
    }

    function updateCharCount() {
        const len = answerInput.value.length;
        charCounter.textContent = `${len} / 1000 characters`;
        charCounter.className = 'char-counter';
        if (len >= 950) charCounter.classList.add('char-danger');
        else if (len >= 200) charCounter.classList.add('char-warning');
    }

    answerInput.addEventListener('input', updateCharCount);
    let confidenceDebounce = null;
    answerInput.addEventListener('input', () => {
        if (confidenceDebounce) clearTimeout(confidenceDebounce);
        if (paused) return;
        confidenceDebounce = setTimeout(async () => {
            const q = questions[currentIndex];
            if (!q) return;
            if (!navigator.onLine) return;
            const res = await fetch('/api/ai/analyze-confidence', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ answer: answerInput.value, questionText: q.question })
            });
            const data = await res.json();
            confidenceFill.style.width = `${data.confidenceScore || 0}%`;
            confidenceLabel.textContent = `Confidence: ${data.confidenceScore || 0} - ${data.suggestion || ''}`;
        }, 300);
    });

    // Submit Answer
    submitBtn.addEventListener('click', async () => {
        if (paused) return;
        const answer = answerInput.value.trim();
        if (answer.length < 10) return alert('Please provide a more detailed answer.');

        showLoading('Evaluating your response...');
        
        try {
            const q = questions[currentIndex];
            const scoreRes = await fetch('/api/ai/score-answer', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ question: q.question, answer })
            });
            const scores = await scoreRes.json();

            const doAnswer = async () => {
                await fetch(`/api/sessions/${currentSessionId}/answers`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.getToken()}`
                    },
                    body: JSON.stringify({
                        question: q.question,
                        answer: answer,
                        tier: q.tier,
                        ...scores
                    })
                });
            };

            if (navigator.onLine) {
                try {
                    await doAnswer();
                } catch (e) {
                    pushSync({ type: 'answer', sessionId: currentSessionId, payload: { question: q.question, answer, tier: q.tier, ...scores } });
                }
            } else {
                pushSync({ type: 'answer', sessionId: currentSessionId, payload: { question: q.question, answer, tier: q.tier, ...scores } });
            }

            await fetch(`/api/sessions/${currentSessionId}/note`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ questionIndex: currentIndex, note: questionNote.value || '' })
            });

            const qNum = String(currentIndex + 1);
            timeByQuestion[qNum] = {
                seconds: Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)),
                tier: q.tier
            };
            timeStamps.push({ timestamp: Date.now(), type: 'answer', questionIndex: currentIndex });
            replayData.push({
                timestamp: Date.now(),
                questionIndex: currentIndex,
                answerSnapshot: answer,
                scoreSnapshot: { ...scores }
            });
            await saveReplayRemote();

            totalScore += (scores.clarity + scores.reasoning + scores.depth + scores.confidence) / 4;
            currentIndex++;

            if (currentIndex < 10) {
                renderQuestion();
            } else {
                let finalScore = totalScore / 10;
                finalScore = Math.max(0, finalScore - hintPenalty);
                await fetch(`/api/sessions/${currentSessionId}`, {
                    method: 'PATCH',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.getToken()}`
                    },
                    body: JSON.stringify({
                        status: 'completed',
                        overall_score: finalScore,
                        time_per_question_json: JSON.stringify(timeByQuestion)
                    })
                });
                sessionCompleted = true;
                try { localStorage.removeItem(LS()); } catch (e) { /* */ }
                window.location.href = `/results.html?sessionId=${currentSessionId}`;
            }
        } catch (err) {
            alert('Failed to score answer. Please try again.');
        } finally {
            hideLoading();
        }
    });

    // Web Speech API
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        let isListening = false;
        let voiceStartedAt = 0;

        voiceBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
                voiceBtn.classList.remove('listening');
                voiceBtn.textContent = '🎤 Speak Answer';
            } else {
                voiceStartedAt = Date.now();
                lastPauseCount = 0;
                recognition.start();
                voiceBtn.classList.add('listening');
                voiceBtn.textContent = '🛑 Stop Listening';
            }
            isListening = !isListening;
        });

        recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
                if (!event.results[i].isFinal) lastPauseCount += 1;
            }
            answerInput.value = transcript;
            updateCharCount();
        };
        recognition.onend = async () => {
            if (voiceStartedAt > 0 && answerInput.value.trim()) {
                const elapsedMin = Math.max(1 / 60, (Date.now() - voiceStartedAt) / 60000);
                lastWordsPerMinute = Math.round(answerInput.value.trim().split(/\s+/).length / elapsedMin);
                const res = await fetch('/api/ai/analyze-voice-tone', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.getToken()}`
                    },
                    body: JSON.stringify({ transcript: answerInput.value, wordsPerMinute: lastWordsPerMinute, pauseCount: lastPauseCount })
                });
                const data = await res.json();
                voiceAnalysisEl.textContent = `Voice pace: ${data.pace}, WPM: ${data.wordsPerMinute}. ${Array.isArray(data.suggestions) ? data.suggestions.join(' ') : ''}`;
            }
        };
    } else {
        voiceBtn.style.display = 'none';
    }

    bookmarkBtn.addEventListener('click', async () => {
        const q = questions[currentIndex];
        if (!q) return;
        await fetch(`/api/sessions/${currentSessionId}/bookmark`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.getToken()}`
            },
            body: JSON.stringify({
                questionIndex: currentIndex,
                questionText: q.question,
                note: questionNote.value || ''
            })
        });
        alert('Bookmarked');
    });

    function showLoading(text) {
        loadingText.textContent = text;
        loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        loadingOverlay.style.display = 'none';
    }

    window.addEventListener('beforeunload', () => {
        if (sessionCompleted || !currentSessionId || questionStep.style.display === 'none') return;
        const token = auth.getToken();
        if (!token) return;
        const payload = {
            abandoned_at_question: currentIndex + 1,
            time_per_question_json: JSON.stringify(timeByQuestion)
        };
        try {
            fetch(`/api/sessions/${currentSessionId}`, {
                method: 'PATCH',
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
        } catch (e) { /* ignore */ }
    });
});
