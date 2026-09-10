import { dataService } from '../data/data-service.js';
import { sanitize, sanitizeTitle, formatDate } from '../utils/helpers.js';
import { projectColor, simulateAllocation, summarizeResources, timelineRange, validateAllocation, validateAllocationProject } from '../data/resource-allocation.js';

const STORAGE_KEY = 'rja.resourceAllocation.v1';
const STATUSES = ['Planejado', 'Em andamento', 'Concluído', 'Suspenso', 'Cancelado'];
const ZOOMS = { week: 'Semana', month: 'Mês', quarter: 'Trimestre', semester: 'Semestre', year: 'Ano' };
const ZOOM_DAYS = { week: 14, month: 45, quarter: 120, semester: 210, year: 420 };

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

function addDays(value, days) {
  const date = parseLocalDate(value) || new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function stateFromData() {
  const saved = loadState();
  const projects = Array.isArray(saved.projects) && saved.projects.length ? saved.projects : dataService.getProjects().map(project => ({
    id: project.id,
    name: project.name || project.key,
    client: project.key,
    startDate: project.plannedStartDate || new Date().toISOString().slice(0, 10),
    endDate: project.plannedEndDate || '',
    status: 'Em andamento',
    note: 'Importado da base do RJA',
  })).filter(project => project.endDate);
  return {
    tab: saved.tab || 'professional',
    zoom: saved.zoom || 'month',
    viewDate: saved.viewDate || isoDate(new Date()),
    alertDays: Number(saved.alertDays || 30),
    filters: saved.filters || {},
    projects,
    allocations: Array.isArray(saved.allocations) ? saved.allocations : [],
    history: Array.isArray(saved.history) ? saved.history : [],
  };
}

function optionRows(rows, selected = '', label = 'name') {
  return rows.map(row => `<option value="${sanitize(row.id)}" ${String(row.id) === String(selected) ? 'selected' : ''}>${sanitize(row[label] || row.name || row.displayName)}</option>`).join('');
}

function persist(partial) {
  saveState({ ...stateFromData(), ...partial });
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
  const allSummary = summarizeResources(users, projects, allocations, new Date(), state.alertDays);
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
    <button class="btn btn-secondary" type="submit">Salvar projeto</button>
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
    <button class="btn btn-primary" type="submit">Salvar alocação</button>
    ${simulation ? `<p class="${simulation.conflict ? 'sr-warning' : 'muted'}">Simulação: capacidade resultante máxima ${simulation.peak}%. ${simulation.conflict ? 'Conflito identificado; ao salvar será solicitada confirmação.' : 'Sem sobrealocação.'}</p>` : ''}
  </form>`;
}

function renderKpis(summary) {
  const items = [
    ['Total de profissionais', summary.totals.professionals],
    ['Totalmente alocados', summary.totals.full],
    ['Parcialmente alocados', summary.totals.partial],
    ['Disponíveis', summary.totals.available],
    ['Sobrealocados', summary.totals.overallocated],
    ['Sem alocação futura', summary.totals.noFuture],
    ['Disponíveis nos próximos 30 dias', summary.totals.availableSoon],
  ];
  return `<div class="kpi-grid">${items.map(([label, value]) => `<div class="kpi-card"><div class="kpi-value">${value}</div><div class="kpi-label">${sanitize(label)}</div></div>`).join('')}</div>`;
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
      <div class="ra-person" title="${sanitizeTitle(row.user.email || row.user.displayName)}"><strong>${sanitize(row.user.displayName)}</strong><span>${row.coveredUntil ? `Coberto até ${formatDate(row.coveredUntil)}` : 'Sem cobertura futura'} · ${row.currentLoad}% · ${statusLabel(row.status)}</span><em>${row.noFuture ? `Sem alocação futura a partir de ${formatDate(row.nextAvailability)}` : row.nextProject ? `Próximo: ${sanitize(row.nextProject.projectId)}` : 'Sem alerta'}</em></div>
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

function statusLabel(status) {
  return {
    overallocated: 'Sobrealocado',
    full: '100% alocado',
    partial: 'Parcial',
    available: 'Disponível',
  }[status] || status;
}

function renderProjectView(projects, allocations, users) {
  return `<section class="report-section"><h3>Visão por Projeto</h3>${projects.map(project => {
    const rows = allocations.filter(item => item.projectId === project.id);
    return `<article class="ra-project"><h4><span style="background:${projectColor(project.id)}"></span>${sanitize(project.name)} <small>${sanitize(project.client || '')}</small></h4>${rows.length ? rows.map(item => {
      const user = users.find(user => user.id === item.userId);
      return `<p>${sanitize(user?.displayName || item.userId)} · ${formatDate(item.startDate)} → ${formatDate(item.endDate)} · ${sanitize(item.percent)}% ${item.role ? `· ${sanitize(item.role)}` : ''}</p>`;
    }).join('') : '<p class="muted">Sem profissionais alocados.</p>'}</article>`;
  }).join('')}</section>`;
}

export function renderResourceAllocation() {
  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');
  const state = stateFromData();
  const users = dataService.getUsersRanked().filter(user => user.id !== 'unassigned');
  const ctx = filteredContext(state, users);
  const summary = summarizeResources(ctx.users, ctx.projects, ctx.allocations, new Date(), state.alertDays);
  const clients = [...new Set(state.projects.map(project => project.client).filter(Boolean))].sort();
  const roles = [...new Set(state.allocations.map(item => item.role).filter(Boolean))].sort();
  header.innerHTML = '<h2>Alocação de Recursos</h2><div class="subtitle">Planejamento e acompanhamento de capacidade por profissional e projeto</div>';
  content.innerHTML = `<div class="report-page resource-allocation">
    <div class="report-tabs"><button class="${state.tab === 'professional' ? 'active' : ''}" data-tab="professional">Visão por Profissional</button><button class="${state.tab === 'project' ? 'active' : ''}" data-tab="project">Visão por Projeto</button></div>
    <div class="report-toolbar">
      <label>Busca<input id="ra-search" value="${sanitize(state.filters.search || '')}" placeholder="Profissional, projeto ou cliente"></label>
      <label>Projeto<select id="ra-project-filter"><option value="">Todos</option>${optionRows(state.projects, state.filters.projectId)}</select></label>
      <label>Cliente<select id="ra-client-filter"><option value="">Todos</option>${clients.map(client => `<option ${state.filters.client === client ? 'selected' : ''}>${sanitize(client)}</option>`).join('')}</select></label>
      <label>Profissional<select id="ra-user-filter"><option value="">Todos</option>${optionRows(users, state.filters.userId, 'displayName')}</select></label>
      <label>Função<select id="ra-role-filter"><option value="">Todas</option>${roles.map(role => `<option ${state.filters.role === role ? 'selected' : ''}>${sanitize(role)}</option>`).join('')}</select></label>
      <label>Status<select id="ra-status-filter"><option value="">Todos</option>${STATUSES.map(status => `<option ${state.filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
      <label>Disponibilidade<select id="ra-availability-filter"><option value="">Todas</option><option value="available" ${state.filters.availability === 'available' ? 'selected' : ''}>Disponíveis</option><option value="partial" ${state.filters.availability === 'partial' ? 'selected' : ''}>Parciais</option><option value="full" ${state.filters.availability === 'full' ? 'selected' : ''}>100%</option><option value="overallocated" ${state.filters.availability === 'overallocated' ? 'selected' : ''}>Sobrealocados</option><option value="noFuture" ${state.filters.availability === 'noFuture' ? 'selected' : ''}>Sem futuro</option></select></label>
      <label>Período inicial<input id="ra-start-filter" type="date" value="${sanitize(state.filters.start || '')}"></label>
      <label>Período final<input id="ra-end-filter" type="date" value="${sanitize(state.filters.end || '')}"></label>
      <label>Zoom<select id="ra-zoom">${Object.entries(ZOOMS).map(([id, label]) => `<option value="${id}" ${state.zoom === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button class="btn btn-secondary" id="ra-prev" title="Voltar janela">Anterior</button>
      <button class="btn btn-secondary" id="ra-today">Hoje</button>
      <button class="btn btn-secondary" id="ra-next" title="Avançar janela">Próximo</button>
      <button class="btn btn-secondary" id="ra-clear">Limpar</button>
    </div>
    ${renderKpis(summary)}
    <section class="report-section"><h3>Cadastro</h3>${renderProjectForm()}${renderAllocationForm(state, users)}</section>
    ${state.tab === 'project' ? renderProjectView(ctx.projects, ctx.allocations, users) : renderProfessionalView(summary, state)}
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
    }, zoom: document.getElementById('ra-zoom')?.value || state.zoom });
    renderResourceAllocation();
  };
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { persist({ tab: button.dataset.tab }); renderResourceAllocation(); }));
  ['ra-project-filter', 'ra-client-filter', 'ra-user-filter', 'ra-role-filter', 'ra-status-filter', 'ra-availability-filter', 'ra-start-filter', 'ra-end-filter', 'ra-zoom'].forEach(id => document.getElementById(id)?.addEventListener('change', applyFilters));
  document.getElementById('ra-search')?.addEventListener('input', applyFilters);
  document.getElementById('ra-clear')?.addEventListener('click', () => { persist({ filters: {} }); renderResourceAllocation(); });
  document.getElementById('ra-prev')?.addEventListener('click', () => { persist({ viewDate: isoDate(addDays(state.viewDate, -(ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month))) }); renderResourceAllocation(); });
  document.getElementById('ra-today')?.addEventListener('click', () => { persist({ viewDate: isoDate(new Date()) }); renderResourceAllocation(); });
  document.getElementById('ra-next')?.addEventListener('click', () => { persist({ viewDate: isoDate(addDays(state.viewDate, ZOOM_DAYS[state.zoom] || ZOOM_DAYS.month)) }); renderResourceAllocation(); });
  document.getElementById('ra-project-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    const project = { ...form, id: form.id || crypto.randomUUID() };
    const errors = validateAllocationProject(project);
    if (errors.length) return alert(errors.join('\n'));
    persist({ projects: [...state.projects.filter(item => item.id !== project.id), project] });
    renderResourceAllocation();
  });
  document.getElementById('ra-allocation-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    const allocation = { ...form, id: form.id || crypto.randomUUID(), percent: Number(form.percent) };
    const errors = validateAllocation(allocation);
    if (errors.length) return alert(errors.join('\n'));
    const simulation = simulateAllocation(state.allocations, allocation);
    if (simulation.conflict && !confirm(`Sobrealocação identificada: capacidade resultante ${simulation.peak}%. Deseja salvar mesmo assim?`)) return;
    const before = state.allocations.find(item => item.id === allocation.id) || null;
    persist({ allocations: [...state.allocations.filter(item => item.id !== allocation.id), allocation], history: [...state.history, { id: crypto.randomUUID(), at: new Date().toISOString(), before, after: allocation }] });
    renderResourceAllocation();
  });
}
