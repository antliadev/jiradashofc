import { dataService } from '../data/data-service.js';
import { sanitize, sanitizeTitle, formatDate } from '../utils/helpers.js';
import { allocationLoadByDay, projectColor, simulateAllocation, summarizeResources, timelineRange, validateAllocation, validateAllocationProject } from '../data/resource-allocation.js';

const STORAGE_KEY = 'rja.resourceAllocation.v1';
const UI_KEY = 'rja.resourceAllocation.ui.v1';
const STATUSES = ['Planejado', 'Em andamento', 'Concluído', 'Suspenso', 'Cancelado'];
const ZOOMS = { week: 'Semana', month: 'Mês', quarter: 'Trimestre', semester: 'Semestre', year: 'Ano' };
const ZOOM_DAYS = { week: 14, month: 45, quarter: 120, semester: 210, year: 420 };
const HIDDEN_RESOURCE_PROFESSIONALS = ['bruno', 'bruna', 'leandro', 'pedro', 'lucas', 'suellen'];

function parseLocalDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isoDate(value) {
  const date = parseLocalDate(value) || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function alertMonthsFromState(ui = {}) {
  if (Number.isFinite(Number(ui.alertMonths)) && Number(ui.alertMonths) > 0) return Number(ui.alertMonths);
  if (Number.isFinite(Number(ui.alertDays)) && Number(ui.alertDays) > 0) return Math.max(1, Math.round(Number(ui.alertDays) / 30));
  return 1;
}

function addDays(value, days) {
  const date = parseLocalDate(value) || new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function loadUiState() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveUiState(state) {
  localStorage.setItem(UI_KEY, JSON.stringify(state));
}

async function fetchRemoteState() {
  const response = await fetch('/api/jira/resource-allocation/state', { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar Alocação de Recursos.');
  return payload;
}

async function saveRemoteProject(project) {
  const response = await fetch('/api/jira/resource-allocation/projects', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o projeto.');
  return payload.project;
}

async function saveRemoteAllocation(allocation) {
  const response = await fetch('/api/jira/resource-allocation/allocations', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allocation }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar a alocação.');
  return payload.allocation;
}

async function deleteRemoteAllocation(id) {
  const response = await fetch(`/api/jira/resource-allocation/allocations/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível remover a alocação.');
  return payload.allocation;
}

async function deleteRemoteProject(id) {
  const response = await fetch(`/api/jira/resource-allocation/projects/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível remover o projeto.');
  return payload;
}

function normalizeName(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function isHiddenResourceProfessional(user = {}) {
  const clean = normalizeName(user.displayName || user.name || user.email || user.id);
  return HIDDEN_RESOURCE_PROFESSIONALS.some(name => clean === name || clean.startsWith(`${name} `) || clean.includes(` ${name} `));
}

function resourceUsers(users = []) {
  return users
    .filter(user => user.id !== 'unassigned')
    .filter(user => !isHiddenResourceProfessional(user))
    .sort((a, b) => String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

async function stateFromData() {
  const saved = loadState();
  let remote = null;
  let persistence = 'supabase';
  let warning = '';
  try {
    remote = await fetchRemoteState();
    saveState(remote);
  } catch (error) {
    persistence = 'local';
    warning = `${error.message} Usando fallback local somente para desenvolvimento/validação offline.`;
  }
  const ui = loadUiState();
  const source = remote || saved;
  const projects = Array.isArray(saved.projects) && saved.projects.length ? saved.projects : [];
  return {
    tab: ui.tab || 'professional',
    zoom: ui.zoom || 'month',
    viewDate: ui.viewDate || isoDate(new Date()),
    alertMonths: alertMonthsFromState(ui),
    filters: ui.filters || {},
    projects: Array.isArray(source.projects) && source.projects.length ? source.projects : projects,
    allocations: Array.isArray(source.allocations) ? source.allocations : [],
    history: Array.isArray(source.history) ? source.history : [],
    persistence,
    warning,
  };
}

function optionRows(rows, selected = '', label = 'name') {
  return rows.map(row => `<option value="${sanitize(row.id)}" ${String(row.id) === String(selected) ? 'selected' : ''}>${sanitize(row[label] || row.name || row.displayName)}</option>`).join('');
}

function persist(partial) {
  saveUiState({ ...loadUiState(), ...partial });
}

function persistLocalData(state, partial) {
  saveState({ projects: state.projects, allocations: state.allocations, history: state.history, ...partial });
}

function applySavedProject(state, project) {
  return [...state.projects.filter(item => item.id !== project.id), project].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function applySavedAllocation(state, allocation) {
  return [...state.allocations.filter(item => item.id !== allocation.id), allocation].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function removeSavedAllocation(state, id) {
  return state.allocations.filter(item => item.id !== id);
}

function removeSavedProject(state, id) {
  return {
    projects: state.projects.filter(project => project.id !== id),
    allocations: state.allocations.filter(allocation => allocation.projectId !== id),
  };
}

function filteredContext(state, users) {
  const text = String(state.filters.search || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const projects = state.projects.filter(project => {
    if (state.filters.projectId && project.id !== state.filters.projectId) return false;
    if (state.filters.client && project.client !== state.filters.client) return false;
    if (state.filters.status && project.status !== state.filters.status) return false;
    if (!text) return true;
    return `${project.name} ${project.client}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(text);
  });
  const projectIds = new Set(projects.map(project => project.id));
  const allocations = state.allocations.filter(item => {
    if (!projectIds.has(item.projectId)) return false;
    if (state.filters.userId && item.userId !== state.filters.userId) return false;
    if (state.filters.role && item.role !== state.filters.role) return false;
    if (state.filters.percent && Number(item.percent) < Number(state.filters.percent)) return false;
    if (state.filters.start && item.endDate < state.filters.start) return false;
    if (state.filters.end && item.startDate > state.filters.end) return false;
    return true;
  });
  const allSummary = summarizeResources(users, projects, allocations, new Date(), state.alertMonths);
  const filteredUsers = users.filter(user => {
    if (state.filters.userId && user.id !== state.filters.userId) return false;
    if (!state.filters.availability) return true;
    const row = allSummary.rows.find(item => item.user.id === user.id);
    return row?.status === state.filters.availability || (state.filters.availability === 'noFuture' && row?.noFuture);
  });
  return { projects, allocations, users: filteredUsers };
}

function renderProjectForm(project = {}) {
  return `<form id="ra-project-form" class="ra-form">
    <input type="hidden" name="id" value="${sanitize(project.id || '')}">
    <label>Nome do projeto<input name="name" required value="${sanitize(project.name || '')}"></label>
    <label>Cliente<input name="client" value="${sanitize(project.client || '')}"></label>
    <label>Início<input name="startDate" type="date" required value="${sanitize(project.startDate || '')}"></label>
    <label>Término previsto<input name="endDate" type="date" required value="${sanitize(project.endDate || '')}"></label>
    <label>Status<select name="status" required>${STATUSES.map(status => `<option ${project.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
    <label>Observação<input name="note" value="${sanitize(project.note || '')}"></label>
    <button class="btn btn-secondary" type="submit">${project.id ? 'Atualizar projeto' : 'Salvar projeto'}</button>
    ${project.id ? '<button class="btn btn-ghost" type="button" id="ra-cancel-project-edit">Cancelar edição</button>' : ''}
  </form>`;
}

function renderAllocationForm(state, users, allocation = {}) {
  const simulation = allocation.userId && allocation.projectId && allocation.startDate && allocation.endDate && allocation.percent
    ? simulateAllocation(state.allocations, allocation)
    : null;
  return `<form id="ra-allocation-form" class="ra-form">
    <input type="hidden" name="id" value="${sanitize(allocation.id || '')}">
    <label>Profissional<select name="userId" required><option value="">Selecione</option>${optionRows(users, allocation.userId, 'displayName')}</select></label>
    <label>Projeto<select name="projectId" required><option value="">Selecione</option>${optionRows(state.projects, allocation.projectId)}</select></label>
    <label>Início<input name="startDate" type="date" required value="${sanitize(allocation.startDate || '')}"></label>
    <label>Fim<input name="endDate" type="date" required value="${sanitize(allocation.endDate || '')}"></label>
    <label>Percentual<input name="percent" type="number" min="1" max="200" step="1" required value="${sanitize(allocation.percent || 100)}"></label>
    <label>Função<input name="role" value="${sanitize(allocation.role || '')}"></label>
    <label>Observação<input name="note" value="${sanitize(allocation.note || '')}"></label>
    <button class="btn btn-primary" type="submit">${allocation.id ? 'Atualizar alocação' : 'Salvar alocação'}</button>
    ${allocation.id ? '<button class="btn btn-ghost" type="button" id="ra-cancel-allocation-edit">Cancelar edição</button>' : ''}
    ${simulation ? `<p class="${simulation.conflict ? 'sr-warning' : 'muted'}">Simulação: capacidade resultante máxima ${simulation.peak}%. ${simulation.conflict ? 'Conflito identificado; ao salvar será solicitada confirmação.' : 'Sem sobrealocação.'}</p>` : ''}
  </form>`;
}

function renderKpis(summary, { compact = false } = {}) {
  const items = [
    ['total', 'Total de profissionais', summary.totals.professionals],
    ['full', 'Totalmente alocados', summary.totals.full],
    ['partial', 'Parcialmente alocados', summary.totals.partial],
    ['available', 'Disponíveis', summary.totals.available],
    ['overallocated', 'Sobrealocados', summary.totals.overallocated],
    ['noFuture', 'Sem alocação futura', summary.totals.noFuture],
  ];
  if (!compact) items.push(['availableSoon', 'Disponíveis na janela configurada', summary.totals.availableSoon]);
  return `<div class="kpi-grid ra-kpi-grid">${items.map(([id, label, value]) => `<button type="button" class="kpi-card ra-kpi-card" data-resource-kpi="${sanitize(id)}"><div class="kpi-value">${value}</div><div class="kpi-label">${sanitize(label)}</div></button>`).join('')}</div>`;
}

function renderProfessionalView(summary, state) {
  const visibleEnd = addDays(state.viewDate, ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month);
  const range = state.filters.start || state.filters.end
    ? { start: parseLocalDate(state.filters.start || state.viewDate), end: parseLocalDate(state.filters.end || visibleEnd) }
    : timelineRange(state.allocations, state.viewDate);
  if (!state.filters.start && !state.filters.end) range.end = visibleEnd > range.end ? visibleEnd : range.end;
  const days = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
  return `<section class="report-section"><h3>Visão por Profissional</h3><div class="ra-timeline">${summary.rows.map(row => `
    <article class="ra-row" data-user-id="${sanitize(row.user.id)}">
      <div class="ra-person" title="${sanitizeTitle(row.user.email || row.user.displayName)}"><strong>${sanitize(row.user.displayName)}</strong><span>${row.coveredUntil ? `Coberto até ${formatDate(row.coveredUntil)}` : 'Sem cobertura futura'} · ${row.currentLoad}% · ${statusLabel(row.status)}</span><em>${row.noFuture ? `Sem alocação futura a partir de ${formatDate(row.nextAvailability)}` : row.nextProject ? `Próximo: ${sanitize(projectName(state, row.nextProject.projectId))}` : 'Sem alerta'}</em></div>
      <div class="ra-bars">${row.allocations.map(item => {
        const allocationStart = parseLocalDate(item.startDate);
        const allocationEnd = parseLocalDate(item.endDate);
        const start = Math.max(0, Math.round(((allocationStart - range.start) / 86400000) / days * 100));
        const width = Math.max(3, Math.round((((allocationEnd - allocationStart) / 86400000) + 1) / days * 100));
        const project = state.projects.find(project => project.id === item.projectId);
        return `<span class="ra-bar ${row.status}" style="left:${start}%;width:${Math.min(width, 100 - start)}%;background:${projectColor(item.projectId)}" title="${sanitizeTitle(`${project?.name || item.projectId}: ${item.percent}% · ${formatDate(item.startDate)} a ${formatDate(item.endDate)}`)}">${sanitize(project?.name || item.projectId)}</span>`;
      }).join('')}${row.gaps.map(gap => `<span class="ra-gap" title="Gap sem alocação: ${formatDate(gap.startDate)} a ${formatDate(gap.endDate)}"></span>`).join('')}</div>
    </article>`).join('')}</div></section>`;
}

function renderScaleHeader(range, zoom) {
  const labels = monthSegments(range).map(segment => `<span class="ra-month-label" style="left:${segment.left.toFixed(4)}%;width:${segment.width.toFixed(4)}%">${segment.date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>`);
  if (!labels.length || zoom === 'week') labels.unshift(`<span class="ra-month-label" style="left:0%;width:100%">${range.start.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>`);
  return `${renderMonthGrid(range)}${labels.join('')}`;
}

function todayMarkerStyle(left) {
  const bounded = Math.max(0, Math.min(100, Number(left || 0)));
  return `--today-left:${bounded.toFixed(4)}%;`;
}

function timelineBarStyle(segment) {
  const left = Math.max(0, Math.min(100, Number(segment.left || 0)));
  const width = Math.max(1.2, Math.min(Number(segment.width || 0), 100 - left));
  const needsPercentGutter = left < 4;
  return needsPercentGutter
    ? `left:calc(${left.toFixed(4)}% + var(--ra-subrow-percent-space));width:max(48px, calc(${width.toFixed(4)}% - var(--ra-subrow-percent-space)));background:${projectColor(segment.projectId)}`
    : `left:${left.toFixed(4)}%;width:${width.toFixed(4)}%;background:${projectColor(segment.projectId)}`;
}

function renderAllocationCalendar(viewDate) {
  const reference = parseLocalDate(viewDate);
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const todayIso = isoDate(new Date());
  const selectedIso = isoDate(reference);
  const cells = [];
  for (let index = 0; index < 42; index++) {
    const day = addDays(start, index);
    const inMonth = day.getMonth() === reference.getMonth();
    const dayIso = isoDate(day);
    const label = day.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    cells.push(`<button type="button" class="${inMonth ? '' : 'muted'} ${dayIso === todayIso || dayIso === selectedIso ? 'active' : ''}" data-calendar-date="${dayIso}" title="Ir para ${sanitizeTitle(label)}">${day.getDate()}</button>`);
  }
  return `<div class="ra-calendar-grid"><b>D</b><b>S</b><b>T</b><b>Q</b><b>Q</b><b>S</b><b>S</b>${cells.join('')}</div>`;
}

function daySpan(start, end) {
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function monthSegments(range) {
  const days = daySpan(range.start, range.end);
  const segments = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  for (; cursor <= range.end; cursor.setMonth(cursor.getMonth() + 1)) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const visibleStart = monthStart < range.start ? range.start : monthStart;
    const visibleEnd = monthEnd > range.end ? range.end : monthEnd;
    if (visibleEnd < range.start || visibleStart > range.end) continue;
    const left = ((visibleStart - range.start) / 86400000) / days * 100;
    const width = daySpan(visibleStart, visibleEnd) / days * 100;
    segments.push({ date: new Date(monthStart), left: Math.max(0, left), width: Math.min(width, 100 - Math.max(0, left)) });
  }
  return segments;
}

function renderMonthGrid(range) {
  return `<div class="ra-month-grid" aria-hidden="true">${monthSegments(range).map(segment => `<i style="left:${segment.left.toFixed(4)}%;width:${segment.width.toFixed(4)}%"></i>`).join('')}</div>`;
}

function visibleAllocationSegment(allocation, range) {
  const allocationStart = parseLocalDate(allocation.startDate);
  const allocationEnd = parseLocalDate(allocation.endDate);
  if (!allocationStart || !allocationEnd || allocationEnd < range.start || allocationStart > range.end) return null;
  const days = daySpan(range.start, range.end);
  const visibleStart = allocationStart < range.start ? range.start : allocationStart;
  const visibleEnd = allocationEnd > range.end ? range.end : allocationEnd;
  const left = ((visibleStart - range.start) / 86400000) / days * 100;
  const width = daySpan(visibleStart, visibleEnd) / days * 100;
  return {
    allocationStart,
    allocationEnd,
    visibleStart,
    visibleEnd,
    left: Math.max(0, left),
    width: Math.min(width, 100 - Math.max(0, left)),
    clippedStart: allocationStart < range.start,
    clippedEnd: allocationEnd > range.end,
  };
}

function peakVisibleLoad(allocations, userId, range) {
  return allocationLoadByDay(allocations, userId, range.start, range.end)
    .reduce((peak, day) => Math.max(peak, day.total), 0);
}

function timelineStatus(row) {
  if (row.status === 'overallocated') return 'overallocated';
  if (row.availableSoon || row.noFuture) return 'attention';
  if (row.status === 'available') return 'available';
  return 'allocated';
}

function groupRows(rows, state) {
  const groupBy = state.filters.groupBy || 'role';
  if (groupBy === 'project') {
    return state.projects.map(project => ({
      title: project.name,
      subtitle: project.client || 'Projeto',
      rows: rows.filter(row => row.allocations.some(item => item.projectId === project.id)),
    })).filter(group => group.rows.length);
  }
  if (groupBy === 'client') {
    const clients = [...new Set(state.projects.map(project => project.client || 'Sem cliente'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return clients.map(client => ({
      title: client,
      subtitle: 'Cliente',
      rows: rows.filter(row => row.allocations.some(item => (state.projects.find(project => project.id === item.projectId)?.client || 'Sem cliente') === client)),
    })).filter(group => group.rows.length);
  }
  const roles = [...new Set(rows.map(row => row.current[0]?.role || row.allocations[0]?.role || 'Sem função'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return roles.map(role => ({
    title: role,
    subtitle: `${rows.filter(row => (row.current[0]?.role || row.allocations[0]?.role || 'Sem função') === role).length} profissional(is)`,
    rows: rows.filter(row => (row.current[0]?.role || row.allocations[0]?.role || 'Sem função') === role),
  }));
}

function renderTimelineView(summary, state) {
  const visibleEnd = addDays(state.viewDate, ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month);
  const range = state.filters.start || state.filters.end
    ? { start: parseLocalDate(state.filters.start || state.viewDate), end: parseLocalDate(state.filters.end || visibleEnd) }
    : { start: parseLocalDate(state.viewDate), end: visibleEnd };
  const days = daySpan(range.start, range.end);
  const today = parseLocalDate(new Date());
  const todayLeft = today >= range.start && today <= range.end ? Math.round(((today - range.start) / 86400000) / days * 100) : null;
  const groups = groupRows(summary.rows, state);
  return `<section class="ra-timeline-view">
    <div class="section-header">
      <div><h3>Timeline de Alocação</h3><p>Visão temporal dos profissionais, capacidade e lacunas de alocação.</p></div>
      <div class="ra-timeline-actions">
        <label>Agrupar por <select id="ra-group-filter"><option value="role" ${state.filters.groupBy === 'role' ? 'selected' : ''}>Função</option><option value="project" ${state.filters.groupBy === 'project' ? 'selected' : ''}>Projeto</option><option value="client" ${state.filters.groupBy === 'client' ? 'selected' : ''}>Cliente</option></select></label>
        <label>Sem alocação após <select id="ra-alert-months"><option value="1" ${state.alertMonths === 1 ? 'selected' : ''}>1 mês</option><option value="2" ${state.alertMonths === 2 ? 'selected' : ''}>2 meses</option><option value="3" ${state.alertMonths === 3 ? 'selected' : ''}>3 meses</option><option value="6" ${state.alertMonths === 6 ? 'selected' : ''}>6 meses</option></select></label>
        <button type="button" class="btn btn-secondary" id="ra-zoom-out">−</button>
        <button type="button" class="btn btn-secondary" id="ra-fit-timeline">⌕</button>
        <button type="button" class="btn btn-secondary" id="ra-zoom-in">+</button>
      </div>
    </div>
    <div class="ra-timeline-shell">
      <div class="ra-timeline-table">
        <div class="ra-timeline-head">
          <span>Profissional</span><span>% alocação</span><div class="ra-scale">${renderScaleHeader(range, state.zoom)}${todayLeft !== null ? `<i style="${todayMarkerStyle(todayLeft)}">Hoje</i>` : ''}</div>
        </div>
        ${groups.map(group => `<details class="ra-group" open><summary>${sanitize(group.title)} <small>${sanitize(group.subtitle)}</small></summary>${group.rows.map(row => {
          const visibleAllocations = row.allocations
            .map(item => ({ item, segment: visibleAllocationSegment(item, range) }))
            .filter(entry => entry.segment)
            .sort((a, b) => a.segment.visibleStart - b.segment.visibleStart || String(a.item.projectId).localeCompare(String(b.item.projectId)));
          const peakLoad = peakVisibleLoad(state.allocations, row.user.id, range);
          const status = peakLoad > 100 ? 'overallocated' : timelineStatus(row);
          return `<article class="ra-timeline-row ${status}" data-user-id="${sanitize(row.user.id)}">
            <div class="ra-sticky-person"><span class="ra-dot ${status}"></span><strong>${sanitize(row.user.displayName)}</strong><small>${row.coveredUntil ? `Coberto até ${formatDate(row.coveredUntil)}` : 'Sem alocação futura'}</small></div>
            <div class="ra-load-badge ${peakLoad > 100 ? 'danger' : peakLoad >= 100 ? 'success' : peakLoad > 0 ? 'warning' : ''}">${peakLoad}%</div>
            <div class="ra-timeline-track">${renderMonthGrid(range)}${todayLeft !== null ? `<span class="ra-today-line" style="left:${todayLeft}%"></span>` : ''}${visibleAllocations.map(({ item, segment }) => {
              const project = state.projects.find(project => project.id === item.projectId);
              const title = `${project?.name || item.projectId} · ${item.percent}% · ${formatDate(item.startDate)} a ${formatDate(item.endDate)}${item.role ? ` · ${item.role}` : ''}`;
              return `<div class="ra-timeline-subrow">
                <span class="ra-subrow-percent ${Number(item.percent || 0) > 100 ? 'danger' : Number(item.percent || 0) >= 100 ? 'success' : 'warning'}">${sanitize(item.percent)}%</span>
                <button type="button" class="ra-timeline-bar ${segment.clippedStart ? 'is-clipped-start' : ''} ${segment.clippedEnd ? 'is-clipped-end' : ''}" data-edit-allocation="${sanitize(item.id)}" style="${timelineBarStyle({ ...segment, projectId: item.projectId })}" title="${sanitizeTitle(title)}"><span>${sanitize(project?.name || item.projectId)}</span><small>${formatDate(item.startDate)} → ${formatDate(item.endDate)}</small></button>
              </div>`;
            }).join('')}${visibleAllocations.length ? '' : '<div class="ra-empty-timeline">Sem alocação neste período</div>'}</div>
          </article>`;
        }).join('')}</details>`).join('') || '<p class="muted">Nenhum profissional encontrado para os filtros atuais.</p>'}
      </div>
      <aside class="ra-timeline-aside">
        <div class="ra-calendar-card"><h4>Calendário de Alocação</h4><strong>${parseLocalDate(state.viewDate).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>${renderAllocationCalendar(state.viewDate)}</div>
        <div class="ra-legend"><h4>Legenda de Status</h4><span><i class="ra-dot allocated"></i><b>Em andamento</b><small>Projeto em execução</small></span><span><i class="ra-dot planned"></i><b>Planejado</b><small>Alocação confirmada</small></span><span><i class="ra-dot warning"></i><b>Atenção</b><small>Risco de sobrealocação</small></span><span><i class="ra-dot overallocated"></i><b>Sobre alocado</b><small>Acima de 100%</small></span><span><i class="ra-dot finished"></i><b>Finalizado</b><small>Projeto concluído</small></span><span><i class="ra-empty-line"></i><b>Sem alocação</b><small>Período sem projeto</small></span></div>
        <div class="ra-period-summary"><h4>Resumo do Período</h4><p>Profissionais alocados <strong>${summary.totals.full}</strong></p><p>Parcialmente alocados <strong>${summary.totals.partial}</strong></p><p>Disponíveis <strong>${summary.totals.available}</strong></p><p>Sobre alocados <strong>${summary.totals.overallocated}</strong></p><p>Sem alocação futura <strong>${summary.totals.noFuture}</strong></p></div>
      </aside>
    </div>
  </section>`;
}

function statusLabel(status) {
  return {
    overallocated: 'Sobrealocado',
    full: '100% alocado',
    partial: 'Parcial',
    available: 'Disponível',
  }[status] || status;
}

function projectName(state, projectId) {
  return state.projects.find(project => project.id === projectId)?.name || projectId;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '?').toUpperCase();
}

function temporalAllocationStatus(item, reference = new Date()) {
  const start = parseLocalDate(item.startDate);
  const end = parseLocalDate(item.endDate);
  const today = parseLocalDate(reference);
  if (!start || !end) return { id: 'attention', label: 'Atenção' };
  if (today < start) return { id: 'planned', label: 'Planejado' };
  if (today > end) return { id: 'finished', label: 'Finalizado' };
  return { id: 'active', label: 'Em andamento' };
}

function projectStatusClass(status) {
  const value = String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (value.includes('conclu')) return 'finished';
  if (value.includes('suspens') || value.includes('cancel')) return 'attention';
  if (value.includes('andamento')) return 'active';
  return 'planned';
}

function renderProjectView(projects, allocations, users) {
  const today = parseLocalDate(new Date());
  return `<section class="ra-project-view">
    <div class="section-header">
      <div>
        <h3>Visão por Projeto</h3>
        <p>Projetos, profissionais alocados, períodos, capacidade e ações em uma visão executiva.</p>
      </div>
      <span class="ra-view-count">${projects.length} projeto(s)</span>
    </div>
    <div class="ra-project-grid">${projects.map(project => {
    const rows = allocations
      .filter(item => item.projectId === project.id)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.userName).localeCompare(String(b.userName), 'pt-BR'));
    const activeRows = rows.filter(item => {
      const start = parseLocalDate(item.startDate);
      const end = parseLocalDate(item.endDate);
      return start && end && today >= start && today <= end;
    });
    const people = new Set(rows.map(item => item.userId || item.userName).filter(Boolean));
    const activeLoad = activeRows.reduce((sum, item) => sum + Number(item.percent || 0), 0);
    const plannedRows = rows.filter(item => temporalAllocationStatus(item).id === 'planned').length;
    const statusClass = projectStatusClass(project.status);
    const coverageText = project.startDate && project.endDate
      ? `${formatDate(project.startDate)} → ${formatDate(project.endDate)}`
      : 'Período não informado';
    const loadWidth = Math.min(100, Math.max(0, activeLoad));
    return `<article class="ra-project ra-project-card ${statusClass}">
      <header class="ra-project-card-header">
        <div class="ra-project-title">
          <span class="ra-project-color" style="background:${projectColor(project.id)}"></span>
          <div>
            <h4>${sanitize(project.name)}</h4>
            <p>${sanitize(project.client || 'Cliente não informado')} · ${coverageText}</p>
          </div>
        </div>
        <div class="ra-project-actions">
          <span class="ra-project-status ${statusClass}">${sanitize(project.status || 'Planejado')}</span>
          <button class="btn btn-secondary btn-compact" type="button" data-edit-project="${sanitize(project.id)}">Editar projeto</button>
          <button class="btn btn-secondary btn-compact danger" type="button" data-delete-project="${sanitize(project.id)}">Excluir projeto</button>
        </div>
      </header>
      <div class="ra-project-metrics">
        <div><strong>${people.size}</strong><span>Profissionais</span></div>
        <div><strong>${rows.length}</strong><span>Alocações</span></div>
        <div><strong>${activeLoad}%</strong><span>Capacidade ativa</span></div>
        <div><strong>${plannedRows}</strong><span>Futuras</span></div>
      </div>
      <div class="ra-project-load" aria-label="Capacidade ativa do projeto">
        <span style="width:${loadWidth}%"></span>
      </div>
      <div class="ra-project-allocations">${rows.length ? rows.map(item => {
      const user = users.find(user => user.id === item.userId);
      const displayName = user?.displayName || item.userName || item.userId || 'Profissional';
      const allocationStatus = temporalAllocationStatus(item);
      const otherAllocations = allocations
        .filter(other => other.id !== item.id && other.userId === item.userId && temporalAllocationStatus(other).id !== 'finished')
        .map(other => {
          const otherProject = projects.find(project => project.id === other.projectId);
          return `${otherProject?.name || other.projectId}: ${other.percent}%`;
        });
      const otherTitle = Number(item.percent || 0) < 100 && otherAllocations.length ? `Também alocado em: ${otherAllocations.join(' · ')}` : '';
      return `<div class="ra-project-allocation ${allocationStatus.id}" ${otherTitle ? `title="${sanitizeTitle(otherTitle)}"` : ''}>
          <div class="ra-user-avatar">${user?.avatarUrl ? `<img src="${sanitizeTitle(user.avatarUrl)}" alt="${sanitizeTitle(displayName)}" onerror="const parent=this.parentElement;this.remove();parent.textContent='${sanitizeTitle(initials(displayName))}'">` : sanitize(initials(displayName))}</div>
          <div class="ra-allocation-main">
            <strong>${sanitize(displayName)}</strong>
            <span>${item.role ? `${sanitize(item.role)} · ` : ''}${formatDate(item.startDate)} → ${formatDate(item.endDate)}</span>
          </div>
          <span class="ra-allocation-percent ${Number(item.percent || 0) > 100 ? 'danger' : Number(item.percent || 0) >= 100 ? 'success' : 'warning'}">${sanitize(item.percent)}%</span>
          <span class="ra-allocation-status">${allocationStatus.label}</span>
        </div>`;
    }).join('') : '<div class="ra-project-empty"><strong>Sem profissionais alocados</strong><span>Use o cadastro acima para vincular profissionais a este projeto.</span></div>'}</div>
    </article>`;
  }).join('')}</div></section>`;
}

function resourceKpiRows(summary, kpi) {
  const filters = {
    total: row => row,
    full: row => row.status === 'full',
    partial: row => row.status === 'partial',
    available: row => row.status === 'available',
    overallocated: row => row.status === 'overallocated',
    noFuture: row => row.noFuture,
    availableSoon: row => row.availableSoon,
  };
  return summary.rows.filter(filters[kpi] || filters.total);
}

function showResourceKpiModal(summary, kpi) {
  const labels = {
    total: 'Total de profissionais',
    full: 'Totalmente alocados',
    partial: 'Parcialmente alocados',
    available: 'Disponíveis',
    overallocated: 'Sobrealocados',
    noFuture: 'Sem alocação futura',
    availableSoon: 'Disponíveis na janela configurada',
  };
  const rows = resourceKpiRows(summary, kpi);
  const previous = document.querySelector('.ui-modal-backdrop[data-ra-kpi-modal]');
  previous?.remove();
  const modal = document.createElement('div');
  modal.className = 'ui-modal-backdrop';
  modal.dataset.raKpiModal = 'true';
  modal.innerHTML = `<div class="ui-modal ra-kpi-modal" role="dialog" aria-modal="true" aria-labelledby="ra-kpi-modal-title">
    <div class="ui-modal-icon">i</div>
    <div class="ui-modal-body">
      <h2 id="ra-kpi-modal-title">${sanitize(labels[kpi] || 'Profissionais')}</h2>
      <p>${rows.length} profissional(is) neste status.</p>
      <div class="ra-kpi-modal-list">${rows.map(row => `<article><strong>${sanitize(row.user.displayName)}</strong><span>${sanitize(statusLabel(row.status))} · ${row.currentLoad}%${row.coveredUntil ? ` · coberto até ${formatDate(row.coveredUntil)}` : ''}</span></article>`).join('') || '<article><strong>Nenhum profissional encontrado</strong><span>Altere os filtros ou a janela de disponibilidade.</span></article>'}</div>
    </div>
    <div class="ui-modal-actions"><button type="button" class="btn btn-primary" data-close-modal>Fechar</button></div>
  </div>`;
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-close-modal]')) modal.remove();
  });
  document.body.appendChild(modal);
  modal.querySelector('[data-close-modal]')?.focus();
}

function renderHistory(state, users) {
  return `<section class="report-section"><h3>Histórico de alterações</h3><div class="table-container"><table class="data-table"><thead><tr><th>Data</th><th>Ação</th><th>Projeto</th><th>Profissional</th><th>Alteração</th></tr></thead><tbody>${state.history.slice(0, 50).map(event => {
    const after = event.after || {};
    const projectId = event.projectId || event.project_id || after.project_id || after.projectId || after.id;
    const project = state.projects.find(item => item.id === projectId);
    const user = users.find(item => item.id === (after.user_id || after.userId));
    return `<tr><td>${formatDate(event.createdAt || event.created_at || event.at)}</td><td>${sanitize(event.action || 'alteração')}</td><td>${sanitize(project?.name || projectId || '-')}</td><td>${sanitize(user?.displayName || after.user_name || after.userName || '-')}</td><td>${sanitize(after.percent ? `${after.percent}% de ${after.start_date || after.startDate} a ${after.end_date || after.endDate}` : after.name || '-')}</td></tr>`;
  }).join('') || '<tr><td colspan="5">Nenhuma alteração registrada.</td></tr>'}</tbody></table></div></section>`;
}

export async function renderResourceAllocation() {
  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');
  header.innerHTML = '<h2>Alocação de Recursos</h2><div class="subtitle">Planejamento e acompanhamento de capacidade por profissional e projeto</div>';
  content.innerHTML = '<div class="empty-state"><h3>Carregando Alocação de Recursos</h3><p>Consultando projetos, alocações e histórico.</p></div>';
  const state = await stateFromData();
  const users = resourceUsers(dataService.getUsersForSelection());
  const editingProject = state.filters.editProjectId ? state.projects.find(project => project.id === state.filters.editProjectId) : null;
  const editingAllocation = state.filters.editAllocationId ? state.allocations.find(allocation => allocation.id === state.filters.editAllocationId) : null;
  const ctx = filteredContext(state, users);
  const summary = summarizeResources(ctx.users, ctx.projects, ctx.allocations, new Date(), state.alertMonths);
  const clients = [...new Set(state.projects.map(project => project.client).filter(Boolean))].sort();
  const roles = [...new Set(state.allocations.map(item => item.role).filter(Boolean))].sort();
  const isTimeline = state.tab === 'timeline';
  const isProject = state.tab === 'project';
  content.innerHTML = `<div class="report-page resource-allocation ${isTimeline ? 'resource-allocation-timeline-mode' : ''} ${isProject ? 'resource-allocation-project-mode' : ''}">
    ${state.warning ? `<div class="sr-warning" role="alert"><strong>Atenção:</strong> ${sanitize(state.warning)}</div>` : ''}
    ${isTimeline ? '<p class="muted">Visão visual da alocação de profissionais em projetos ao longo do tempo.</p>' : `<p class="muted">Fonte dos dados de alocação: ${state.persistence === 'supabase' ? 'Supabase/API protegida' : 'fallback local do navegador'}. Profissionais vêm dos dados sincronizados do RJA.</p>`}
    <div class="report-tabs"><button class="${state.tab === 'professional' ? 'active' : ''}" data-tab="professional">Visão por Profissional</button><button class="${state.tab === 'project' ? 'active' : ''}" data-tab="project">Visão por Projeto</button><button class="${state.tab === 'timeline' ? 'active' : ''}" data-tab="timeline">Visão Timeline</button></div>
    <div class="report-toolbar">
      <label>Busca<input id="ra-search" value="${sanitize(state.filters.search || '')}" placeholder="Profissional, projeto ou cliente"></label>
      <label>Projeto<select id="ra-project-filter"><option value="">Todos</option>${optionRows(state.projects, state.filters.projectId)}</select></label>
      <label>Cliente<select id="ra-client-filter"><option value="">Todos</option>${clients.map(client => `<option ${state.filters.client === client ? 'selected' : ''}>${sanitize(client)}</option>`).join('')}</select></label>
      <label>Profissional<select id="ra-user-filter"><option value="">Todos</option>${optionRows(users, state.filters.userId, 'displayName')}</select></label>
      <label>Função<select id="ra-role-filter"><option value="">Todas</option>${roles.map(role => `<option ${state.filters.role === role ? 'selected' : ''}>${sanitize(role)}</option>`).join('')}</select></label>
      <label>Status<select id="ra-status-filter"><option value="">Todos</option>${STATUSES.map(status => `<option ${state.filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
      <label>Disponibilidade<select id="ra-availability-filter"><option value="">Todas</option><option value="available" ${state.filters.availability === 'available' ? 'selected' : ''}>Disponíveis</option><option value="partial" ${state.filters.availability === 'partial' ? 'selected' : ''}>Parciais</option><option value="full" ${state.filters.availability === 'full' ? 'selected' : ''}>100%</option><option value="overallocated" ${state.filters.availability === 'overallocated' ? 'selected' : ''}>Sobrealocados</option><option value="noFuture" ${state.filters.availability === 'noFuture' ? 'selected' : ''}>Sem alocação futura</option></select></label>
      <label>Sem alocação após<select id="ra-alert-days"><option value="1" ${state.alertMonths === 1 ? 'selected' : ''}>1 mês</option><option value="2" ${state.alertMonths === 2 ? 'selected' : ''}>2 meses</option><option value="3" ${state.alertMonths === 3 ? 'selected' : ''}>3 meses</option><option value="6" ${state.alertMonths === 6 ? 'selected' : ''}>6 meses</option></select></label>
      <label>Período inicial<input id="ra-start-filter" type="date" value="${sanitize(state.filters.start || '')}"></label>
      <label>Período final<input id="ra-end-filter" type="date" value="${sanitize(state.filters.end || '')}"></label>
      <label>Zoom<select id="ra-zoom">${Object.entries(ZOOMS).map(([id, label]) => `<option value="${id}" ${state.zoom === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button class="btn btn-secondary" id="ra-prev" title="Voltar janela">Anterior</button>
      <button class="btn btn-secondary" id="ra-today">Hoje</button>
      <button class="btn btn-secondary" id="ra-next" title="Avançar janela">Próximo</button>
      <button class="btn btn-secondary" id="ra-clear">Limpar</button>
    </div>
    ${renderKpis(summary, { compact: isTimeline })}
    ${isTimeline ? '' : `<section class="report-section"><h3>Cadastro</h3>${renderProjectForm(editingProject || {})}${renderAllocationForm(state, users, editingAllocation || {})}</section>`}
    ${isTimeline ? renderTimelineView(summary, state) : state.tab === 'project' ? renderProjectView(ctx.projects, ctx.allocations, users) : renderProfessionalView(summary, state)}
    ${isTimeline ? '' : renderHistory(state, users)}
  </div>`;

  const applyFilters = () => {
    persist({ filters: {
      search: document.getElementById('ra-search')?.value || '',
      projectId: document.getElementById('ra-project-filter')?.value || '',
      client: document.getElementById('ra-client-filter')?.value || '',
      userId: document.getElementById('ra-user-filter')?.value || '',
      role: document.getElementById('ra-role-filter')?.value || '',
      status: document.getElementById('ra-status-filter')?.value || '',
      availability: document.getElementById('ra-availability-filter')?.value || '',
      start: document.getElementById('ra-start-filter')?.value || '',
      end: document.getElementById('ra-end-filter')?.value || '',
      groupBy: document.getElementById('ra-group-filter')?.value || state.filters.groupBy || 'role',
    }, zoom: document.getElementById('ra-zoom')?.value || state.zoom, alertMonths: Number(document.getElementById('ra-alert-days')?.value || state.alertMonths) });
    renderResourceAllocation();
  };
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { persist({ tab: button.dataset.tab }); renderResourceAllocation(); }));
  ['ra-project-filter', 'ra-client-filter', 'ra-user-filter', 'ra-role-filter', 'ra-status-filter', 'ra-availability-filter', 'ra-start-filter', 'ra-end-filter', 'ra-zoom', 'ra-group-filter', 'ra-alert-days'].forEach(id => document.getElementById(id)?.addEventListener('change', applyFilters));
  document.getElementById('ra-alert-months')?.addEventListener('change', event => {
    const months = Number(event.target.value || 1);
    persist({ alertMonths: months });
    renderResourceAllocation();
  });
  document.querySelectorAll('[data-calendar-date]').forEach(button => button.addEventListener('click', () => {
    persist({ viewDate: button.dataset.calendarDate });
    renderResourceAllocation();
  }));
  document.querySelectorAll('[data-resource-kpi]').forEach(button => button.addEventListener('click', () => showResourceKpiModal(summary, button.dataset.resourceKpi)));
  document.getElementById('ra-search')?.addEventListener('input', applyFilters);
  document.getElementById('ra-clear')?.addEventListener('click', () => { persist({ filters: {} }); renderResourceAllocation(); });
  document.getElementById('ra-prev')?.addEventListener('click', () => { persist({ viewDate: isoDate(addDays(state.viewDate, -(ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month))) }); renderResourceAllocation(); });
  document.getElementById('ra-today')?.addEventListener('click', () => { persist({ viewDate: isoDate(new Date()) }); renderResourceAllocation(); });
  document.getElementById('ra-next')?.addEventListener('click', () => { persist({ viewDate: isoDate(addDays(state.viewDate, ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month)) }); renderResourceAllocation(); });
  document.getElementById('ra-zoom-out')?.addEventListener('click', () => {
    const order = Object.keys(ZOOMS);
    persist({ zoom: order[Math.max(0, order.indexOf(state.zoom) - 1)] || state.zoom });
    renderResourceAllocation();
  });
  document.getElementById('ra-zoom-in')?.addEventListener('click', () => {
    const order = Object.keys(ZOOMS);
    persist({ zoom: order[Math.min(order.length - 1, order.indexOf(state.zoom) + 1)] || state.zoom });
    renderResourceAllocation();
  });
  document.getElementById('ra-fit-timeline')?.addEventListener('click', () => {
    persist({ filters: { ...state.filters, start: '', end: '' }, zoom: 'month', viewDate: isoDate(new Date()) });
    renderResourceAllocation();
  });
  document.getElementById('ra-cancel-project-edit')?.addEventListener('click', () => { persist({ filters: { ...state.filters, editProjectId: '' } }); renderResourceAllocation(); });
  document.getElementById('ra-cancel-allocation-edit')?.addEventListener('click', () => { persist({ filters: { ...state.filters, editAllocationId: '' } }); renderResourceAllocation(); });
  document.querySelectorAll('[data-edit-project]').forEach(button => button.addEventListener('click', () => { persist({ filters: { ...state.filters, editProjectId: button.dataset.editProject } }); renderResourceAllocation(); }));
  document.querySelectorAll('[data-delete-project]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.deleteProject;
    const project = state.projects.find(item => item.id === id);
    const linked = state.allocations.filter(item => item.projectId === id);
    if (!confirm(`Excluir o projeto "${project?.name || id}" e remover ${linked.length} alocação(ões) vinculada(s)?`)) return;
    try {
      if (state.persistence === 'supabase') await deleteRemoteProject(id);
      const next = removeSavedProject(state, id);
      persistLocalData(state, { ...next, history: [...state.history, { id: crypto.randomUUID(), action: 'project.deleted', at: new Date().toISOString(), before: project ? { ...project, allocations: linked } : null, after: null }] });
      persist({ filters: { ...state.filters, editProjectId: '', editAllocationId: '', projectId: state.filters.projectId === id ? '' : state.filters.projectId } });
      renderResourceAllocation();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.querySelectorAll('[data-edit-allocation]').forEach(button => button.addEventListener('click', () => { persist({ filters: { ...state.filters, editAllocationId: button.dataset.editAllocation } }); renderResourceAllocation(); }));
  document.querySelectorAll('[data-delete-allocation]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.deleteAllocation;
    if (!confirm('Remover este profissional do projeto? O histórico da alteração será preservado.')) return;
    try {
      if (state.persistence === 'supabase') await deleteRemoteAllocation(id);
      persistLocalData(state, { allocations: removeSavedAllocation(state, id), history: [...state.history, { id: crypto.randomUUID(), action: 'allocation.deleted', at: new Date().toISOString(), before: state.allocations.find(item => item.id === id), after: null }] });
      renderResourceAllocation();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.getElementById('ra-project-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    const project = { ...form, id: form.id || crypto.randomUUID() };
    const errors = validateAllocationProject(project);
    if (errors.length) return alert(errors.join('\n'));
    try {
      const saved = state.persistence === 'supabase' ? await saveRemoteProject(project) : project;
      persistLocalData(state, { projects: applySavedProject(state, saved), history: [...state.history, { id: crypto.randomUUID(), action: form.id ? 'project.updated' : 'project.created', at: new Date().toISOString(), after: saved }] });
      persist({ filters: { ...state.filters, editProjectId: '' } });
      renderResourceAllocation();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('ra-allocation-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    const user = users.find(item => item.id === form.userId);
    const allocation = { ...form, id: form.id || crypto.randomUUID(), percent: Number(form.percent), userName: user?.displayName || '', userEmail: user?.email || '' };
    const errors = validateAllocation(allocation);
    if (errors.length) return alert(errors.join('\n'));
    const simulation = simulateAllocation(state.allocations, allocation);
    if (simulation.conflict && !confirm(`Sobrealocação identificada: capacidade resultante ${simulation.peak}%. Deseja salvar mesmo assim?`)) return;
    const before = state.allocations.find(item => item.id === allocation.id) || null;
    try {
      const saved = state.persistence === 'supabase' ? await saveRemoteAllocation(allocation) : allocation;
      persistLocalData(state, { allocations: applySavedAllocation(state, saved), history: [...state.history, { id: crypto.randomUUID(), action: before ? 'allocation.updated' : 'allocation.created', at: new Date().toISOString(), before, after: saved }] });
      persist({ filters: { ...state.filters, editAllocationId: '' } });
      renderResourceAllocation();
    } catch (error) {
      alert(error.message);
    }
  });
}
