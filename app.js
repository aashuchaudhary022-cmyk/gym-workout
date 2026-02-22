const state = {
  machines: [],
  sessions: [],
  workouts: [],
  workoutHistory: [],
  selectedMachineId: null,
  activeWorkout: null,
  syncQueue: [],
  deferredPrompt: null,
};

const $ = (s) => document.querySelector(s);
const fmtDate = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const sameDay = (a, b) => a === b;
const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);

function save() {
  localStorage.setItem("warriorProgression", JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem("warriorProgression");
  if (raw) {
    const parsed = JSON.parse(raw);
    state.machines = parsed.machines || [];
    state.sessions = parsed.sessions || [];
    state.workouts = parsed.workouts || [];
    state.workoutHistory = parsed.workoutHistory || [];
    state.activeWorkout = parsed.activeWorkout || null;
    state.syncQueue = parsed.syncQueue || [];
    state.selectedMachineId = state.machines[0]?.id || null;
    normalizeState();
  } else {
    seed();
  }
}

function seed() {
  state.machines = [{
    id: crypto.randomUUID(),
    name: "Machine 1",
    streakRequirement: 3,
    streak: 0,
    autoAdvance: true,
    level: 1,
    photo: "",
    currentSetup: [{ weight: "9 plates", rounds: 1, minRep: 6, maxRep: 12 }, { weight: "7 plates", rounds: 2, minRep: 6, maxRep: 12 }],
    nextSetup: [{ weight: "10 plates", rounds: 1, minRep: 6, maxRep: 12 }, { weight: "8 plates", rounds: 2, minRep: 6, maxRep: 12 }],
    levelHistory: [{ date: fmtDate(), level: 1 }],
  }];
  state.selectedMachineId = state.machines[0].id;
  state.workouts = [{ id: crypto.randomUUID(), name: 'Default Workout', machineIds: [state.machines[0].id] }];
  state.workoutHistory = [];
  state.syncQueue = [];
  save();
}


function normalizeState() {
  if (!state.workouts.length && state.machines.length) {
    state.workouts = [{ id: crypto.randomUUID(), name: 'Default Workout', machineIds: state.machines.map(m => m.id) }];
  }
  state.workouts = state.workouts.map(w => ({ ...w, machineIds: (w.machineIds || []).filter(id => state.machines.some(m => m.id === id)) }));
  if (state.activeWorkout && !state.workouts.find(w => w.id === state.activeWorkout.workoutId)) state.activeWorkout = null;
}

function parseSetup(text) {
  return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [weight, rounds, minRep, maxRep] = line.split("|").map(v => v.trim());
    return { weight, rounds: Number(rounds), minRep: Number(minRep), maxRep: Number(maxRep) };
  });
}

function setupText(setup) {
  return (setup || []).map(s => `${s.weight} • ${s.rounds}r • ${s.minRep}-${s.maxRep}`).join(" / ");
}

function nav() {
  document.querySelectorAll('.bottom-nav button').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.bottom-nav button').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    $(`#${btn.dataset.tab}`).classList.add('active');
    render();
  });
}

function machineProgress(machine) {
  const pct = Math.round((machine.streak / machine.streakRequirement) * 100);
  return Math.min(pct, 100);
}

function renderHome() {
  const pending = state.machines.filter(m => !state.sessions.find(s => s.machineId === m.id && s.date === fmtDate() && s.result === 'YES')).length;
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const weekWorkouts = state.sessions.filter(s => new Date(s.date) >= weekStart && s.result === 'YES').length;
  const year = new Date().getFullYear();
  const levelUps = state.machines.reduce((t, m) => t + m.levelHistory.filter(h => new Date(h.date).getFullYear() === year).length - 1, 0);
  $('#home').innerHTML = `
    <div class="card"><h2>${new Date().toDateString()}</h2><p>Private warrior journal. No distractions. Only growth.</p></div>
    <div class="card kpi-grid">
      <div class="kpi"><b>${pending}</b><span>Machines pending today</span></div>
      <div class="kpi"><b>${weekWorkouts}</b><span>Total workouts this week</span></div>
      <div class="kpi"><b>${levelUps}</b><span>Machines leveled up this year</span></div>
      <div class="kpi"><b>${consistencyPercent()}%</b><span>Average consistency</span></div>
    </div>
    <div class="card"><h3>Current streaks</h3>${state.machines.map(m => `<p>${m.name} – ${m.streak}/${m.streakRequirement} days completed ${m.streak === m.streakRequirement - 1 ? '⚡ close' : ''}</p>`).join('')}</div>
  `;
}

function renderMachines() {
  $('#machines').innerHTML = `
    <div class="card"><button id="addMachine">+ Add Machine</button></div>
    ${state.machines.map(m => `<div class="card machine-card">
      ${m.photo ? `<img src="${m.photo}" class="thumb"/>` : `<div class="thumb"></div>`}
      <div>
        <b>${m.name}</b>
        <p>${setupText(m.currentSetup)}</p>
        <small>🔥 ${m.streak}/${m.streakRequirement} | Next: ${setupText(m.nextSetup)}</small>
      </div>
      <div>
        <div class="progress-ring" style="background:conic-gradient(var(--accent) ${machineProgress(m)}%, #243344 0)">${machineProgress(m)}%</div>
        <button data-edit="${m.id}">Edit</button>
      </div>
    </div>`).join('')}
  `;
  $('#addMachine').onclick = () => openMachineDialog();
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openMachineDialog(b.dataset.edit));
}

function renderSession() {
  const machine = state.machines.find(m => m.id === state.selectedMachineId) || state.machines[0];
  if (!machine) return $('#session').innerHTML = '<div class="card">Add a machine first.</div>';
  state.selectedMachineId = machine.id;
  const activeWorkout = state.activeWorkout;
  $('#session').innerHTML = `
    <div class="card">
      <h3>Log Session</h3>
      <button id="startWorkoutBtn">▶ Start Workout</button>
      <small>Run all assigned machines and track progress in one flow.</small>
      <label>Workout Template
        <select id="workoutSelect">${state.workouts.map(w => `<option value="${w.id}">${w.name} (${w.machineIds.length})</option>`).join('')}</select>
      </label>
      <div class="actions" style="justify-content:flex-start">
        <button id="newWorkout">+ New</button><button id="editWorkout">Edit</button><button id="upWorkout">↑</button><button id="downWorkout">↓</button><button id="deleteWorkout" class="danger">Delete</button>
      </div>
      <select id="machineSelect">${state.machines.map(m => `<option value="${m.id}" ${m.id === machine.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
      <p>Required today: ${setupText(machine.currentSetup)}</p>
      <button id="startSession">Open YES / NO</button>
    </div>
    ${activeWorkout ? renderActiveWorkout(activeWorkout) : ''}
    <div class="card"><h4>Recent</h4>${state.sessions.filter(s=>s.machineId===machine.id).slice(-5).reverse().map(s=>`<p>${s.date} - ${s.result}</p>`).join('') || 'No sessions yet.'}</div>
  `;
  $('#machineSelect').onchange = (e) => { state.selectedMachineId = e.target.value; renderSession(); };
  $('#startSession').onclick = () => openSessionDialog(machine.id);
  const workoutSelect = $('#workoutSelect');
  if (workoutSelect) {
    workoutSelect.value = localStorage.getItem('selectedWorkout') || state.workouts[0]?.id;
    workoutSelect.onchange = (e) => localStorage.setItem('selectedWorkout', e.target.value);
  }
  $('#startWorkoutBtn').onclick = startWorkout;
  $('#newWorkout').onclick = createWorkout;
  $('#editWorkout').onclick = editWorkout;
  $('#deleteWorkout').onclick = deleteWorkout;
  $('#upWorkout').onclick = () => moveWorkout(-1);
  $('#downWorkout').onclick = () => moveWorkout(1);
  document.querySelectorAll('[data-workout-yes]').forEach(btn => btn.onclick = () => markWorkoutItem(btn.dataset.workoutYes, 'YES'));
  document.querySelectorAll('[data-workout-no]').forEach(btn => btn.onclick = () => markWorkoutItem(btn.dataset.workoutNo, 'NO'));
}

function renderActiveWorkout(activeWorkout) {
  const done = activeWorkout.items.filter(i => i.result).length;
  return `<div class="card" id="activeWorkoutCard">
    <h3>Workout in Progress (${done}/${activeWorkout.items.length})</h3>
    ${activeWorkout.items.map((item, idx) => {
      const machine = state.machines.find(m => m.id === item.machineId);
      if (!machine) return '';
      return `<div class="card workout-item ${item.result ? 'done' : ''}" id="workout-item-${item.machineId}">
        <b>${idx + 1}. ${machine.name}</b>
        <p><small>Goal: ${setupText(machine.currentSetup)} | Next: ${setupText(machine.nextSetup)} | 🔥 ${machine.streak}/${machine.streakRequirement}</small></p>
        <label>Progress<input id="progress-${item.machineId}" value="${item.progress || ''}" placeholder="actual weight / reps / rounds" /></label>
        <label>Note<textarea id="note-${item.machineId}" rows="2">${item.notes || ''}</textarea></label>
        <label>Photo<input id="photo-${item.machineId}" type="file" accept="image/*" /></label>
        <div class="actions split"><button data-workout-no="${item.machineId}" class="danger">NO</button><button data-workout-yes="${item.machineId}" class="success">YES</button></div>
      </div>`;
    }).join('')}
  </div>`;
}

function selectedWorkout() {
  const id = localStorage.getItem('selectedWorkout') || state.workouts[0]?.id;
  return state.workouts.find(w => w.id === id);
}

function startWorkout() {
  const workout = selectedWorkout();
  if (!workout) return toast('Create a workout first');
  state.activeWorkout = { id: crypto.randomUUID(), workoutId: workout.id, date: fmtDate(), items: workout.machineIds.map(machineId => ({ machineId, result: null, progress: '', notes: '', photo: '' })) };
  render();
  toast('Workout started');
}

function collectWorkoutIds(defaultIds = []) {
  const choices = state.machines.map(m => `${m.id.slice(0, 6)}=${m.name}`).join('\n');
  const raw = prompt(`Machine IDs (comma-separated):\n${choices}`, defaultIds.map(id => id.slice(0, 6)).join(','));
  if (raw === null) return null;
  return raw.split(',').map(v => v.trim()).filter(Boolean).map(v => state.machines.find(m => m.id.startsWith(v) || m.id === v)?.id).filter(Boolean);
}

function createWorkout() {
  const name = prompt('Workout name?');
  if (!name) return;
  const machineIds = collectWorkoutIds(state.machines.map(m => m.id));
  if (!machineIds) return;
  state.workouts.push({ id: crypto.randomUUID(), name, machineIds: machineIds.length ? machineIds : state.machines.map(m => m.id) });
  render();
}

function editWorkout() {
  const workout = selectedWorkout();
  if (!workout) return;
  const name = prompt('Rename workout', workout.name);
  if (!name) return;
  const machineIds = collectWorkoutIds(workout.machineIds);
  if (!machineIds) return;
  workout.name = name;
  workout.machineIds = machineIds;
  render();
}

function deleteWorkout() {
  const workout = selectedWorkout();
  if (!workout) return;
  if (!confirm(`Delete ${workout.name}?`)) return;
  state.workouts = state.workouts.filter(w => w.id !== workout.id);
  normalizeState();
  render();
}

function moveWorkout(delta) {
  const workout = selectedWorkout();
  if (!workout) return;
  const idx = state.workouts.findIndex(w => w.id === workout.id);
  const next = idx + delta;
  if (next < 0 || next >= state.workouts.length) return;
  [state.workouts[idx], state.workouts[next]] = [state.workouts[next], state.workouts[idx]];
  render();
}

async function markWorkoutItem(machineId, result) {
  const item = state.activeWorkout?.items.find(i => i.machineId === machineId);
  if (!item) return;
  if (result === 'NO' && !confirm('This resets streak progression for this machine. Continue?')) return;
  item.progress = $(`#progress-${machineId}`)?.value || '';
  item.notes = $(`#note-${machineId}`)?.value || '';
  const file = $(`#photo-${machineId}`)?.files?.[0];
  item.photo = file ? await toDataUrl(file) : item.photo;
  item.result = result;
  await logSession(machineId, result, { notes: item.notes, photo: item.photo, progress: item.progress, closeDialog: false });
  const current = document.getElementById(`workout-item-${machineId}`);
  current?.classList.add('flash');
  setTimeout(() => current?.classList.remove('flash'), 600);
  const next = state.activeWorkout.items.find(i => !i.result);
  if (next) document.getElementById(`workout-item-${next.machineId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!next) {
    state.workoutHistory.push({ ...state.activeWorkout, completedAt: new Date().toISOString() });
    queueSync({ type: 'workout_complete', payload: state.activeWorkout });
    state.activeWorkout = null;
    celebrate();
    toast('Workout complete ✅');
  }
  render();
}

function renderProgress() {
  const machine = state.machines.find(m => m.id === state.selectedMachineId) || state.machines[0];
  if (!machine) return $('#progress').innerHTML = '<div class="card">No data.</div>';
  const year = Number(localStorage.getItem('selectedYear') || new Date().getFullYear());
  const sessions = state.sessions.filter(s => s.machineId === machine.id && new Date(s.date).getFullYear() === year);
  const yes = sessions.filter(s => s.result === 'YES').length;
  const no = sessions.filter(s => s.result === 'NO').length;
  const levelUps = machine.levelHistory.filter(h => new Date(h.date).getFullYear() === year).length - 1;
  $('#progress').innerHTML = `
    <div class="card">
      <h3>Progress: ${machine.name}</h3>
      <select id="progressMachine">${state.machines.map(m => `<option value="${m.id}" ${m.id === machine.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
      <select id="yearSelect">${[year-1,year,year+1].map(y => `<option ${y===year?'selected':''}>${y}</option>`).join('')}</select>
      <canvas id="lineChart" class="chart" width="800" height="240"></canvas>
    </div>
    <div class="card kpi-grid">
      <div class="kpi"><b>${yes}</b><span>Total YES days</span></div>
      <div class="kpi"><b>${longestStreak(machine.id, year)}</b><span>Longest streak</span></div>
      <div class="kpi"><b>${levelUps}</b><span>Total level-ups</span></div>
      <div class="kpi"><b>${Math.round((yes/Math.max(1,yes+no))*100)}%</b><span>Consistency</span></div>
    </div>
    <div class="card"><h4>Workout history</h4><p>${state.workoutHistory.length} completed workouts</p></div>
    <div class="card"><h4>Calendar</h4><div class="calendar">${calendarCells(machine.id, year)}</div></div>
  `;
  $('#progressMachine').onchange = e => { state.selectedMachineId = e.target.value; renderProgress(); };
  $('#yearSelect').onchange = e => { localStorage.setItem('selectedYear', e.target.value); renderProgress(); };
  drawChart(machine.id, year);
}

function renderSettings() {
  $('#settings').innerHTML = `
    <div class="card">
      <h3>Data</h3>
      <button id="exportBtn">Export JSON</button>
      <input type="file" id="importFile" accept="application/json" />
      <button id="backupBtn">Backup Snapshot</button>
    </div>
  `;
  $('#exportBtn').onclick = exportData;
  $('#backupBtn').onclick = () => { localStorage.setItem(`backup-${Date.now()}`, JSON.stringify(state)); toast('Backup saved to localStorage'); };
  $('#importFile').onchange = importData;
}

function render() { renderHome(); renderMachines(); renderSession(); renderProgress(); renderSettings(); save(); }

function openMachineDialog(id) {
  const m = state.machines.find(x => x.id === id);
  $('#machineDialogTitle').textContent = m ? 'Edit Machine' : 'Add Machine';
  $('#machineId').value = m?.id || '';
  $('#machineName').value = m?.name || '';
  $('#machineStreak').value = m?.streakRequirement || 3;
  $('#machineCurrent').value = (m?.currentSetup || []).map(s => `${s.weight}|${s.rounds}|${s.minRep}|${s.maxRep}`).join('\n');
  $('#machineNext').value = (m?.nextSetup || []).map(s => `${s.weight}|${s.rounds}|${s.minRep}|${s.maxRep}`).join('\n');
  $('#machineAuto').checked = m?.autoAdvance ?? true;
  $('#machinePhoto').value = '';
  $('#machineDialog').showModal();
}

$('#closeMachineDialog').onclick = () => $('#machineDialog').close();
$('#machineForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#machineId').value || crypto.randomUUID();
  const existing = state.machines.find(m => m.id === id);
  const file = $('#machinePhoto').files[0];
  const photo = file ? await toDataUrl(file) : existing?.photo || '';
  const machine = {
    id,
    name: $('#machineName').value,
    streakRequirement: Number($('#machineStreak').value),
    streak: existing?.streak || 0,
    autoAdvance: $('#machineAuto').checked,
    level: existing?.level || 1,
    photo,
    currentSetup: parseSetup($('#machineCurrent').value),
    nextSetup: parseSetup($('#machineNext').value),
    levelHistory: existing?.levelHistory || [{ date: fmtDate(), level: 1 }],
  };
  if (existing) Object.assign(existing, machine); else state.machines.push(machine);
  state.selectedMachineId = id;
  $('#machineDialog').close();
  render();
};

function openSessionDialog(machineId) {
  const m = state.machines.find(x => x.id === machineId);
  $('#sessionTitle').textContent = `${m.name} session`;
  $('#sessionRequired').innerHTML = m.currentSetup.map(s => `<p>${s.weight} – ${s.rounds} rounds – ${s.minRep}-${s.maxRep} reps</p>`).join('');
  $('#sessionDate').value = fmtDate();
  $('#sessionNotes').value = '';
  $('#sessionPhoto').value = '';
  $('#yesBtn').onclick = async () => logSession(machineId, 'YES');
  $('#noBtn').onclick = async () => { if (confirm('This will reset streak progression for this machine. Continue?')) await logSession(machineId, 'NO'); };
  $('#sessionDialog').showModal();
}
$('#closeSessionDialog').onclick = () => $('#sessionDialog').close();

async function logSession(machineId, result, opts = {}) {
  const date = opts.date || $('#sessionDate')?.value || fmtDate();
  const notes = opts.notes ?? $('#sessionNotes')?.value ?? '';
  const file = $('#sessionPhoto')?.files?.[0];
  const photo = opts.photo ?? (file ? await toDataUrl(file) : '');
  const progress = opts.progress || '';
  const machine = state.machines.find(m => m.id === machineId);
  const existing = state.sessions.find(s => s.machineId === machineId && sameDay(s.date, date));
  if (existing) {
    if (result === 'YES' && existing.result === 'YES') return toast('Only one YES per machine per day');
    Object.assign(existing, { result, notes, photo, progress });
  } else {
    state.sessions.push({ id: crypto.randomUUID(), machineId, date, result, notes, photo, progress });
  }
  updateStreak(machine, date, result);
  queueSync({ type: 'session', payload: { machineId, date, result, notes, progress } });
  if (opts.closeDialog !== false) {
    $('#sessionDialog').close();
    render();
  }
}

function updateStreak(machine, date, result) {
  const machineSessions = state.sessions.filter(s => s.machineId === machine.id).sort((a,b) => a.date.localeCompare(b.date));
  if (result === 'NO') { machine.streak = 0; return; }
  const yesSessions = machineSessions.filter(s => s.result === 'YES');
  const last = yesSessions.at(-2);
  if (!last) machine.streak = 1;
  else machine.streak = daysBetween(date, last.date) === 1 ? machine.streak + 1 : 1;
  if (machine.streak >= machine.streakRequirement && machine.autoAdvance) {
    machine.level += 1;
    machine.currentSetup = machine.nextSetup;
    machine.nextSetup = machine.nextSetup.map(s => ({ ...s, weight: incrementWeight(s.weight) }));
    machine.levelHistory.push({ date, level: machine.level });
    machine.streak = 0;
    celebrate();
    toast(`${machine.name} leveled up!`);
  }
}

function incrementWeight(label) {
  const m = label.match(/([\d.]+)/);
  if (!m) return label;
  const n = Number(m[1]);
  const inc = n < 20 ? 1 : 2.5;
  return label.replace(m[1], String(n + inc));
}

function longestStreak(machineId, year) {
  const yes = state.sessions.filter(s => s.machineId === machineId && s.result === 'YES' && new Date(s.date).getFullYear() === year)
    .map(s => s.date).sort();
  let best = 0, cur = 0, prev = null;
  yes.forEach(d => {
    cur = !prev || daysBetween(d, prev) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur); prev = d;
  });
  return best;
}

function consistencyPercent() {
  const yes = state.sessions.filter(s => s.result === 'YES').length;
  const total = state.sessions.length;
  return Math.round((yes / Math.max(total, 1)) * 100);
}

function calendarCells(machineId, year) {
  const map = new Map(state.sessions.filter(s => s.machineId === machineId && new Date(s.date).getFullYear() === year).map(s => [s.date, s]));
  const out = [];
  for (let m=0; m<12; m++) {
    for (let d=1; d<=new Date(year,m+1,0).getDate(); d++) {
      const date = new Date(year,m,d).toISOString().slice(0,10);
      const sess = map.get(date);
      const cls = sess ? (sess.result === 'YES' ? 'yes' : 'no') : 'none';
      out.push(`<button class="day ${cls}" title="${date} ${sess?.result||'none'}" data-detail="${date}">${d}</button>`);
    }
  }
  setTimeout(() => document.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => {
    const detail = map.get(el.dataset.detail);
    toast(detail ? `${detail.date}: ${detail.result}${detail.notes ? ' - ' + detail.notes : ''}` : `${el.dataset.detail}: no workout`);
  }), 0);
  return out.join('');
}

function drawChart(machineId, year) {
  const c = $('#lineChart'); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const yesSessions = state.sessions.filter(s => s.machineId===machineId && s.result==='YES' && new Date(s.date).getFullYear()===year).sort((a,b)=>a.date.localeCompare(b.date));
  const machine = state.machines.find(m=>m.id===machineId);
  const vals = yesSessions.map(s => {
    const hist = (machine?.levelHistory || []).filter(h => h.date <= s.date);
    return Number((hist[hist.length - 1]?.level) || 1);
  });
  ctx.strokeStyle = '#1de982'; ctx.lineWidth = 3;
  ctx.beginPath();
  vals.forEach((v,i) => {
    const x = 20 + (i / Math.max(vals.length-1,1)) * (c.width-40);
    const y = c.height - 20 - ((v-1) / Math.max(...vals,1)) * (c.height-40);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    ctx.fillStyle = '#9cb3c9'; ctx.fillText(yesSessions[i].date.slice(5), x-10, c.height-4);
  });
  ctx.stroke();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `warrior-progression-${fmtDate()}.json`; a.click();
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  state.machines = parsed.machines || [];
  state.sessions = parsed.sessions || [];
  state.workouts = parsed.workouts || [];
  state.workoutHistory = parsed.workoutHistory || [];
  state.activeWorkout = parsed.activeWorkout || null;
  state.syncQueue = parsed.syncQueue || [];
  state.selectedMachineId = state.machines[0]?.id || null;
  normalizeState();
  save(); render(); toast('Imported');
}

function queueSync(event) {
  state.syncQueue.push({ ...event, queuedAt: new Date().toISOString() });
  flushSyncQueue();
}

async function flushSyncQueue() {
  if (!navigator.onLine || !state.syncQueue.length) return;
  try {
    const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: state.syncQueue }) });
    if (res.ok) state.syncQueue = [];
  } catch (_) {}
}

const toDataUrl = (file) => new Promise((resolve) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file);
});

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1700);
}

function celebrate() {
  const c = $('#confetti'); const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const dots = Array.from({length: 90}, () => ({x:Math.random()*c.width,y:-20,v:2+Math.random()*3,r:2+Math.random()*3}));
  let frame = 0;
  const tick = () => {
    ctx.clearRect(0,0,c.width,c.height); frame++;
    dots.forEach(d => { d.y += d.v; ctx.fillStyle = `hsl(${120+Math.random()*80} 90% 55%)`; ctx.beginPath(); ctx.arc(d.x,d.y,d.r,0,7); ctx.fill(); });
    if (frame < 70) requestAnimationFrame(tick); else ctx.clearRect(0,0,c.width,c.height);
  }; tick();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); state.deferredPrompt = e; $('#installBtn').classList.remove('hidden');
});
$('#installBtn').onclick = async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  $('#installBtn').classList.add('hidden');
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
window.addEventListener('online', flushSyncQueue);

load(); nav(); render();
