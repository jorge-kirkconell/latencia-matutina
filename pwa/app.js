/**
 * Latencia Matutina — PWA App Logic
 * Handles: auth, penalty calc, registration
 * Backend: Firebase Realtime Database
 */

'use strict';

// ══════════════════════════════════════════════════════════
//  PENALTY ENGINE
// ══════════════════════════════════════════════════════════
function calculatePenalty(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const arrivalMin = h * 60 + m;
  const targetMin  = 8 * 60;       // 08:00 = 480
  const tolerance  = 2;            // 2 min tolerance
  const lateMin    = arrivalMin - targetMin;

  if (lateMin <= tolerance) {
    return { severity: null, type: 'ontime', label: 'A tiempo', penalty: 0, minutesLate: 0, coffeeRequired: false };
  }
  if (lateMin <= 5) {
    return { severity: 3, type: 'sev3', label: 'Latencia menor (Sev 3)', penalty: lateMin, minutesLate: lateMin, coffeeRequired: false };
  }
  if (lateMin <= 15) {
    return { severity: 2, type: 'sev2', label: 'Degradación de servicio (Sev 2)', penalty: 10 + lateMin, minutesLate: lateMin, coffeeRequired: false };
  }
  return { severity: 1, type: 'sev1', label: 'Caída crítica (Sev 1)', penalty: lateMin, minutesLate: lateMin, coffeeRequired: true };
}

const SEV_ICONS = {
  ontime: 'check-circle-2',
  sev3:   'alert-triangle',
  sev2:   'alert-octagon',
  sev1:   'zap',
  fm:     'shield-check',
};

// ══════════════════════════════════════════════════════════
//  MOCK API  (localStorage — no backend needed)
// ══════════════════════════════════════════════════════════
const KEYS = { token: 'lm_token' };

const DEFAULT_TEAM = {
  members: [
    { id: 'admin', name: 'Administrador',      token: 'TK-ADMIN-2025', role: 'admin',  active: true },
    { id: 'jk',    name: 'Jorge Kirkconell',   token: 'TK-JK-4819',   role: 'admin',  active: true },
    { id: 'am',    name: 'Allan Martínez',     token: 'TK-AM-7263',   role: 'member', active: true },
    { id: 'gr',    name: 'Gerson Rivera',      token: 'TK-GR-3057',   role: 'member', active: true },
    { id: 'fb',    name: 'Francisco Benedith', token: 'TK-FB-9418',   role: 'member', active: true },
  ]
};

// ── Firebase array normalizer (same as dashboard) ────────
function fbToArray(val) {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : Object.values(val);
  return arr.filter(item => item != null);
}

// ── Read helpers — Firebase Realtime Database ────────────
async function readTeam() {
  const snap = await db.ref('team').get();
  return snap.exists() ? snap.val() : DEFAULT_TEAM;
}

async function readRecords() {
  const snap = await db.ref('records').get();
  if (!snap.exists()) return { records: [] };
  const raw = snap.val();
  return { records: fbToArray(raw.records) };
}

// ── Write helper — Firebase Realtime Database ────────────
async function writeAction(action, payload) {
  if (action === 'add_record') {
    const snap = await db.ref('records').get();
    const raw  = snap.exists() ? snap.val() : { records: [] };
    const recs = fbToArray(raw.records);
    const dup  = recs.find(r => r.memberId === payload.memberId && r.date === payload.date);
    if (dup) throw new Error('Ya registraste tu llegada para este día');
    recs.push(payload);
    await db.ref('records').set({ records: recs });
    return { success: true };
  }
  if (action === 'update_record') {
    const snap = await db.ref('records').get();
    const raw  = snap.exists() ? snap.val() : { records: [] };
    const recs = fbToArray(raw.records);
    const idx  = recs.findIndex(r => r.id === payload.recordId);
    if (idx !== -1) {
      if (payload.updates.verifiedBy === recs[idx].memberId) {
        throw new Error('No puedes verificar tu propio registro');
      }
      recs[idx] = { ...recs[idx], ...payload.updates };
      await db.ref('records').set({ records: recs });
    }
    return { success: true };
  }
  if (action === 'add_payment') {
    const snap = await db.ref('payments').get();
    const raw  = snap.exists() ? snap.val() : { payments: [] };
    const pays = fbToArray(raw.payments);
    pays.push(payload);
    await db.ref('payments').set({ payments: pays });
    return { success: true };
  }
  if (action === 'delete_record') {
    const snap = await db.ref('records').get();
    const raw  = snap.exists() ? snap.val() : { records: [] };
    const recs = fbToArray(raw.records);
    const idx  = recs.findIndex(r => r.id === payload.recordId);
    if (idx === -1) throw new Error('Registro no encontrado');
    if (recs[idx].memberId !== payload.memberId) throw new Error('No puedes eliminar el registro de otro colaborador');
    if (recs[idx].status !== 'pending') throw new Error('Solo se pueden eliminar registros pendientes');
    recs.splice(idx, 1);
    await db.ref('records').set({ records: recs });
    return { success: true };
  }
  throw new Error(`Acción desconocida: ${action}`);
}

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════
const STATE = {
  token:       null,
  member:      null,    // { id, name, token, role, active }
  todayRecord: null,    // any record for today's date from this member
};

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function today() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function uuid() {
  return 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}

function formatTime12(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ══════════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ══════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  LIVE CLOCK
// ══════════════════════════════════════════════════════════
let clockInterval = null;

function startClock() {
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  document.getElementById('live-clock').textContent = `${hh}:${mm}:${ss}`;

  const dateStr = now.toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('live-date').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  // Update SLA badge
  const badge  = document.getElementById('sla-badge');
  const btext  = document.getElementById('sla-badge-text');
  const curMin = now.getHours() * 60 + now.getMinutes();
  const T      = 8 * 60;

  const lateMin = curMin - T;

  badge.className = 'sla-badge';
  if (lateMin <= 2) {
    badge.classList.add('ontime');
    badge.innerHTML = `<i data-lucide="check-circle-2"></i><span>Dentro del SLA</span>`;
  } else if (lateMin <= 5) {
    badge.classList.add('sev3');
    badge.innerHTML = `<i data-lucide="alert-triangle"></i><span>Sev 3 — ${lateMin} min tarde</span>`;
  } else if (lateMin <= 15) {
    badge.classList.add('sev2');
    badge.innerHTML = `<i data-lucide="alert-octagon"></i><span>Sev 2 — ${lateMin} min tarde</span>`;
  } else {
    badge.classList.add('sev1');
    badge.innerHTML = `<i data-lucide="zap"></i><span>Sev 1 — ${lateMin} min tarde</span>`;
  }
  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  TOKEN SCREEN
// ══════════════════════════════════════════════════════════
async function handleTokenValidation() {
  const tokenVal = document.getElementById('token-input').value.trim().toUpperCase();
  if (!tokenVal) return;

  setLoading(true, 'Verificando token...');
  try {
    const team = await readTeam();
    const member = team.members.find(m => m.token === tokenVal && m.active);
    if (!member) {
      document.getElementById('token-error').classList.remove('hidden');
      document.getElementById('token-input').focus();
      return;
    }
    // Save and proceed
    STATE.token  = tokenVal;
    STATE.member = member;
    localStorage.setItem(KEYS.token, tokenVal);
    document.getElementById('token-error').classList.add('hidden');
    await loadMainScreen();
  } catch (err) {
    alert('Error al verificar token: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ══════════════════════════════════════════════════════════
//  MAIN SCREEN
// ══════════════════════════════════════════════════════════
async function loadMainScreen() {
  const m = STATE.member;

  // Avatar and name
  document.getElementById('user-avatar').textContent = initials(m.name);
  document.getElementById('display-name').textContent = m.name;

  // Default time to now
  document.getElementById('arrival-time').value = nowTime();

  // Enable button
  document.getElementById('btn-register').disabled = false;

  // Check if already registered today
  try {
    const { records } = await readRecords();
    const tod = today();
    const existing = records.find(r => r.memberId === m.id && r.date === tod);
    STATE.todayRecord = existing || null;

    const banner = document.getElementById('registered-banner');
    const form   = document.getElementById('registration-form');

    if (existing) {
      banner.classList.remove('hidden');
      document.getElementById('registered-time-label').textContent =
        ` · ${formatTime12(existing.claimedArrivalTime)}`;
      const chip = document.getElementById('registered-status-badge');
      chip.textContent = { pending: 'Pendiente', verified: 'Verificado', rejected: 'Rechazado' }[existing.status] || existing.status;
      chip.className = `status-chip ${existing.status}`;
      form.classList.add('hidden');
      // Mostrar botón corregir solo si el registro está pendiente
      const btnDel = document.getElementById('btn-delete-record');
      if (existing.status === 'pending') {
        btnDel.classList.remove('hidden');
        btnDel.onclick = () => handleDeleteRecord(existing.id);
      } else {
        btnDel.classList.add('hidden');
      }
    } else {
      banner.classList.add('hidden');
      form.classList.remove('hidden');
    }
  } catch (_) { /* offline — proceed without check */ }

  showScreen('screen-main');
  startClock();
  updatePenaltyPreview();
}

// ══════════════════════════════════════════════════════════
//  PENALTY PREVIEW (live as user changes time)
// ══════════════════════════════════════════════════════════
function updatePenaltyPreview() {
  const timeVal = document.getElementById('arrival-time').value;
  const fmOn    = document.getElementById('fm-toggle').checked;
  const preview = document.getElementById('penalty-preview');
  const wrap    = document.getElementById('preview-icon-wrap');
  const label   = document.getElementById('preview-label');
  const amount  = document.getElementById('preview-amount');

  if (!timeVal) { preview.classList.add('hidden'); return; }

  const result = calculatePenalty(timeVal);

  preview.classList.remove('hidden');
  wrap.className = 'preview-sev-icon ' + (fmOn ? 'ontime' : result.type);
  wrap.innerHTML = `<i data-lucide="${fmOn ? 'shield-check' : SEV_ICONS[result.type]}"></i>`;
  label.textContent = fmOn ? 'Fuerza Mayor — Sin castigo' : result.label;
  amount.textContent = fmOn ? 'L0' : `L${result.penalty}`;
  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  RETROACTIVE REGISTRATION
// ══════════════════════════════════════════════════════════
function initRetroSection() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const maxDate  = yesterday.toLocaleDateString('sv-SE');
  const now      = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  const retroDate  = document.getElementById('retro-date');
  retroDate.max    = maxDate;
  retroDate.min    = firstDay;
  retroDate.value  = maxDate;

  document.getElementById('retro-time').value = '08:00';
  document.getElementById('retro-fm-toggle').checked = false;
  document.getElementById('retro-fm-reason-field').classList.add('hidden');
  document.getElementById('retro-fm-reason').value = '';
  updateRetroPenaltyPreview();
}

function updateRetroPenaltyPreview() {
  const timeVal = document.getElementById('retro-time')?.value;
  const fmOn    = document.getElementById('retro-fm-toggle')?.checked;
  const preview = document.getElementById('retro-penalty-preview');
  const wrap    = document.getElementById('retro-preview-wrap');
  const label   = document.getElementById('retro-preview-label');
  const amount  = document.getElementById('retro-preview-amount');
  if (!timeVal) { preview?.classList.add('hidden'); return; }
  const result = calculatePenalty(timeVal);
  preview.classList.remove('hidden');
  wrap.className    = 'preview-sev-icon ' + (fmOn ? 'fm' : result.type);
  wrap.innerHTML    = `<i data-lucide="${fmOn ? 'shield-check' : SEV_ICONS[result.type]}"></i>`;
  label.textContent = fmOn ? 'Fuerza Mayor — Sin castigo' : result.label;
  amount.textContent= fmOn ? 'L0' : `L${result.penalty}`;
  lucide.createIcons();
}

async function handleRetroRegister() {
  const dateVal  = document.getElementById('retro-date').value;
  const timeVal  = document.getElementById('retro-time').value;
  const fmOn     = document.getElementById('retro-fm-toggle').checked;
  const fmReason = document.getElementById('retro-fm-reason').value.trim();

  if (!dateVal || dateVal >= today()) return alert('Selecciona una fecha válida anterior a hoy.');
  if (!timeVal) return alert('Ingresa la hora de llegada.');
  if (fmOn && !fmReason) return alert('Describe el motivo de fuerza mayor.');

  // Verify no existing record for that date before attempting write
  setLoading(true, 'Verificando...');
  try {
    const { records } = await readRecords();
    const existing = records.find(r => r.memberId === STATE.member.id && r.date === dateVal);
    if (existing) {
      alert('Ya existe un registro para ese día.\nNo se puede modificar ni reemplazar.');
      return;
    }
  } catch (_) { /* allow — writeAction will catch duplicates */ }
  finally { setLoading(false); }

  const penalty = calculatePenalty(timeVal);
  const now     = new Date();
  const [y, m, d] = dateVal.split('-');

  const record = {
    id:                 uuid(),
    memberId:           STATE.member.id,
    memberName:         STATE.member.name,
    date:               dateVal,
    claimedArrivalTime: timeVal,
    submittedAt:        now.toISOString(),
    minutesLate:        fmOn ? 0 : penalty.minutesLate,
    severity:           fmOn ? null : penalty.severity,
    penalty:            fmOn ? 0    : penalty.penalty,
    coffeeRequired:     fmOn ? false : penalty.coffeeRequired,
    isForceMajeure:     fmOn,
    forceMajeureReason: fmReason,
    isRetroactive:      true,
    status:             'pending',
    verifiedBy:         null,
    verifiedAt:         null,
    verifierName:       null,
  };

  const btn = document.getElementById('btn-retro-register');
  btn.disabled = true;
  setLoading(true, 'Enviando registro...');

  try {
    await writeAction('add_record', record);
    document.getElementById('retro-section').classList.add('hidden');
    alert(`Llegada del ${d}/${m}/${y} registrada.\nQueda pendiente de verificación.`);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
}

// ══════════════════════════════════════════════════════════
//  DELETE / CORRECT RECORD
// ══════════════════════════════════════════════════════════
async function handleDeleteRecord(recordId) {
  if (!confirm('¿Eliminar tu registro de hoy para corregirlo?')) return;
  setLoading(true, 'Eliminando registro...');
  try {
    await writeAction('delete_record', { recordId, memberId: STATE.member.id });
    STATE.todayRecord = null;
    await loadMainScreen();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ══════════════════════════════════════════════════════════
//  REGISTER ARRIVAL
// ══════════════════════════════════════════════════════════
async function handleRegister() {
  const timeVal = document.getElementById('arrival-time').value;
  if (!timeVal) return alert('Ingresa la hora de llegada.');

  const fmOn = document.getElementById('fm-toggle').checked;
  const fmReason = document.getElementById('fm-reason').value.trim();
  if (fmOn && !fmReason) return alert('Describe el motivo de fuerza mayor.');

  const penalty = calculatePenalty(timeVal);
  const now     = new Date();

  const record = {
    id:               uuid(),
    memberId:         STATE.member.id,
    memberName:       STATE.member.name,
    date:             today(),
    claimedArrivalTime: timeVal,
    submittedAt:      now.toISOString(),
    minutesLate:      fmOn ? 0 : penalty.minutesLate,
    severity:         fmOn ? null : penalty.severity,
    penalty:          fmOn ? 0    : penalty.penalty,
    coffeeRequired:   fmOn ? false : penalty.coffeeRequired,
    isForceMajeure:   fmOn,
    forceMajeureReason: fmReason,
    status:           'pending',
    verifiedBy:       null,
    verifiedAt:       null,
    verifierName:     null,
  };

  setLoading(true, 'Enviando registro...');
  try {
    await writeAction('add_record', record);
    STATE.todayRecord = record;
    showResultScreen(record, penalty, fmOn, now);
  } catch (err) {
    alert('Error al registrar: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ══════════════════════════════════════════════════════════
//  RESULT SCREEN
// ══════════════════════════════════════════════════════════
function showResultScreen(record, penalty, fmOn, sentAt) {
  const ring   = document.getElementById('result-icon-ring');
  const icon   = document.getElementById('result-icon');
  const title  = document.getElementById('result-title');
  const sub    = document.getElementById('result-subtitle');
  const stats  = document.getElementById('result-stats');
  const coffee = document.getElementById('coffee-notice');

  const type = fmOn ? 'fm' : penalty.type;
  ring.className = 'result-icon-ring ' + type;
  icon.innerHTML = `<i data-lucide="${SEV_ICONS[type] || 'check-circle-2'}"></i>`;

  if (fmOn) {
    title.textContent = 'Fuerza Mayor';
    sub.textContent   = 'Registro enviado. No genera castigo.';
  } else if (penalty.severity === null) {
    title.textContent = '¡A tiempo!';
    sub.textContent   = 'Llegaste dentro del SLA. Buen trabajo.';
  } else if (penalty.severity === 3) {
    title.textContent = 'Latencia Menor';
    sub.textContent   = 'Has generado un incidente Severidad 3.';
  } else if (penalty.severity === 2) {
    title.textContent = 'Degradación de Servicio';
    sub.textContent   = 'Has generado un incidente Severidad 2.';
  } else {
    title.textContent = 'Caída Crítica';
    sub.textContent   = 'Has generado un incidente Severidad 1.';
  }

  // Stats boxes
  stats.innerHTML = '';
  if (!fmOn) {
    stats.innerHTML = `
      <div class="stat-box">
        <span class="stat-label">Minutos tarde</span>
        <span class="stat-value">${penalty.minutesLate}</span>
        <span class="stat-unit">min</span>
      </div>
      <div class="stat-box">
        <span class="stat-label">Castigo</span>
        <span class="stat-value">L${penalty.penalty}</span>
        <span class="stat-unit">al fondo</span>
      </div>
    `;
  }

  // Coffee notice
  coffee.classList.toggle('hidden', !(penalty.coffeeRequired && !fmOn));

  // Meta
  document.getElementById('meta-sent-time').textContent = formatTime12(
    `${String(sentAt.getHours()).padStart(2,'0')}:${String(sentAt.getMinutes()).padStart(2,'0')}`
  );

  showScreen('screen-result');
}

// ══════════════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════════════
function setLoading(on, text = '') {
  const el = document.getElementById('loading');
  if (on) {
    el.querySelector('span') && (el.querySelector('span').textContent = text);
    el.classList.remove('hidden');
    lucide.createIcons();
  } else {
    el.classList.add('hidden');
  }
}

// ══════════════════════════════════════════════════════════
//  CONFIG MODAL
// ══════════════════════════════════════════════════════════
function openConfig() {
  document.getElementById('modal-config').classList.remove('hidden');
  lucide.createIcons();
}
function closeConfig() { document.getElementById('modal-config').classList.add('hidden'); }


// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
async function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Retrieve saved token
  const savedToken = localStorage.getItem(KEYS.token);
  if (savedToken) {
    setLoading(true, 'Cargando...');
    try {
      const team = await readTeam();
      const member = team.members.find(m => m.token === savedToken && m.active);
      if (member) {
        STATE.token  = savedToken;
        STATE.member = member;
        await loadMainScreen();
        return;
      }
    } catch (_) { /* fallthrough to token screen */ }
    finally { setLoading(false); }
  }

  showScreen('screen-token');

  // Bind token screen events
  document.getElementById('btn-validate-token').addEventListener('click', handleTokenValidation);
  document.getElementById('token-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleTokenValidation();
  });
}

// ── Event Listeners ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  init();

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión?')) return;
    localStorage.removeItem(KEYS.token);
    STATE.token = null;
    STATE.member = null;
    clearInterval(clockInterval);
    showScreen('screen-token');
  });

  // Arrival time change → update preview
  document.getElementById('arrival-time').addEventListener('input', updatePenaltyPreview);

  // Force majeure toggle
  document.getElementById('fm-toggle').addEventListener('change', e => {
    document.getElementById('fm-reason-field').classList.toggle('hidden', !e.target.checked);
    updatePenaltyPreview();
  });

  // Register button
  document.getElementById('btn-register').addEventListener('click', handleRegister);

  // Retroactive section toggle
  document.getElementById('btn-show-retro').addEventListener('click', () => {
    const sec = document.getElementById('retro-section');
    const isHidden = sec.classList.contains('hidden');
    sec.classList.toggle('hidden');
    if (isHidden) initRetroSection();
  });
  document.getElementById('retro-time').addEventListener('input', updateRetroPenaltyPreview);
  document.getElementById('retro-fm-toggle').addEventListener('change', e => {
    document.getElementById('retro-fm-reason-field').classList.toggle('hidden', !e.target.checked);
    updateRetroPenaltyPreview();
  });
  document.getElementById('btn-retro-register').addEventListener('click', handleRetroRegister);

  // Back button (result → main)
  document.getElementById('btn-back').addEventListener('click', async () => {
    await loadMainScreen();
  });

  // Config FAB
  document.getElementById('btn-config').addEventListener('click', openConfig);
  document.getElementById('btn-close-config').addEventListener('click', closeConfig);
  document.getElementById('modal-backdrop').addEventListener('click', closeConfig);
});
