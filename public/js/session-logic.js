document.addEventListener('DOMContentLoaded', () => {
    auth.requireAuth();
    auth.requireRole('student');

    const projectStep = document.getElementById('project-step');
    const questionStep = document.getElementById('question-step');
    const projectList = document.getElementById('project-list');
    const startBtn = document.getElementById('start-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const questionText = document.getElementById('question-text');
    const tierBadge = document.getElementById('tier-badge');
    const answerInput = document.getElementById('answer-input');
    const charCounter = document.getElementById('char-counter');
    const progressFill = document.getElementById('progress-fill');
    const submitBtn = document.getElementById('submit-answer');
    const voiceBtn = document.getElementById('voice-btn');

    let currentSessionId = null;
    let questions = [];
    let currentIndex = 0;
    let totalScore = 0;
    let projects = [];

    // Load projects
    async function loadProjects() {
        try {
            const res = await fetch('/api/projects', {
                headers: { 'Authorization': `Bearer ${auth.getToken()}` }
            });
            projects = await res.json();
            projectList.innerHTML += projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
        } catch (err) {
            console.error('Failed to load projects', err);
        }
    }

    loadProjects();

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

    function renderQuestion() {
        const q = questions[currentIndex];
        questionText.textContent = q.question;
        tierBadge.textContent = `TIER ${q.tier}: ${q.tier_label || 'Question'}`;
        tierBadge.className = `tier-badge tier-${q.tier}`;
        answerInput.value = '';
        updateCharCount();
        
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

        voiceBtn.addEventListener('click', () => {
            if (!isListening) {
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
            }
            answerInput.value = transcript;
            updateCharCount();
        };
    } else {
        voiceBtn.style.display = 'none';
    }

    function showLoading(text) {
        loadingText.textContent = text;
        loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        loadingOverlay.style.display = 'none';
    }
});
