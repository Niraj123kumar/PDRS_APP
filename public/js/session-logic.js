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

    let currentSessionId = null;
    let questions = [];
    let currentIndex = 0;
    let totalScore = 0;
    let projects = [];
    let importedPreview = null;
    let lastWordsPerMinute = 130;
    let lastPauseCount = 0;

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
        const projectId = projectList.value;
        if (!projectId) return alert('Please select a project');

        const project = projects.find(p => p.id == projectId);
        
        showLoading('Initializing defense panel...');
        
        try {
            // Create session
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

    function renderQuestion() {
        const q = questions[currentIndex];
        questionText.textContent = q.question;
        tierBadge.textContent = `TIER ${q.tier}: ${q.tier_label || 'Question'}`;
        tierBadge.className = `tier-badge tier-${q.tier}`;
        answerInput.value = '';
        questionNote.value = '';
        updateCharCount();
        const modelAnswer = document.getElementById('model-answer');
        const keyPoints = document.getElementById('key-points');
        modelAnswer.textContent = q.modelAnswer || 'No model answer available.';
        keyPoints.innerHTML = (q.keyPoints || []).map((kp) => `<li>${kp}</li>`).join('');
        confidenceFill.style.width = '0%';
        confidenceLabel.textContent = 'Confidence: --';
        voiceAnalysisEl.textContent = '';
        
        const progress = ((currentIndex) / 10) * 100;
        progressFill.style.width = `${progress}%`;
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
        confidenceDebounce = setTimeout(async () => {
            const q = questions[currentIndex];
            if (!q) return;
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

            // Save answer
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
            await fetch(`/api/sessions/${currentSessionId}/note`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({ questionIndex: currentIndex, note: questionNote.value || '' })
            });

            totalScore += (scores.clarity + scores.reasoning + scores.depth + scores.confidence) / 4;
            currentIndex++;

            if (currentIndex < 10) {
                renderQuestion();
            } else {
                const finalScore = totalScore / 10;
                await fetch(`/api/sessions/${currentSessionId}`, {
                    method: 'PATCH',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${auth.getToken()}`
                    },
                    body: JSON.stringify({ status: 'completed', overall_score: finalScore })
                });
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
            if (!isListening) {
                voiceStartedAt = Date.now();
                lastPauseCount = 0;
                recognition.start();
                voiceBtn.classList.add('listening');
                voiceBtn.textContent = '🛑 Stop Listening';
            } else {
                recognition.stop();
                voiceBtn.classList.remove('listening');
                voiceBtn.textContent = '🎤 Speak Answer';
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
});
