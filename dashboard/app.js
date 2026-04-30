/**
 * Latencia Matutina — Dashboard App Logic
 * Full system: auth, today panel, month/fund, debts, history, admin
 * Backend: Firebase Realtime Database
 */

'use strict';

// ══════════════════════════════════════════════════════════
//  PENALTY ENGINE
// ══════════════════════════════════════════════════════════
function calculatePenalty(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const arrivalMin = h * 60 + m;
  const target     = 8 * 60; // 08:00
  const lateMin    = arrivalMin - target;

  if (lateMin <= 2)  return { severity: null, type: 'ontime', label: 'A tiempo',                  penalty: 0,           minutesLate: 0,       coffeeRequired: false };
  if (lateMin <= 5)  return { severity: 3,    type: 'sev3',   label: 'Latencia menor (Sev 3)',     penalty: lateMin,     minutesLate: lateMin, coffeeRequired: false };
  if (lateMin <= 15) return { severity: 2,    type: 'sev2',   label: 'Degradación (Sev 2)',        penalty: 10 + lateMin, minutesLate: lateMin, coffeeRequired: false };
                     return { severity: 1,    type: 'sev1',   label: 'Caída crítica (Sev 1)',      penalty: lateMin,     minutesLate: lateMin, coffeeRequired: true };
}

// ══════════════════════════════════════════════════════════
//  STORAGE KEYS
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

// ══════════════════════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════════════════════
const APP = {
  token:    null,
  member:   null,
  team:     null,
  records:  [],
  payments: [],
  activeTab: 'today',
  // Verify modal state
  verifyRecordId: null,
  // Payment modal state
  paymentTargetId: null,
};

// ══════════════════════════════════════════════════════════
//  DATA ACCESS — Firebase Realtime Database
// ══════════════════════════════════════════════════════════
async function fetchTeam() {
  const snap = await db.ref('team').get();
  return snap.exists() ? snap.val() : DEFAULT_TEAM;
}

async function fetchRecords() {
  const snap = await db.ref('records').get();
  return snap.exists() ? snap.val() : { records: [] };
}

async function fetchPayments() {
  const snap = await db.ref('payments').get();
  return snap.exists() ? snap.val() : { payments: [] };
}

function fbToArray(val) {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : Object.values(val);
  return arr.filter(item => item != null);
}

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
    const { recordId, updates } = payload;
    const snap = await db.ref('records').get();
    const raw  = snap.exists() ? snap.val() : { records: [] };
    const recs = fbToArray(raw.records);
    const idx  = recs.findIndex(r => r.id === recordId);
    if (idx === -1) throw new Error('Registro no encontrado');
    if (updates.verifiedBy && updates.verifiedBy === recs[idx].memberId) {
      throw new Error('No puedes verificar tu propio registro');
    }
    recs[idx] = { ...recs[idx], ...updates };
    await db.ref('records').set({ records: recs });
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
  if (action === 'update_team') {
    await db.ref('team').set(payload);
    return { success: true };
  }
  throw new Error(`Acción desconocida: ${action}`);
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function today()        { return new Date().toLocaleDateString('sv-SE'); }
function initials(name) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2); }
function uuid()         { return 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); }
function payUuid()      { return 'pay-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); }

function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function currentMonthLabel() {
  return new Date().toLocaleDateString('es-HN', { month: 'long', year: 'numeric' });
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

// Severity display helpers
const SEV_CONFIG = {
  ontime: { icon: 'check-circle-2', label: 'A tiempo',      cls: 'ontime' },
  sev3:   { icon: 'alert-triangle', label: 'Sev 3',         cls: 'sev3' },
  sev2:   { icon: 'alert-octagon',  label: 'Sev 2',         cls: 'sev2' },
  sev1:   { icon: 'zap',            label: 'Sev 1',         cls: 'sev1' },
  fm:     { icon: 'shield-check',   label: 'Fuerza Mayor',  cls: 'fm' },
};

function sevBadge(record) {
  if (record.isForceMajeure) return badge('fm', 'Fuerza Mayor');
  if (!record.severity)       return badge('ontime', 'A tiempo');
  return badge(`sev${record.severity}`, `Sev ${record.severity}`);
}

function badge(type, text) {
  const c = SEV_CONFIG[type] || SEV_CONFIG.ontime;
  return `<span class="sev-badge ${c.cls}"><i data-lucide="${c.icon}"></i>${text}</span>`;
}

function statusBadge(status) {
  const map = {
    pending:  { icon: 'hourglass',      label: 'Pendiente',  cls: 'pending' },
    verified: { icon: 'check-circle-2', label: 'Verificado', cls: 'verified' },
    rejected: { icon: 'x-circle',       label: 'Rechazado',  cls: 'rejected' },
  };
  const s = map[status] || map.pending;
  return `<span class="status-badge ${s.cls}"><i data-lucide="${s.icon}"></i>${s.label}</span>`;
}

function moneyCell(amount, clsIfPositive = 'money-red', clsIfZero = 'money-normal') {
  if (!amount) return `<span class="${clsIfZero}">L0</span>`;
  return `<span class="${clsIfPositive}">L${amount}</span>`;
}

// ══════════════════════════════════════════════════════════
//  LOADING / TOAST
// ══════════════════════════════════════════════════════════
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  const m = document.getElementById('toast-msg');
  t.className = `toast${isError ? ' error' : ''}`;
  m.textContent = msg;
  t.innerHTML = `<i data-lucide="${isError ? 'x-circle' : 'check-circle-2'}"></i><span>${msg}</span>`;
  t.classList.remove('hidden');
  lucide.createIcons();
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════
function switchTab(tabId) {
  APP.activeTab = tabId;
  history.replaceState(null, '', '#' + tabId);
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  const titles = { today: 'Hoy', month: 'Mes', debts: 'Deudas', history: 'Historial', admin: 'Admin' };
  document.getElementById('topbar-title').textContent = titles[tabId] || '';

  // Refresh that tab's data
  switch(tabId) {
    case 'today':   renderToday();   break;
    case 'month':   renderMonth();   break;
    case 'debts':   renderDebts();   break;
    case 'history': renderHistory(); break;
    case 'admin':   renderAdmin();   break;
  }

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

// ══════════════════════════════════════════════════════════
//  LOAD ALL DATA
// ══════════════════════════════════════════════════════════
async function loadAllData() {
  const [teamData, recordsData, paymentsData] = await Promise.all([
    fetchTeam(), fetchRecords(), fetchPayments()
  ]);
  APP.team     = teamData;
  APP.records  = fbToArray(recordsData.records);
  APP.payments = fbToArray(paymentsData.payments);
}

async function refreshData() {
  await loadAllData();
  switchTab(APP.activeTab);
}

// ══════════════════════════════════════════════════════════
//  TAB: TODAY
// ══════════════════════════════════════════════════════════
function renderToday() {
  const todayStr = today();
  document.getElementById('today-date-label').textContent = fmtDateLong(todayStr);

  const todayRecords = APP.records.filter(r => r.date === todayStr);
  const verified     = todayRecords.filter(r => r.status === 'verified');
  const pending      = todayRecords.filter(r => r.status === 'pending');

  document.getElementById('chip-total').innerHTML   = `<i data-lucide="users"></i><span>${todayRecords.length} registros</span>`;
  document.getElementById('chip-pending').innerHTML = `<i data-lucide="hourglass"></i><span>${pending.length} pendientes</span>`;

  // Not-registered banner
  const myRecord = todayRecords.find(r => r.memberId === APP.member.id);

  // Arrival widget visibility
  const widget   = document.getElementById('arrival-widget');
  const awBanner = document.getElementById('aw-registered-banner');

  if (myRecord) {
    widget.classList.add('hidden');
    awBanner.classList.remove('hidden');
    document.getElementById('aw-registered-time').textContent =
      ` · Declaraste ${fmt12(myRecord.claimedArrivalTime)}`;
    const sb = document.getElementById('aw-registered-status');
    const labels = { pending: 'Pendiente', verified: 'Verificado', rejected: 'Rechazado' };
    sb.textContent = labels[myRecord.status] || myRecord.status;
    sb.className   = `status-badge ${myRecord.status}`;
    lucide.createIcons();
    stopAWClock();
  } else {
    widget.classList.remove('hidden');
    awBanner.classList.add('hidden');
    const now     = new Date();
    const nowStr  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const timeEl  = document.getElementById('aw-arrival-time');
    if (timeEl && !timeEl.value) timeEl.value = nowStr;
    document.getElementById('btn-aw-register').disabled = false;
    updateAWPenaltyPreview();
    startAWClock();
  }

  // Table
  const tbody = document.getElementById('today-tbody');
  if (!todayRecords.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><i data-lucide="inbox"></i> Sin registros hoy</td></tr>`;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = todayRecords.map(r => {
    const isSelf     = r.memberId === APP.member.id;
    const canVerify  = !isSelf && r.status === 'pending';
    const nameClass  = isSelf ? 'cell-name cell-self' : 'cell-name';
    const sentTime   = r.submittedAt ? fmt12(r.submittedAt.slice(11,16)) : '—';

    return `<tr>
      <td>
        <div class="member-cell">
          <div class="cell-avatar">${initials(r.memberName)}</div>
          <span class="${nameClass}">${r.memberName}${isSelf ? ' (tú)' : ''}</span>
        </div>
      </td>
      <td><strong>${fmt12(r.claimedArrivalTime)}</strong></td>
      <td><span style="color:var(--text-3);font-size:12px">${sentTime}</span></td>
      <td>${sevBadge(r)}</td>
      <td>${r.isForceMajeure ? '<span style="color:var(--text-3)">—</span>' : moneyCell(r.penalty)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <div class="action-row">
          ${canVerify ? `<button class="btn btn-sm btn-success" onclick="openVerifyModal('${r.id}')">
            <i data-lucide="shield-check"></i> Verificar
          </button>` : ''}
          ${isSelf && r.status === 'pending' ? `<button class="btn btn-sm btn-danger" onclick="deleteOwnRecord('${r.id}')">
            <i data-lucide="trash-2"></i> Corregir
          </button>` : ''}
          ${r.status !== 'pending' && r.verifierName ? `<span style="font-size:12px;color:var(--text-3)">por ${r.verifierName}</span>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  TAB: MONTH
// ══════════════════════════════════════════════════════════
function renderMonth() {
  const ym = currentYearMonth();
  document.getElementById('month-label').textContent = currentMonthLabel().charAt(0).toUpperCase() + currentMonthLabel().slice(1);

  const monthRecords = APP.records.filter(r => r.date && r.date.startsWith(ym));
  const verifiedReal = monthRecords.filter(r => r.status === 'verified' && !r.isForceMajeure && r.severity);

  // Excellence clause
  const hasIncidents = verifiedReal.length > 0;
  const exCard  = document.getElementById('excellence-card');
  const exIcon  = document.getElementById('excellence-icon');
  const exTitle = document.getElementById('excellence-title');
  const exSub   = document.getElementById('excellence-sub');
  const exBadge = document.getElementById('excellence-badge');

  if (!hasIncidents) {
    exIcon.className  = 'excellence-icon pass';
    exIcon.innerHTML  = '<i data-lucide="trophy"></i>';
    exTitle.textContent = 'Cláusula de Excelencia — ACTIVA';
    exSub.textContent   = 'Ningún incidente verificado este mes. ¡Uptime 100%!';
    exBadge.className   = 'excellence-badge pass';
    exBadge.textContent = 'Premio disponible';
  } else {
    exIcon.className  = 'excellence-icon fail';
    exIcon.innerHTML  = '<i data-lucide="x-circle"></i>';
    exTitle.textContent = 'Cláusula de Excelencia — INACTIVA';
    exSub.textContent   = `${verifiedReal.length} incidente(s) verificado(s) este mes.`;
    exBadge.className   = 'excellence-badge fail';
    exBadge.textContent = 'Sin premio';
  }

  // Fund total
  const fund     = verifiedReal.reduce((s, r) => s + (r.penalty || 0), 0);
  const MAX_FUND = 1000;
  document.getElementById('fund-amount').textContent = `L${fund}`;
  document.getElementById('fund-progress-fill').style.width = `${Math.min(100, (fund / MAX_FUND) * 100)}%`;

  // Milestones
  const milestones = [{ id: 'ms-300', val: 300 }, { id: 'ms-600', val: 600 }, { id: 'ms-1000', val: 1000 }];
  milestones.forEach(({ id, val }) => {
    const el = document.getElementById(id);
    if (fund >= val) el.classList.add('reached'); else el.classList.remove('reached');
  });
  document.querySelectorAll('.progress-milestone').forEach((el, i) => {
    const vals = [300, 600, 1000];
    if (fund >= vals[i]) el.classList.add('reached'); else el.classList.remove('reached');
  });

  // Per-member summary
  const members = APP.team?.members?.filter(m => m.active && m.role !== 'admin') || [];
  const tbody   = document.getElementById('month-tbody');

  if (!members.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Sin colaboradores</td></tr>`;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = members.map(member => {
    const mRecs = monthRecords.filter(r => r.memberId === member.id && r.status === 'verified' && !r.isForceMajeure && r.severity);
    const totalMin   = mRecs.reduce((s, r) => s + (r.minutesLate || 0), 0);
    const totalPen   = mRecs.reduce((s, r) => s + (r.penalty || 0), 0);
    const totalPaid  = APP.payments.filter(p => p.debtorId === member.id).reduce((s, p) => s + p.amount, 0);
    const saldo      = totalPen - totalPaid;
    const isSelf     = member.id === APP.member.id;

    return `<tr>
      <td>
        <div class="member-cell">
          <div class="cell-avatar">${initials(member.name)}</div>
          <span class="${isSelf ? 'cell-name cell-self' : 'cell-name'}">${member.name}${isSelf ? ' (tú)' : ''}</span>
        </div>
      </td>
      <td><strong>${mRecs.length}</strong></td>
      <td>${totalMin} min</td>
      <td class="money-red">L${totalPen}</td>
      <td class="money-green">L${totalPaid}</td>
      <td class="${saldo > 0 ? 'money-red' : 'money-green'}">L${saldo}</td>
    </tr>`;
  }).join('');

  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  TAB: DEBTS
// ══════════════════════════════════════════════════════════
function renderDebts() {
  const members = APP.team?.members?.filter(m => m.active) || [];
  const grid    = document.getElementById('debts-grid');

  grid.innerHTML = members.map(member => {
    const verifiedRecs  = APP.records.filter(r => r.memberId === member.id && r.status === 'verified' && !r.isForceMajeure && r.severity);
    const totalPenalty  = verifiedRecs.reduce((s, r) => s + (r.penalty || 0), 0);
    const totalPaid     = APP.payments.filter(p => p.debtorId === member.id).reduce((s, p) => s + p.amount, 0);
    const saldo         = totalPenalty - totalPaid;
    const incidents     = verifiedRecs.length;
    const isSelf        = member.id === APP.member.id;
    const hasDebt       = saldo > 0;

    const payBtn = !isSelf ? `<button class="btn btn-sm btn-primary" onclick="openPaymentModal('${member.id}')">
      <i data-lucide="coins"></i> Registrar pago
    </button>` : `<span style="font-size:12px;color:var(--text-3)"><i data-lucide="info"></i> Eres tú</span>`;

    return `<div class="debt-card${hasDebt ? ' has-debt' : ''}">
      <div class="debt-header">
        <div class="debt-avatar">${initials(member.name)}</div>
        <div>
          <p class="debt-name">${member.name}${isSelf ? ' (tú)' : ''}</p>
          <p class="debt-incidents">${incidents} incidente(s) verificado(s)</p>
        </div>
      </div>
      <div class="debt-amounts">
        <div class="debt-amount-box">
          <span class="dab-label">Castigos</span>
          <span class="dab-value ${totalPenalty > 0 ? 'red' : ''}">L${totalPenalty}</span>
        </div>
        <div class="debt-amount-box">
          <span class="dab-label">Pagado</span>
          <span class="dab-value green">L${totalPaid}</span>
        </div>
        <div class="debt-amount-box">
          <span class="dab-label">Saldo</span>
          <span class="dab-value ${saldo > 0 ? 'amber' : 'green'}">L${Math.abs(saldo)}${saldo < 0 ? ' CR' : ''}</span>
        </div>
      </div>
      <div class="debt-actions">${payBtn}</div>
    </div>`;
  }).join('');

  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  TAB: HISTORY
// ══════════════════════════════════════════════════════════
function renderHistory() {
  const memberFilter = document.getElementById('filter-member').value;
  const monthFilter  = document.getElementById('filter-month').value;
  const statusFilter = document.getElementById('filter-status').value;

  // Populate member filter
  const memberSel = document.getElementById('filter-member');
  const members = APP.team?.members || [];
  if (memberSel.options.length === 1) {
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      memberSel.appendChild(opt);
    });
  }

  let recs = APP.records
    .filter(r => r && r.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (memberFilter) recs = recs.filter(r => r.memberId === memberFilter);
  if (monthFilter)  recs = recs.filter(r => r.date && r.date.startsWith(monthFilter));
  if (statusFilter) recs = recs.filter(r => r.status === statusFilter);

  const tbody = document.getElementById('history-tbody');
  if (!recs.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row"><i data-lucide="inbox"></i> Sin registros</td></tr>`;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = recs.map(r => {
    const isSelf     = r.memberId === APP.member.id;
    const canVerify  = !isSelf && r.status === 'pending';
    return `<tr>
    <td><span style="font-size:12px;font-weight:600;color:var(--text-2)">${fmtDate(r.date)}</span></td>
    <td>
      <div class="member-cell">
        <div class="cell-avatar">${initials(r.memberName)}</div>
        <span class="${isSelf ? 'cell-name cell-self' : 'cell-name'}">${r.memberName}${isSelf ? ' (tú)' : ''}</span>
      </div>
    </td>
    <td><strong>${fmt12(r.claimedArrivalTime)}</strong></td>
    <td>${sevBadge(r)}</td>
    <td>${r.isForceMajeure ? '<span style="color:var(--text-3)">—</span>' : moneyCell(r.penalty)}</td>
    <td>${statusBadge(r.status)}</td>
    <td><span style="font-size:12px;color:var(--text-3)">${r.verifierName || '—'}</span></td>
    <td>
      ${canVerify ? `<button class="btn btn-sm btn-success" onclick="openVerifyModal('${r.id}')">
        <i data-lucide="shield-check"></i> Verificar
      </button>` : ''}
    </td>
  </tr>`;
  }).join('');

  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  TAB: ADMIN
// ══════════════════════════════════════════════════════════
function renderAdmin() {
  // Members table
  const members = APP.team?.members || [];
  const tbody   = document.getElementById('members-tbody');

  tbody.innerHTML = members.map(m => `<tr>
    <td><div class="member-cell">
      <div class="cell-avatar">${initials(m.name)}</div>
      <span class="cell-name">${m.name}</span>
    </div></td>
    <td><code style="font-size:12px;background:var(--bg-input);padding:3px 8px;border-radius:5px;color:var(--blue)">${m.token}</code></td>
    <td><span class="sev-badge ${m.role === 'admin' ? 'sev2' : 'ontime'}">${m.role}</span></td>
    <td><span class="status-badge ${m.active ? 'verified' : 'rejected'}">${m.active ? 'Activo' : 'Inactivo'}</span></td>
    <td>
      <div class="action-row">
        <button class="btn btn-sm btn-secondary" onclick="toggleMember('${m.id}')">
          <i data-lucide="${m.active ? 'user-x' : 'user-check'}"></i>
          ${m.active ? 'Desactivar' : 'Activar'}
        </button>
        <button class="btn btn-sm btn-secondary" onclick="regenToken('${m.id}')">
          <i data-lucide="refresh-cw"></i> Token
        </button>
      </div>
    </td>
  </tr>`).join('');

  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  DELETE / CORRECT OWN RECORD
// ══════════════════════════════════════════════════════════
async function deleteOwnRecord(recordId) {
  if (!confirm('¿Eliminar tu registro para corregirlo? Solo puedes hacerlo mientras esté pendiente.')) return;
  try {
    await writeAction('delete_record', { recordId, memberId: APP.member.id });
    showToast('Registro eliminado — ya puedes ingresar la hora correcta');
    await refreshData();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ══════════════════════════════════════════════════════════
//  VERIFY MODAL
// ══════════════════════════════════════════════════════════
async function openVerifyModal(recordId) {
  try {
    let record = APP.records.find(r => r.id === recordId);

    if (!record) {
      const snap = await db.ref('records').get();
      const recs = fbToArray(snap.exists() ? snap.val().records : null);
      APP.records = recs;
      record = recs.find(r => r.id === recordId);
    }

    if (!record) {
      showToast('Registro no encontrado. Recarga la página.', true);
      return;
    }

    if (record.memberId === APP.member.id) {
      showToast('No puedes verificar tu propio registro', true);
      return;
    }

    APP.verifyRecordId = recordId;

    const sevLabel = record.isForceMajeure
      ? 'Fuerza Mayor'
      : (record.severity ? `Sev ${record.severity}` : 'A tiempo');
    const penaltyLabel = record.isForceMajeure ? 'L0' : `L${record.penalty ?? 0}`;

    const info = document.getElementById('verify-record-info');
    info.innerHTML = `
      <div class="vinfo-row">
        <span class="label"><i data-lucide="user"></i> Colaborador</span>
        <span class="value">${record.memberName}</span>
      </div>
      <div class="vinfo-row">
        <span class="label"><i data-lucide="clock"></i> Hora declarada</span>
        <span class="value">${record.claimedArrivalTime ? fmt12(record.claimedArrivalTime) : '—'}</span>
      </div>
      <div class="vinfo-row">
        <span class="label"><i data-lucide="send"></i> Enviado a las</span>
        <span class="value">${record.submittedAt ? fmt12(record.submittedAt.slice(11,16)) : '—'}</span>
      </div>
      <div class="vinfo-row">
        <span class="label"><i data-lucide="alert-triangle"></i> Severidad</span>
        <span class="value">${sevLabel}</span>
      </div>
      <div class="vinfo-row">
        <span class="label"><i data-lucide="coins"></i> Castigo</span>
        <span class="value">${penaltyLabel}</span>
      </div>
      ${record.isForceMajeure && record.forceMajeureReason ? `<div class="vinfo-row"><span class="label"><i data-lucide="shield-check"></i> Motivo FM</span><span class="value">${record.forceMajeureReason}</span></div>` : ''}
    `;

    document.getElementById('verify-note').value = '';
    openModal('modal-verify');
  } catch(err) {
    showToast('Error al abrir verificación: ' + err.message, true);
    console.error('openVerifyModal error:', err);
  }
}

async function doVerify(status) {
  const note = document.getElementById('verify-note').value.trim();
  const id   = APP.verifyRecordId;
  if (!id) return;

  try {
    await writeAction('update_record', {
      recordId: id,
      updates: {
        status,
        verifiedBy:   APP.member.id,
        verifierName: APP.member.name,
        verifiedAt:   new Date().toISOString(),
        verifyNote:   note,
      }
    });
    closeModal('modal-verify');
    showToast(status === 'verified' ? 'Registro verificado correctamente' : 'Registro rechazado');
    await refreshData();
  } catch(err) {
    showToast(err.message, true);
  }
}

// ══════════════════════════════════════════════════════════
//  PAYMENT MODAL
// ══════════════════════════════════════════════════════════
function openPaymentModal(memberId) {
  const member = APP.team?.members?.find(m => m.id === memberId);
  if (!member) return;

  if (memberId === APP.member.id) {
    showToast('Pide a otro colaborador que registre tu pago', true);
    return;
  }

  APP.paymentTargetId = memberId;

  const totalPen  = APP.records.filter(r => r.memberId === memberId && r.status === 'verified' && !r.isForceMajeure && r.severity).reduce((s, r) => s + r.penalty, 0);
  const totalPaid = APP.payments.filter(p => p.debtorId === memberId).reduce((s, p) => s + p.amount, 0);
  const saldo     = totalPen - totalPaid;

  document.getElementById('payment-debtor-info').innerHTML = `
    <div class="vinfo-row">
      <span class="label"><i data-lucide="user"></i> Colaborador</span>
      <span class="value">${member.name}</span>
    </div>
    <div class="vinfo-row">
      <span class="label"><i data-lucide="coins"></i> Saldo pendiente</span>
      <span class="value" style="color:${saldo > 0 ? 'var(--red)' : 'var(--green)'}">L${saldo}</span>
    </div>
  `;

  document.getElementById('pay-amount').value = saldo > 0 ? saldo : '';
  document.getElementById('pay-desc').value   = '';
  document.getElementById('pay-type').value   = 'partial';
  updatePayAmountVisibility();
  openModal('modal-payment');
}

function updatePayAmountVisibility() {
  const type  = document.getElementById('pay-type').value;
  const field = document.getElementById('pay-amount-field');
  field.classList.toggle('hidden', type === 'coffee');
}

async function doSavePayment() {
  const memberId = APP.paymentTargetId;
  const member   = APP.team?.members?.find(m => m.id === memberId);
  if (!member) return;

  const type   = document.getElementById('pay-type').value;
  const amount = type === 'coffee' ? 0 : parseInt(document.getElementById('pay-amount').value, 10);
  const desc   = document.getElementById('pay-desc').value.trim();

  if (type !== 'coffee' && (!amount || amount < 1)) {
    showToast('Ingresa un monto válido', true);
    return;
  }

  let finalAmount = amount;
  if (type === 'full') {
    const totalPen  = APP.records.filter(r => r.memberId === memberId && r.status === 'verified' && !r.isForceMajeure && r.severity).reduce((s, r) => s + r.penalty, 0);
    const totalPaid = APP.payments.filter(p => p.debtorId === memberId).reduce((s, p) => s + p.amount, 0);
    finalAmount = Math.max(0, totalPen - totalPaid);
  }

  const payment = {
    id:              payUuid(),
    debtorId:        memberId,
    debtorName:      member.name,
    amount:          finalAmount,
    type,
    description:     desc,
    registeredBy:    APP.member.id,
    registeredByName: APP.member.name,
    date:            today(),
    paidAt:          new Date().toISOString(),
  };

  try {
    await writeAction('add_payment', payment);
    closeModal('modal-payment');
    showToast(`Pago de L${finalAmount} registrado para ${member.name}`);
    await refreshData();
  } catch(err) {
    showToast(err.message, true);
  }
}

// ══════════════════════════════════════════════════════════
//  ADMIN ACTIONS
// ══════════════════════════════════════════════════════════
function generateToken(name) {
  const prefix = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,3);
  const num    = Math.floor(1000 + Math.random() * 9000);
  return `TK-${prefix}-${num}`;
}

async function toggleMember(memberId) {
  const team = { ...APP.team };
  const idx  = team.members.findIndex(m => m.id === memberId);
  if (idx === -1) return;
  team.members[idx].active = !team.members[idx].active;
  await writeAction('update_team', team);
  showToast('Colaborador actualizado');
  await refreshData();
}

async function regenToken(memberId) {
  if (!confirm('¿Regenerar el token de este colaborador? El token anterior dejará de funcionar.')) return;
  const team   = { ...APP.team };
  const idx    = team.members.findIndex(m => m.id === memberId);
  if (idx === -1) return;
  const member = team.members[idx];
  const newTok = generateToken(member.name);
  team.members[idx].token = newTok;
  await writeAction('update_team', team);
  showToast(`Nuevo token: ${newTok}`);
  await refreshData();
}

let addMemberModal_token = '';

function openAddMember() {
  addMemberModal_token = generateToken('');
  document.getElementById('new-member-name').value  = '';
  document.getElementById('new-member-role').value  = 'member';
  document.getElementById('new-member-token').value = addMemberModal_token;
  openModal('modal-add-member');
}

async function saveNewMember() {
  const name  = document.getElementById('new-member-name').value.trim();
  const role  = document.getElementById('new-member-role').value;
  const token = document.getElementById('new-member-token').value.trim();

  if (!name) { showToast('Ingresa el nombre', true); return; }

  const id   = name.toLowerCase().replace(/\s+/g, '_').slice(0,12) + '_' + Date.now().toString().slice(-4);
  const team = { ...APP.team };
  team.members.push({ id, name, token, role, active: true });
  await writeAction('update_team', team);
  closeModal('modal-add-member');
  showToast(`${name} agregado al equipo. Token: ${token}`);
  await refreshData();
}

// ══════════════════════════════════════════════════════════
//  EXPORT CSV
// ══════════════════════════════════════════════════════════
function exportCSV() {
  const headers = ['Fecha','Colaborador','Hora Declarada','Min. Tarde','Severidad','Castigo (L)','Fuerza Mayor','Estado','Verificado Por'];
  const rows = APP.records.map(r => [
    r.date,
    r.memberName,
    r.claimedArrivalTime,
    r.minutesLate,
    r.isForceMajeure ? 'FM' : (r.severity ? `Sev ${r.severity}` : 'A tiempo'),
    r.isForceMajeure ? 0 : (r.penalty || 0),
    r.isForceMajeure ? 'Sí' : 'No',
    r.status,
    r.verifierName || '',
  ]);
  const csv  = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href  = url;
  a.download = `latencia_${currentYearMonth()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════
//  REAL-TIME LISTENER
// ══════════════════════════════════════════════════════════
let _recordsListener = null;

function startRecordsListener() {
  if (_recordsListener) db.ref('records').off('value', _recordsListener);
  _recordsListener = snap => {
    const fresh = fbToArray(snap.exists() ? snap.val().records : null);
    if (JSON.stringify(fresh) === JSON.stringify(APP.records)) return;
    APP.records = fresh;
    switchTab(APP.activeTab);
  };
  db.ref('records').on('value', _recordsListener);
}

function stopRecordsListener() {
  if (_recordsListener) {
    db.ref('records').off('value', _recordsListener);
    _recordsListener = null;
  }
}

// ══════════════════════════════════════════════════════════
//  ARRIVAL WIDGET (dashboard inline registration)
// ══════════════════════════════════════════════════════════
let awClockInterval = null;

function startAWClock() {
  if (awClockInterval) clearInterval(awClockInterval);
  updateAWClock();
  awClockInterval = setInterval(updateAWClock, 1000);
}

function stopAWClock() {
  if (awClockInterval) { clearInterval(awClockInterval); awClockInterval = null; }
}

function updateAWClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2,'0');
  const mm  = String(now.getMinutes()).padStart(2,'0');
  const ss  = String(now.getSeconds()).padStart(2,'0');
  const el  = document.getElementById('aw-clock');
  if (el) el.textContent = `${hh}:${mm}:${ss}`;

  const badge = document.getElementById('aw-sla-badge');
  if (!badge) return;
  const lateMin = now.getHours() * 60 + now.getMinutes() - 8 * 60;
  badge.className = 'aw-sla-badge';
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

const AW_SEV_ICONS = { ontime:'check-circle-2', sev3:'alert-triangle', sev2:'alert-octagon', sev1:'zap', fm:'shield-check' };

function updateAWPenaltyPreview() {
  const timeVal  = document.getElementById('aw-arrival-time')?.value;
  const fmOn     = document.getElementById('aw-fm-toggle')?.checked;
  const preview  = document.getElementById('aw-penalty-preview');
  const iconEl   = document.getElementById('aw-preview-icon');
  const labelEl  = document.getElementById('aw-preview-label');
  const amountEl = document.getElementById('aw-preview-amount');
  if (!preview || !timeVal) { preview?.classList.add('hidden'); return; }

  const result = calculatePenalty(timeVal);
  const type   = fmOn ? 'fm' : result.type;
  preview.classList.remove('hidden');
  iconEl.className   = 'preview-sev-icon ' + type;
  iconEl.innerHTML   = `<i data-lucide="${AW_SEV_ICONS[type]}"></i>`;
  labelEl.textContent  = fmOn ? 'Fuerza Mayor — Sin castigo' : result.label;
  amountEl.textContent = fmOn ? 'L0' : `L${result.penalty}`;
  lucide.createIcons();
}

async function handleAWRegister() {
  const timeVal  = document.getElementById('aw-arrival-time').value;
  const fmOn     = document.getElementById('aw-fm-toggle').checked;
  const fmReason = document.getElementById('aw-fm-reason').value.trim();

  if (!timeVal) { showToast('Ingresa la hora de llegada', true); return; }
  if (fmOn && !fmReason) { showToast('Describe el motivo de fuerza mayor', true); return; }

  const penalty = calculatePenalty(timeVal);
  const now     = new Date();

  const record = {
    id:                 uuid(),
    memberId:           APP.member.id,
    memberName:         APP.member.name,
    date:               today(),
    claimedArrivalTime: timeVal,
    submittedAt:        now.toISOString(),
    minutesLate:        fmOn ? 0 : penalty.minutesLate,
    severity:           fmOn ? null : penalty.severity,
    penalty:            fmOn ? 0    : penalty.penalty,
    coffeeRequired:     fmOn ? false : penalty.coffeeRequired,
    isForceMajeure:     fmOn,
    forceMajeureReason: fmReason,
    status:             'pending',
    verifiedBy:         null,
    verifiedAt:         null,
    verifierName:       null,
  };

  const btn = document.getElementById('btn-aw-register');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i><span>Registrando...</span>`;
  lucide.createIcons();

  try {
    await writeAction('add_record', record);
    stopAWClock();
    showToast('¡Llegada registrada correctamente!');
    await refreshData();
  } catch(err) {
    showToast('Error al registrar: ' + err.message, true);
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="map-pin"></i><span>Registrar Llegada</span>`;
    lucide.createIcons();
  }
}

// ══════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  lucide.createIcons();
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
async function doLogin() {
  const tokenVal = document.getElementById('login-token').value.trim().toUpperCase();
  if (!tokenVal) return;

  try {
    const team   = await fetchTeam();
    const member = team.members.find(m => m.token === tokenVal && m.active);
    if (!member) {
      document.getElementById('login-error').classList.remove('hidden');
      return;
    }
    APP.token  = tokenVal;
    APP.member = member;
    localStorage.setItem(KEYS.token, tokenVal);
    await startApp(member);
  } catch(err) {
    showToast('Error al conectar: ' + err.message, true);
  }
}

async function startApp(member) {
  // Setup sidebar user info
  const av = document.getElementById('sidebar-avatar');
  const nm = document.getElementById('sidebar-user-name');
  const rl = document.getElementById('sidebar-user-role');
  av.textContent = initials(member.name);
  nm.textContent = member.name;
  rl.textContent = member.role === 'admin' ? 'Administrador' : 'Colaborador';

  // Show admin tab if needed
  if (member.role === 'admin') {
    document.getElementById('nav-admin').style.display = '';
  }

  // Show app, hide login
  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Load data and render
  await loadAllData();
  const VALID_TABS = ['today', 'month', 'debts', 'history', 'admin'];
  const hashTab = window.location.hash.replace('#', '');
  switchTab(VALID_TABS.includes(hashTab) ? hashTab : 'today');
  startRecordsListener();
}

function doLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  stopRecordsListener();
  localStorage.removeItem(KEYS.token);
  history.replaceState(null, '', window.location.pathname);
  APP.token  = null;
  APP.member = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('login-token').value = '';
  document.getElementById('login-error').classList.add('hidden');
  lucide.createIcons();
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
async function init() {
  lucide.createIcons();

  // Try auto-login
  const saved = localStorage.getItem(KEYS.token);
  if (saved) {
    try {
      const team   = await fetchTeam();
      const member = team.members.find(m => m.token === saved && m.active);
      if (member) {
        APP.token  = saved;
        APP.member = member;
        await startApp(member);
        return;
      }
    } catch (_) {}
    localStorage.removeItem(KEYS.token);
  }

  // Bind login events
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-token').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

}

// ══════════════════════════════════════════════════════════
//  BIND EVENTS on DOMContentLoaded
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  init();

  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const icon = document.querySelector('#btn-refresh svg');
    icon?.classList.add('spin');
    await refreshData();
    icon?.classList.remove('spin');
    showToast('Datos actualizados');
  });

  // Mobile menu
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.getElementById('backdrop-verify').addEventListener('click', ()  => closeModal('modal-verify'));
  document.getElementById('backdrop-payment').addEventListener('click', ()  => closeModal('modal-payment'));
  document.getElementById('backdrop-add-member').addEventListener('click', () => closeModal('modal-add-member'));

  // Verify modal actions
  document.getElementById('btn-verify-record').addEventListener('click', () => doVerify('verified'));
  document.getElementById('btn-reject-record').addEventListener('click', () => doVerify('rejected'));

  // Payment modal
  document.getElementById('pay-type').addEventListener('change', updatePayAmountVisibility);
  document.getElementById('btn-save-payment').addEventListener('click', doSavePayment);

  // Add member modal
  document.getElementById('btn-add-member').addEventListener('click', openAddMember);
  document.getElementById('btn-regen-token').addEventListener('click', () => {
    const name = document.getElementById('new-member-name').value.trim() || 'USR';
    addMemberModal_token = generateToken(name);
    document.getElementById('new-member-token').value = addMemberModal_token;
  });
  document.getElementById('new-member-name').addEventListener('input', () => {
    const name = document.getElementById('new-member-name').value.trim();
    if (name) {
      addMemberModal_token = generateToken(name);
      document.getElementById('new-member-token').value = addMemberModal_token;
    }
  });
  document.getElementById('btn-save-member').addEventListener('click', saveNewMember);

  // History filters
  document.getElementById('filter-member').addEventListener('change', renderHistory);
  document.getElementById('filter-month').addEventListener('change', renderHistory);
  document.getElementById('filter-status').addEventListener('change', renderHistory);

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

  // Arrival widget events
  document.getElementById('aw-arrival-time').addEventListener('input', () => {
    document.getElementById('btn-aw-register').disabled =
      !document.getElementById('aw-arrival-time').value;
    updateAWPenaltyPreview();
  });
  document.getElementById('aw-fm-toggle').addEventListener('change', e => {
    document.getElementById('aw-fm-reason-field').classList.toggle('hidden', !e.target.checked);
    updateAWPenaltyPreview();
  });
  document.getElementById('btn-aw-register').addEventListener('click', handleAWRegister);
});
