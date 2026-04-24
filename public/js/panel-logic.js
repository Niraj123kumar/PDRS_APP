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
    try {
        const res = await fetch(`/api/panel/room/${roomCode}`, { headers: { 'Authorization': `Bearer ${auth.getToken()}` } });
        if (!res.ok) throw new Error('Room not found');
        const session = await res.json();
        document.getElementById('nav-room-code').textContent = roomCode;
        document.getElementById('panel-ui').style.display = 'flex';
        updatePhaseUI(session.phase);
        renderQuestions(JSON.parse(session.panel_questions_json || '[]'));
        countdown = Number(session.time_per_question) || 180;
        updateTimerUI(countdown);
        if (session.rubric_url) showRubric(session.rubric_url);
        if (session.is_paused) togglePauseUI(true);
        pdrsWS.emit('room-join', { name: user.name }, roomCode);
        const chatRes = await fetch(`/api/panel/room/${roomCode}/chat`, { headers: { 'Authorization': `Bearer ${auth.getToken()}` } });
        renderChat(await chatRes.json());
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

function joinRoom() {
    const code = document.getElementById('entry-code').value.toUpperCase();
    if (code.length !== 6) return;
    fetch(`/api/panel/room/${code}`, { headers: { 'Authorization': `Bearer ${auth.getToken()}` } })
        .then(r => { if (!r.ok) throw new Error('Room not found'); window.location.href = `/panel.html?room=${code}&role=${role || user.role}`; })
        .catch(() => { document.getElementById('entry-error').style.display = 'block'; });
}

async function addQuestion() {
    const text = document.getElementById('new-q-text').value.trim();
    if (!text) return;
    const res = await fetch(`/api/panel/room/${roomCode}/question`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ question: text }) });
    renderQuestions(await res.json());
    document.getElementById('new-q-text').value = '';
}

function renderQuestions(questions) {
    const list = document.getElementById('question-queue');
    if (!questions.length) return (list.innerHTML = '<p class="text-muted">No questions in queue.</p>');
    list.innerHTML = questions.map(q => `<div class="q-item ${q.answered ? 'answered' : ''}" style="${q.answered ? 'opacity: 0.5; background: #eee;' : ''}"><div style="font-size: 0.7rem; color: var(--text-muted);">${q.teacherName} • ${new Date(q.addedAt).toLocaleTimeString()}</div><div style="font-weight: 600; margin: 0.25rem 0;">${q.question}</div>${!q.answered && isFaculty ? `<button onclick="markAnswered(${q.id})" class="btn-text" style="color: var(--accent-emerald);">✓ Mark Answered</button>` : ''}</div>`).join('');
    const current = questions.find(q => !q.answered);
    if (current) {
        document.getElementById('q-text').textContent = current.question;
        document.getElementById('q-teacher').textContent = `From ${current.teacherName}`;
        currentScoreQuestionIndex = questions.findIndex(q => q.id === current.id);
    }
}

async function markAnswered(id) {
    const res = await fetch(`/api/panel/room/${roomCode}/question/${id}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${auth.getToken()}` } });
    renderQuestions(await res.json());
}
async function updatePhase(phase) { await fetch(`/api/panel/room/${roomCode}/phase`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ phase }) }); updatePhaseUI(phase); }
function updatePhaseUI(phase) { document.querySelectorAll('.phase-step').forEach(el => el.classList.remove('active')); document.getElementById(`phase-${phase}`)?.classList.add('active'); if (phase === 'scoring' && isFaculty) document.getElementById('scoring-area').style.display = 'block'; }
async function startTimer() { const seconds = Number(prompt('Set timer in seconds', String(countdown || 180))); if (!Number.isInteger(seconds) || seconds < 1) return; await fetch(`/api/panel/room/${roomCode}/timer`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ seconds }) }); pdrsWS.emit('timer-set', { seconds }, roomCode); }
function updateTimerUI(seconds) { const m = Math.floor(seconds / 60); const s = seconds % 60; const display = document.getElementById('timer-display'); display.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; display.classList.toggle('danger', seconds < 30); }
async function sendChat() { const msg = document.getElementById('chat-input').value; const isPrivate = document.querySelector('input[name="chat-mode"]:checked')?.value === 'private'; if (!msg) return; await fetch(`/api/panel/room/${roomCode}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ message: msg, isPrivate }) }); document.getElementById('chat-input').value = ''; }
function renderChat(messages) { const list = document.getElementById('chat-messages'); list.innerHTML = ''; messages.forEach(appendChat); }
function appendChat(msg) { const list = document.getElementById('chat-messages'); const div = document.createElement('div'); div.className = `chat-msg ${msg.is_private ? 'private' : ''}`; div.innerHTML = `<div class="chat-meta">${msg.sender_name} ${msg.is_private ? '🔒' : ''}</div><div>${msg.message}</div>`; list.appendChild(div); list.scrollTop = list.scrollHeight; }
async function toggleScreenShare() { if (isScreenSharing) { isScreenSharing = false; document.getElementById('share-screen-btn').textContent = 'Share Screen 🖥️'; pdrsWS.emit('screen-share-stop', {}, roomCode); return; } try { const stream = await navigator.mediaDevices.getDisplayMedia(); pdrsWS.emit('screen-share-start', {}, roomCode); isScreenSharing = true; document.getElementById('share-screen-btn').textContent = 'Stop Sharing'; stream.getTracks().forEach(t => t.onended = () => { isScreenSharing = false; document.getElementById('share-screen-btn').textContent = 'Share Screen 🖥️'; pdrsWS.emit('screen-share-stop', {}, roomCode); }); } catch { showToast('Screen share failed', 'error'); } }
function renderParticipants(list) { document.getElementById('participant-list').innerHTML = list.map(p => `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"><div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></div><span>${p.userId === user.id ? 'You' : 'User ' + p.userId} (${p.role})</span></div>`).join(''); }
function togglePauseUI(isPaused) { isPausedSession = isPaused; document.getElementById('pause-overlay').style.display = isPaused ? 'flex' : 'none'; document.getElementById('live-answer')?.toggleAttribute('disabled', isPaused); }
async function togglePause() { const res = await fetch(`/api/panel/room/${roomCode}/pause`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); togglePauseUI((await res.json()).isPaused); }
function openRaiseHand() { if (raiseHandEventId || isPausedSession) return; document.getElementById('hand-modal').style.display = 'flex'; }
async function submitHand() { const reason = document.getElementById('hand-reason').value.trim(); const res = await fetch(`/api/panel/room/${roomCode}/raise-hand`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ reason }) }); if (!res.ok) return showToast('Unable to raise hand', 'error'); document.getElementById('hand-modal').style.display = 'none'; document.getElementById('hand-reason').value = ''; raiseHandEventId = 'pending'; document.getElementById('raise-hand-btn').disabled = true; showToast('Hand raised', 'success'); }
function appendRaiseHand(event) { if (!isFaculty) return; const c = document.getElementById('hand-raises'); const d = document.createElement('div'); d.className = 'hand-alert'; d.id = `hand-${event.id}`; d.innerHTML = `<div><strong>${event.studentName}</strong><div style="font-size: 0.85rem;">${event.reason || 'Needs attention'}</div></div><button class="btn btn-secondary" style="width:auto;" onclick="resolveRaiseHand(${event.id})">Resolve</button>`; c.prepend(d); }
async function resolveRaiseHand(id) { await fetch(`/api/panel/room/${roomCode}/raise-hand/${id}/resolve`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); document.getElementById(`hand-${id}`)?.remove(); }
function onRaiseHandResolved(data) { document.getElementById(`hand-${Number(data?.id)}`)?.remove(); if (!isFaculty) { raiseHandEventId = null; document.getElementById('raise-hand-btn').disabled = false; } }
function appendTranscript(data) { const t = document.getElementById('transcript-text'); const cur = t.textContent === 'Listening for speech...' ? '' : t.textContent; t.textContent = `${cur}${data.chunk || ''}`.trim(); }
function teacherInterrupt() { pdrsWS.emit('teacher-interrupt', {}, roomCode); }
async function submitScore() { const payload = { questionIndex: currentScoreQuestionIndex, clarity: Number(document.getElementById('s-clarity').value), reasoning: Number(document.getElementById('s-reasoning').value), depth: Number(document.getElementById('s-depth').value), confidence: Number(document.getElementById('s-confidence').value) }; const res = await fetch(`/api/panel/room/${roomCode}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify(payload) }); if (!res.ok) return showToast('Failed to submit score', 'error'); renderDisagreementBanner((await res.json()).flagged); }
function renderDisagreementBanner(flagged) { const b = document.getElementById('score-disagreement-banner'); if (!flagged?.length) return (b.style.display = 'none'); b.textContent = `Disagreement flagged on: ${flagged.join(', ')}`; b.style.display = 'block'; }
async function markAttendanceJoin() { const res = await fetch(`/api/panel/room/${roomCode}/attendance`, { method: 'POST', headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); if (res.ok) attendanceId = (await res.json()).attendanceId; }
async function markAttendanceLeave() { if (!attendanceId) return; await fetch(`/api/panel/attendance/${attendanceId}/leave`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${auth.getToken()}` }, keepalive: true }); }
async function loadAttendance() { if (!isFaculty) return; const res = await fetch(`/api/panel/room/${roomCode}/attendance`, { headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); if (!res.ok) return; const rows = await res.json(); document.getElementById('attendance-list').innerHTML = rows.map(r => `<div class="attendance-row"><span>${r.left_at ? '🔴' : '🟢'} ${r.user_name} (${r.role})</span><span>${r.total_minutes || 0}m</span></div>`).join(''); }
function exportAttendanceCSV() { const lines = ['name,role,duration']; document.querySelectorAll('#attendance-list .attendance-row').forEach(row => lines.push(`"${row.innerText.replace(/\s+/g, ' ').trim()}"`)); const blob = new Blob([lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `attendance-${roomCode}.csv`; a.click(); URL.revokeObjectURL(a.href); }
async function loadQuestionBank() { const res = await fetch('/api/faculty/question-bank', { headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); if (!res.ok) return; bankQuestions = await res.json(); renderQuestionBank(); }
function renderQuestionBank() { const q = (document.getElementById('question-bank-search').value || '').toLowerCase(); const filtered = bankQuestions.filter(i => i.question.toLowerCase().includes(q)); document.getElementById('question-bank-list').innerHTML = filtered.map(item => `<div class="q-item" style="margin-bottom:0.5rem;"><div style="font-weight:600;">${item.question}</div><div style="font-size:0.72rem; color: var(--text-muted);">${item.category || 'general'} • ${item.difficulty} • used ${item.times_used}</div><div style="display:flex; gap:0.4rem; margin-top:0.35rem;"><button class="btn btn-secondary" style="width:auto; padding:0.2rem 0.45rem;" onclick="useBankQuestion(${item.id})">Use</button><button class="btn btn-secondary" style="width:auto; padding:0.2rem 0.45rem;" onclick="deleteBankQuestion(${item.id})">Delete</button></div></div>`).join('') || '<p class="text-muted">No saved questions.</p>'; }
async function saveQuestionToBank() { const question = document.getElementById('new-q-text').value.trim(); if (!question) return; await fetch('/api/faculty/question-bank', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ question, category: 'panel', difficulty: 'medium' }) }); loadQuestionBank(); }
async function useBankQuestion(id) { const item = bankQuestions.find(q => q.id === id); if (!item) return; document.getElementById('new-q-text').value = item.question; await addQuestion(); await fetch(`/api/faculty/question-bank/${id}/use`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); loadQuestionBank(); }
async function deleteBankQuestion(id) { await fetch(`/api/faculty/question-bank/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); loadQuestionBank(); }
function openBreakoutModal() { document.getElementById('breakout-modal').style.display = 'flex'; }
async function createBreakoutRoom() { const roomName = document.getElementById('breakout-name').value.trim(); const facultyIds = document.getElementById('breakout-faculty-ids').value.split(',').map(v => Number(v.trim())).filter(Number.isFinite); const res = await fetch(`/api/panel/room/${roomCode}/breakout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ roomName, facultyIds }) }); if (!res.ok) return showToast('Failed to create breakout', 'error'); document.getElementById('breakout-modal').style.display = 'none'; showToast('Breakout room created', 'success'); }
function setupWhiteboard() { const canvas = document.getElementById('whiteboard-canvas'); if (!canvas) return; const colorInput = document.getElementById('wb-color'); const widthInput = document.getElementById('wb-width'); const ctx = canvas.getContext('2d'); canvas.addEventListener('mousedown', e => { whiteboardDrawing = true; whiteboardLastPoint = getCanvasPoint(canvas, e); }); canvas.addEventListener('mousemove', e => { if (!whiteboardDrawing) return; const point = getCanvasPoint(canvas, e); const data = { tool: whiteboardTool, from: whiteboardLastPoint, to: point, color: colorInput.value, width: Number(widthInput.value) }; drawStroke(ctx, data); sendWhiteboardEvent('draw', data); whiteboardLastPoint = point; }); window.addEventListener('mouseup', () => { whiteboardDrawing = false; whiteboardLastPoint = null; }); }
function getCanvasPoint(canvas, e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function drawStroke(ctx, data) { if (!data.from || !data.to) return; ctx.save(); ctx.strokeStyle = data.tool === 'erase' ? '#ffffff' : data.color; ctx.lineWidth = data.width || 2; ctx.beginPath(); ctx.moveTo(data.from.x, data.from.y); ctx.lineTo(data.to.x, data.to.y); ctx.stroke(); ctx.restore(); }
async function sendWhiteboardEvent(eventType, data) { await fetch(`/api/panel/room/${roomCode}/whiteboard`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.getToken()}` }, body: JSON.stringify({ eventType, data }) }); }
async function clearWhiteboard() { const canvas = document.getElementById('whiteboard-canvas'); const ctx = canvas?.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); await sendWhiteboardEvent('clear', {}); }
function applyWhiteboardEvent(evt) { const canvas = document.getElementById('whiteboard-canvas'); const ctx = canvas?.getContext('2d'); if (!ctx) return; if (evt.eventType === 'clear') return ctx.clearRect(0, 0, canvas.width, canvas.height); if (evt.eventType === 'draw' || evt.eventType === 'erase') drawStroke(ctx, evt.data || {}); }
async function loadWhiteboard() { const res = await fetch(`/api/panel/room/${roomCode}/whiteboard`, { headers: { 'Authorization': `Bearer ${auth.getToken()}` } }); if (!res.ok) return; (await res.json()).forEach(applyWhiteboardEvent); }
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
pdrsWS.on('breakout-message', d => showToast(`Breakout ${d.senderName}: ${d.message}`, 'info'));
pdrsWS.on('breakout-closed', () => showToast('Breakout room closed', 'info'));

document.getElementById('rubric-upload').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('rubric', file);
    const res = await fetch(`/api/panel/room/${roomCode}/rubric`, { method: 'POST', headers: { 'Authorization': `Bearer ${auth.getToken()}` }, body: formData });
    showRubric((await res.json()).rubricUrl);
};
function showRubric(url) { document.getElementById('rubric-view').style.display = 'block'; document.getElementById('rubric-link').href = url; }
function toggleTheme() { const isDark = document.documentElement.classList.toggle('dark-mode'); localStorage.setItem('pdrs_theme', isDark ? 'dark' : 'light'); document.querySelectorAll('.theme-toggle').forEach(btn => { btn.textContent = isDark ? '☀️' : '🌙'; }); }
function exitSession() { if (confirm('Are you sure you want to leave the panel?')) { markAttendanceLeave(); window.location.href = user.role === 'faculty' ? '/faculty.html' : '/student.html'; } }
document.getElementById('entry-code')?.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('question-bank-search')?.addEventListener('input', renderQuestionBank);
window.addEventListener('beforeunload', () => { markAttendanceLeave(); });
init();