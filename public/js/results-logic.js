document.addEventListener('DOMContentLoaded', async () => {
    auth.requireAuth();
    auth.requireRole('student');

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');

    if (!sessionId) {
        window.location.href = '/student.html';
        return;
    }

    try {
        const token = auth.getToken();
        
        // Fetch session details
        const sessionRes = await fetch(`/api/sessions/${sessionId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const session = await sessionRes.json();

        // Fetch all sessions to compare
        const allSessionsRes = await fetch('/api/sessions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const allSessions = await allSessionsRes.json();
        const prevSession = allSessions.find(s => s.id != sessionId && s.status === 'completed');

        renderResults(session, prevSession);
        fetchCoaching(session.answers);

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
            list.innerHTML = data.questions.map(q => `<li class="coaching-item">${q}</li>`).join('');
        } catch (err) {
            document.getElementById('coaching-loading').textContent = 'AI Coaching temporarily unavailable.';
        }
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
});
