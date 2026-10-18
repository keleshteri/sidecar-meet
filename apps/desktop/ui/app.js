const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core.invoke;
let currentId = null;
let currentSegments = [];
let pending = false;
function showError(error) { $('error').textContent = String(error || ''); }
async function devices() {
  try {
    const names = await invoke('audio_devices');
    $('devices').textContent = names.length ? names.join(' · ') : 'No recording devices found.';
  } catch (error) { showError(error); }
}
function render(meeting) {
  if (!meeting) return;
  const active = !['left', 'error'].includes(meeting.status);
  $('status').textContent = { awaiting_manual_join: 'Chrome open · join manually', in_call: 'In the meeting', stopping: 'Stopping session…', left: 'Session ended', error: 'Session failed' }[meeting.status] || meeting.status;
  $('leave').disabled = pending || !active;
  $('join').disabled = pending || active;
  $('listener').textContent = meeting.listenerError || `Listener: ${meeting.listenerStatus}`;
  currentSegments = meeting.segments;
  $('copy').disabled = !currentSegments.length;
  if (!currentSegments.length) return;
  const container = $('transcript');
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  container.replaceChildren(...currentSegments.map(segment => {
    const row = document.createElement('div'); row.className = 'segment';
    const time = document.createElement('time'); time.textContent = new Date(segment.startedAt).toLocaleTimeString();
    const text = document.createElement('p'); text.textContent = segment.text;
    row.append(time, text); return row;
  }));
  if (atBottom) container.scrollTop = container.scrollHeight;
}
$('join-form').addEventListener('submit', async event => {
  event.preventDefault(); pending = true; $('join').disabled = true; showError('');
  $('status').textContent = 'Opening Chrome…';
  try {
    const meeting = await invoke('join_meeting', { options: { meetingUrl: $('meeting-url').value.trim() } });
    currentId = meeting.id; currentSegments = []; $('transcript').replaceChildren();
    pending = false; render(meeting);
  } catch (error) { showError(error); $('status').textContent = 'Could not open meeting'; $('join').disabled = false; }
  finally { pending = false; }
});
$('leave').addEventListener('click', async () => {
  if (!currentId) return;
  pending = true; $('leave').disabled = true; $('status').textContent = 'Stopping session…';
  try { await invoke('leave_meeting', { id: currentId }); } catch (error) { showError(error); }
  finally { pending = false; await refresh(); }
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(currentSegments.map(s => s.text).join('\n')); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy text', 1500); }
  catch (error) { showError(error); }
});
$('refresh-devices').addEventListener('click', devices);
async function refresh() {
  if (!currentId || pending) return;
  try { render(await invoke('get_transcript', { id: currentId })); } catch (error) { showError(error); }
}
if (invoke) { devices(); setInterval(refresh, 1500); }
else { showError('Open this interface through the Sidecar Meet desktop app.'); $('join').disabled = true; }
