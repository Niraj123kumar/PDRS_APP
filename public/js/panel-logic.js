const user = auth.getUser();
if (!user) window.location.href = '/login.html';
const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get('room');
let role = urlParams.get('role') || 'student';
let countdown = 180;
let isScreenSharing = false;
let raiseHandEventId = null;
let isPausedSession = false;
let attendanceId = null;
let currentScoreQuestionIndex = 0;
let whiteboardTool = 'draw';
let whiteboardDrawing = false;
let whiteboardLastPoint = null;
let bankQuestions = [];
let webrtc = null;

const isFaculty = role === 'faculty' || role === 'teacher';
if (isFaculty) {
    document.getElementById('faculty-q-input').style.display = 'flex';
    document.getElementById('faculty-rubric-controls').style.display = 'block';
    document.getElementById('faculty-stage-controls').style.display = 'block';
    document.getElementById('faculty-chat-toggle').style.display = 'flex';
    document.getElementById('question-bank-section').style.display = 'block';
    document.getElementById('breakout-controls').style.display = 'flex';
    document.getElementById('attendance-panel').style.display = 'block';
    document.getElementById('whiteboard-wrap').style.display = 'block';
} else {
    document.getElementById('student-answer-area').style.display = 'block';
}

async function init() {
    if (!roomCode) return (document.getElementById('room-entry').style.display = 'flex');
    initWebRTC();
    try {
        const session = await apiFetch(`/api/panel/room/${roomCode}`);
        document.getElementById('nav-room-code').textContent = roomCode;
        document.getElementById('panel-ui').style.display = 'flex';
        updatePhaseUI(session.phase);
        renderQuestions(JSON.parse(session.panel_questions_json || '[]'));
        countdown = Number(session.time_per_question) || 180;
        updateTimerUI(countdown);
        if (session.rubric_url) showRubric(session.rubric_url);
        if (session.is_paused) togglePauseUI(true);
        pdrsWS.emit('room-join', { name: user.name }, roomCode);
        const chatMessages = await apiFetch(`/api/panel/room/${roomCode}/chat`);
        renderChat(chatMessages);
        await markAttendanceJoin();
        if (isFaculty) {
            await Promise.all([loadQuestionBank(), loadAttendance(), loadWhiteboard()]);
            setupWhiteboard();
        }
    } catch (err) {
        showToast(err.message, 'error');
        document.getElementById('room-entry').style.display = 'flex';
    }
}

let remotePeerId = null;

function initWebRTC() {
    webrtc = new pdrsWebRTC(
        (stream) => {
            const video = document.getElementById('remote-video');
            if (video) {
                video.srcObject = stream;
                video.style.display = 'block';
            }
        },
        (candidate) => {
            if (remotePeerId) {
                pdrsWS.emit('webrtc-ice', { candidate }, roomCode, remotePeerId);
            }
        }
    );

    pdrsWS.on('webrtc-offer', async (data) => {
        remotePeerId = data.senderId;
        const answer = await webrtc.handleOffer(data.payload.offer);
        pdrsWS.emit('webrtc-answer', { answer }, roomCode, remotePeerId);
    });

    pdrsWS.on('webrtc-answer', async (data) => {
        remotePeerId = data.senderId;
        await webrtc.handleAnswer(data.payload.answer);
    });

    pdrsWS.on('webrtc-ice', async (data) => {
        await webrtc.handleCandidate(data.payload.candidate);
    });
}

async function toggleScreenShare() {
    const btn = isFaculty ? document.getElementById('faculty-share-screen-btn') : document.getElementById('share-screen-btn');
    if (isScreenSharing) {
        isScreenSharing = false;
        if (btn) btn.textContent = 'Share Screen 🖥️';
        pdrsWS.emit('screen-share-stop', {}, roomCode);
        return;
    }
    try {
        const stream = await webrtc.startScreenShare();
        pdrsWS.emit('screen-share-start', { userName: user.name }, roomCode);
        isScreenSharing = true;
        if (btn) btn.textContent = 'Stop Sharing';
        
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = () => {
            isScreenSharing = false;
            if (btn) btn.textContent = 'Share Screen 🖥️';
            pdrsWS.emit('screen-share-stop', {}, roomCode);
        };

        const participants = await apiFetch(`/api/panel/room/${roomCode}/participants`);
        
        // If student, share with faculty. If faculty, share with everyone else.
        const targets = isFaculty 
            ? participants.filter(p => p.userId !== user.id)
            : participants.filter(p => p.role === 'faculty' && p.userId !== user.id);
        
        for (const target of targets) {
            remotePeerId = target.userId;
            const offer = await webrtc.createOffer();
            pdrsWS.emit('webrtc-offer', { offer }, roomCode, remotePeerId);
        }

    } catch (err) {
        console.error(err);
        if (err.name !== 'NotAllowedError') {
            showToast('Screen share failed', 'error');
        }
    }
}

function handleScreenShareStart(data) {
    showToast(`${data.userName || 'Someone'} started screen sharing`, 'info');
}

function handleScreenShareStop(data) {
    showToast(`${data.userName || 'Someone'} stopped screen sharing`, 'info');
    const video = document.getElementById('remote-video');
    if (video) {
        video.srcObject = null;
        video.style.display = 'none';
    }
}
function renderParticipants(list) { document.getElementById('participant-list').innerHTML = list.map(p => `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"><div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></div><span>${p.userId === user.id ? 'You' : 'User ' + p.userId} (${p.role})</span></div>`).join(''); }
function togglePauseUI(isPaused) { isPausedSession = isPaused; document.getElementById('pause-overlay').style.display = isPaused ? 'flex' : 'none'; document.getElementById('live-answer')?.toggleAttribute('disabled', isPaused); }
async function togglePause() { const data = await apiFetch(`/api/panel/room/${roomCode}/pause`, { method: 'PATCH' }); togglePauseUI(data.isPaused); }

function updatePhaseUI(phase) {
    document.querySelectorAll('.phase-step').forEach(step => {
        step.classList.remove('active', 'completed');
        if (step.id === `phase-${phase}`) step.classList.add('active');
    });
}

async function updatePhase(phase) {
    await apiFetch(`/api/panel/room/${roomCode}/phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase })
    });
}

function renderQuestions(questions) {
    const container = document.getElementById('question-queue');
    container.innerHTML = questions.map((q, i) => `
        <div class="card q-card ${q.answered ? 'answered' : ''}" onclick="${isFaculty ? `markQuestionAnswered(${q.id})` : ''}">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary-color); margin-bottom: 0.25rem;">Q${i+1}</div>
            <div>${q.question}</div>
            ${q.answered ? '<div style="font-size: 0.7rem; margin-top: 0.5rem; color: #22c55e;">✓ Answered</div>' : ''}
        </div>
    `).join('');
    
    const current = questions.find(q => !q.answered);
    if (current) {
        document.getElementById('q-text').textContent = current.question;
        document.getElementById('q-teacher').textContent = `From ${current.teacherName}`;
    }
}

async function addQuestion() {
    const input = document.getElementById('new-q-text');
    const question = input.value.trim();
    if (!question) return;
    await apiFetch(`/api/panel/room/${roomCode}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
    });
    input.value = '';
}

async function markQuestionAnswered(id) {
    await apiFetch(`/api/panel/room/${roomCode}/question/${id}`, {
        method: 'PATCH'
    });
}

async function startTimer() {
    await apiFetch(`/api/panel/room/${roomCode}/timer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: countdown })
    });
}

function joinRoom() {
    const code = document.getElementById('entry-code').value.trim().toUpperCase();
    if (code.length !== 6) return showToast('Enter 6-digit code', 'error');
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.location.href = url.toString();
}

function renderChat(list) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    list.forEach(appendChat);
}

function appendChat(data) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${data.sender_id === user.id ? 'sent' : 'received'} ${data.is_private ? 'private' : ''}`;
    div.innerHTML = `
        <div class="sender">${data.sender_name}${data.is_private ? ' (Private)' : ''}</div>
        <div class="text">${data.message}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    const isPrivate = isFaculty && message.startsWith('/p ');
    const cleanMsg = isPrivate ? message.substring(3).trim() : message;
    
    await apiFetch(`/api/panel/room/${roomCode}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cleanMsg, isPrivate })
    });
    input.value = '';
}
function openRaiseHand() { if (raiseHandEventId || isPausedSession) return; document.getElementById('hand-modal').style.display = 'flex'; }
async function submitHand() { const reason = document.getElementById('hand-reason').value.trim(); await apiFetch(`/api/panel/room/${roomCode}/raise-hand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); document.getElementById('hand-modal').style.display = 'none'; document.getElementById('hand-reason').value = ''; raiseHandEventId = 'pending'; document.getElementById('raise-hand-btn').disabled = true; showToast('Hand raised', 'success'); }
function appendRaiseHand(event) { if (!isFaculty) return; const c = document.getElementById('hand-raises'); const d = document.createElement('div'); d.className = 'hand-alert'; d.id = `hand-${event.id}`; d.innerHTML = `<div><strong>${event.studentName}</strong><div style="font-size: 0.85rem;">${event.reason || 'Needs attention'}</div></div><button class="btn btn-secondary" style="width:auto;" onclick="resolveRaiseHand(${event.id})">Resolve</button>`; c.prepend(d); }
async function resolveRaiseHand(id) { await apiFetch(`/api/panel/room/${roomCode}/raise-hand/${id}/resolve`, { method: 'PATCH' }); document.getElementById(`hand-${id}`)?.remove(); }
function onRaiseHandResolved(data) { document.getElementById(`hand-${Number(data?.id)}`)?.remove(); if (!isFaculty) { raiseHandEventId = null; document.getElementById('raise-hand-btn').disabled = false; } }
function appendTranscript(data) { const t = document.getElementById('transcript-text'); const cur = t.textContent === 'Listening for speech...' ? '' : t.textContent; t.textContent = `${cur}${data.chunk || ''}`.trim(); }
function teacherInterrupt() { pdrsWS.emit('teacher-interrupt', {}, roomCode); }
async function submitScore() { const payload = { questionIndex: currentScoreQuestionIndex, clarity: Number(document.getElementById('s-clarity').value), reasoning: Number(document.getElementById('s-reasoning').value), depth: Number(document.getElementById('s-depth').value), confidence: Number(document.getElementById('s-confidence').value) }; const data = await apiFetch(`/api/panel/room/${roomCode}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); renderDisagreementBanner(data.flagged); }
function renderDisagreementBanner(flagged) { const b = document.getElementById('score-disagreement-banner'); if (!flagged?.length) return (b.style.display = 'none'); b.textContent = `Disagreement flagged on: ${flagged.join(', ')}`; b.style.display = 'block'; }
async function markAttendanceJoin() { const data = await apiFetch(`/api/panel/room/${roomCode}/attendance`, { method: 'POST' }); attendanceId = data.id; }
async function markAttendanceLeave() { if (!attendanceId) return; await apiFetch(`/api/panel/attendance/${attendanceId}/leave`, { method: 'PATCH', keepalive: true }); }
async function loadAttendance() { if (!isFaculty) return; const rows = await apiFetch(`/api/panel/room/${roomCode}/attendance`); document.getElementById('attendance-list').innerHTML = rows.map(r => `<div class="attendance-row"><span>${r.left_at ? '🔴' : '🟢'} ${r.user_name} (${r.role})</span><span>${r.total_minutes || 0}m</span></div>`).join(''); }
function exportAttendanceCSV() { const lines = ['name,role,duration']; document.querySelectorAll('#attendance-list .attendance-row').forEach(row => lines.push(`"${row.innerText.replace(/\s+/g, ' ').trim()}"`)); const blob = new Blob([lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `attendance-${roomCode}.csv`; a.click(); URL.revokeObjectURL(a.href); }
async function loadQuestionBank() { bankQuestions = await apiFetch('/api/faculty/question-bank'); renderQuestionBank(); }
function renderQuestionBank() { const q = (document.getElementById('question-bank-search').value || '').toLowerCase(); const filtered = bankQuestions.filter(i => i.question.toLowerCase().includes(q)); document.getElementById('question-bank-list').innerHTML = filtered.map(item => `<div class="q-item" style="margin-bottom:0.5rem;"><div style="font-weight:600;">${item.question}</div><div style="font-size:0.72rem; color: var(--text-muted);">${item.category || 'general'} • ${item.difficulty} • used ${item.times_used}</div><div style="display:flex; gap:0.4rem; margin-top:0.35rem;"><button class="btn btn-secondary" style="width:auto; padding:0.2rem 0.45rem;" onclick="useBankQuestion(${item.id})">Use</button><button class="btn btn-secondary" style="width:auto; padding:0.2rem 0.45rem;" onclick="deleteBankQuestion(${item.id})">Delete</button></div></div>`).join('') || '<p class="text-muted">No saved questions.</p>'; }
async function saveQuestionToBank() { const question = document.getElementById('new-q-text').value.trim(); if (!question) return; await apiFetch('/api/faculty/question-bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, category: 'panel', difficulty: 'medium' }) }); loadQuestionBank(); }
async function useBankQuestion(id) { const item = bankQuestions.find(q => q.id === id); if (!item) return; document.getElementById('new-q-text').value = item.question; await addQuestion(); await apiFetch(`/api/faculty/question-bank/${id}/use`, { method: 'PATCH' }); loadQuestionBank(); }
async function deleteBankQuestion(id) { await apiFetch(`/api/faculty/question-bank/${id}`, { method: 'DELETE' }); loadQuestionBank(); }
function openBreakoutModal() { document.getElementById('breakout-modal').style.display = 'flex'; }
async function createBreakoutRoom() { const roomName = document.getElementById('breakout-name').value.trim(); const facultyIds = document.getElementById('breakout-faculty-ids').value.split(',').map(v => Number(v.trim())).filter(Number.isFinite); await apiFetch(`/api/panel/room/${roomCode}/breakout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomName, facultyIds }) }); document.getElementById('breakout-modal').style.display = 'none'; showToast('Breakout room created', 'success'); }
function setupWhiteboard() { const canvas = document.getElementById('whiteboard-canvas'); if (!canvas) return; const colorInput = document.getElementById('wb-color'); const widthInput = document.getElementById('wb-width'); const ctx = canvas.getContext('2d'); canvas.addEventListener('mousedown', e => { whiteboardDrawing = true; whiteboardLastPoint = getCanvasPoint(canvas, e); }); canvas.addEventListener('mousemove', e => { if (!whiteboardDrawing) return; const point = getCanvasPoint(canvas, e); const data = { tool: whiteboardTool, from: whiteboardLastPoint, to: point, color: colorInput.value, width: Number(widthInput.value) }; drawStroke(ctx, data); sendWhiteboardEvent('draw', data); whiteboardLastPoint = point; }); window.addEventListener('mouseup', () => { whiteboardDrawing = false; whiteboardLastPoint = null; }); }
function getCanvasPoint(canvas, e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function drawStroke(ctx, data) { if (!data.from || !data.to) return; ctx.save(); ctx.strokeStyle = data.tool === 'erase' ? '#ffffff' : data.color; ctx.lineWidth = data.width || 2; ctx.beginPath(); ctx.moveTo(data.from.x, data.from.y); ctx.lineTo(data.to.x, data.to.y); ctx.stroke(); ctx.restore(); }
async function sendWhiteboardEvent(eventType, data) { await apiFetch(`/api/panel/room/${roomCode}/whiteboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType, data }) }); }
async function clearWhiteboard() { const canvas = document.getElementById('whiteboard-canvas'); const ctx = canvas?.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); await sendWhiteboardEvent('clear', {}); }
function applyWhiteboardEvent(evt) { const canvas = document.getElementById('whiteboard-canvas'); const ctx = canvas?.getContext('2d'); if (!ctx) return; if (evt.eventType === 'clear') return ctx.clearRect(0, 0, canvas.width, canvas.height); if (evt.eventType === 'draw' || evt.eventType === 'erase') drawStroke(ctx, evt.data || {}); }
async function loadWhiteboard() { const events = await apiFetch(`/api/panel/room/${roomCode}/whiteboard`); events.forEach(applyWhiteboardEvent); }
function setWhiteboardTool(tool) { whiteboardTool = tool; }
function toggleWhiteboard() { const el = document.getElementById('whiteboard-wrap'); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }

pdrsWS.on('room-join', (data) => { document.getElementById('p-count').textContent = data.participants.length; renderParticipants(data.participants); });
pdrsWS.on('room-leave', (data) => { if (data.participants) { document.getElementById('p-count').textContent = data.participants.length; renderParticipants(data.participants); } });
pdrsWS.on('phase-change', d => updatePhaseUI(d.phase));
pdrsWS.on('panel-question-added', renderQuestions);
pdrsWS.on('panel-question-answered', renderQuestions);
pdrsWS.on('chat-message', appendChat);
pdrsWS.on('private-chat', appendChat);
pdrsWS.on('raise-hand', appendRaiseHand);
pdrsWS.on('raise-hand-resolved', onRaiseHandResolved);
pdrsWS.on('transcript-chunk', appendTranscript);
pdrsWS.on('timer-set', d => updateTimerUI(d.seconds));
pdrsWS.on('timer-tick', d => updateTimerUI(d.seconds));
pdrsWS.on('session-paused', () => togglePauseUI(true));
pdrsWS.on('session-resumed', () => togglePauseUI(false));
pdrsWS.on('teacher-interrupt', () => { showToast('FACULTY INTERRUPTED', 'error'); document.body.style.animation = 'pulseRed 0.5s 3'; });
pdrsWS.on('score-update', d => renderDisagreementBanner(d.flagged));
pdrsWS.on('whiteboard-event', applyWhiteboardEvent);
pdrsWS.on('breakout-created', d => showToast(`Breakout opened: ${d.roomName}`, 'info'));
pdrsWS.on('screen-share-start', handleScreenShareStart);
pdrsWS.on('screen-share-stop', handleScreenShareStop);
pdrsWS.on('breakout-message', d => showToast(`Breakout ${d.senderName}: ${d.message}`, 'info'));
pdrsWS.on('breakout-closed', () => showToast('Breakout room closed', 'info'));
pdrsWS.on('screen-share-start', handleScreenShareStart);
pdrsWS.on('screen-share-stop', handleScreenShareStop);

document.getElementById('rubric-upload').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('rubric', file);
    const data = await apiFetch(`/api/panel/room/${roomCode}/rubric`, { method: 'POST', body: formData });
    showRubric(data.rubricUrl);
};
function showRubric(url) { document.getElementById('rubric-view').style.display = 'block'; document.getElementById('rubric-link').href = url; }
function toggleTheme() { const isDark = document.documentElement.classList.toggle('dark-mode'); localStorage.setItem('pdrs_theme', isDark ? 'dark' : 'light'); document.querySelectorAll('.theme-toggle').forEach(btn => { btn.textContent = isDark ? '☀️' : '🌙'; }); }
function exitSession() { if (confirm('Are you sure you want to leave the panel?')) { markAttendanceLeave(); window.location.href = user.role === 'faculty' ? '/faculty.html' : '/student.html'; } }
document.getElementById('entry-code')?.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('question-bank-search')?.addEventListener('input', renderQuestionBank);
window.addEventListener('beforeunload', () => { markAttendanceLeave(); });
init();