/** Explorador unificado de issues: Kanban (padrao) e lista detalhada. */
import { dataService } from '../data/data-service.js';
import { resolveStatusCategory, StatusCategory, isCardOverdue } from '../data/models.js';
import { formatDate, priorityLabel, typeLabel, sanitize, sanitizeTitle, debounce } from '../utils/helpers.js';

const COLUMN_ORDER = [StatusCategory.TODO, StatusCategory.IN_PROGRESS, StatusCategory.BLOCKED, StatusCategory.DONE];
const COLUMN_LABELS = { todo: 'A Fazer', in_progress: 'Em Andamento', blocked: 'Bloqueado', done: 'Concluido' };
const COLUMN_INITIAL_LIMIT = 80;
const PAGE_SIZE = 100;
const columnVisibleLimits = {};
let viewMode = 'kanban';
let visibleCount = PAGE_SIZE;
let currentFilters = defaultFilters();
let filtersExpanded = false;

function defaultFilters() {
  return {
    projectId: '', analystId: '', status: '', priority: '', type: '', dueDate: '', search: '',
    showBlocked: false, showOverdue: false, showNoDate: false, showNoAnalyst: false,
    sortBy: 'updatedAt', sortDir: 'desc'
  };
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function applyIssueViewFilters(cards, filters, lookups = {}) {
  const getProject = lookups.getProject || (() => null);
  const getUser = lookups.getUser || (() => null);
  let result = [...(cards || [])];
  if (filters.projectId) result = result.filter(card => getProject(card.projectId)?.key === filters.projectId);
  if (filters.analystId) result = result.filter(card => card.assigneeId === filters.analystId);
  if (filters.status) result = result.filter(card => card.status === filters.status);
  if (filters.priority) result = result.filter(card => card.priority === filters.priority);
  if (filters.type) result = result.filter(card => card.type === filters.type);
  if (filters.dueDate) result = result.filter(card => card.dueDate && String(card.dueDate).slice(0, 10) <= filters.dueDate);
  if (filters.showBlocked) result = result.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED);
  if (filters.showOverdue) result = result.filter(isCardOverdue);
  if (filters.showNoDate) result = result.filter(card => !card.dueDate);
  if (filters.showNoAnalyst) result = result.filter(card => !card.assigneeId || card.assigneeId === 'unassigned');
  if (filters.search) {
    const query = normalizeText(filters.search);
    result = result.filter(card => normalizeText([
      card.key, card.title, card.description, card.blockReason, card.pendingWith,
      ...(card.labels || []), getProject(card.projectId)?.name, getUser(card.assigneeId)?.displayName
    ].join(' ')).includes(query));
  }
  if (filters.sortBy) {
    const direction = filters.sortDir === 'asc' ? 1 : -1;
    result.sort((left, right) => String(left[filters.sortBy] || '').localeCompare(String(right[filters.sortBy] || ''), 'pt-BR') * direction);
  }
  return result;
}

function filteredCards(overrides = {}) {
  return applyIssueViewFilters(dataService.getCards(), { ...currentFilters, ...overrides }, {
    getProject: id => dataService.getProjectById(id),
    getUser: id => dataService.getUserById(id)
  });
}

function safeJiraUrl(card) {
  const fallback = `https://antliaprojetos.atlassian.net/browse/${encodeURIComponent(card.key)}`;
  try {
    const url = new URL(card.jiraUrl || fallback);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch { return fallback; }
}

function issueLink(card, className = 'issue-link') {
  return `<a class="${className}" href="${sanitizeTitle(safeJiraUrl(card))}" target="_blank" rel="noopener noreferrer">${sanitize(card.key)}</a>`;
}

function parseRouteFilters() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const projectKey = params.get('projectKey');
  const analystId = params.get('analystId');
  const requestedView = params.get('view');
  if (projectKey && dataService.getProjects().some(project => project.key === projectKey)) currentFilters.projectId = projectKey;
  if (analystId) currentFilters.analystId = analystId;
  if (requestedView === 'list' || requestedView === 'kanban') viewMode = requestedView;
}

export function renderBoard(options = {}) {
  viewMode = options.initialMode === 'list' ? 'list' : 'kanban';
  parseRouteFilters();
  renderHeader();
  renderIssueExplorer();
}

function renderHeader() {
  const header = document.getElementById('page-header');
  header.innerHTML = `<div><h2>Issues</h2><div class="subtitle">Kanban e lista operacional usando a mesma fonte e os mesmos filtros</div></div>
    <div class="page-actions issue-view-actions"><div class="issue-view-toggle" role="group" aria-label="Modo de visualizacao">
      <button class="btn btn-secondary ${viewMode === 'kanban' ? 'active' : ''}" data-view="kanban" aria-pressed="${viewMode === 'kanban'}">Kanban</button>
      <button class="btn btn-secondary ${viewMode === 'list' ? 'active' : ''}" data-view="list" aria-pressed="${viewMode === 'list'}">Lista</button>
    </div><button class="btn btn-primary" id="btn-refresh-issues" aria-label="Atualizar issues agora">Atualizar</button></div>`;
  header.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    viewMode = button.dataset.view;
    visibleCount = PAGE_SIZE;
    renderHeader();
    renderIssueExplorer();
  }));
  document.getElementById('btn-refresh-issues')?.addEventListener('click', refreshIssues);
}

async function refreshIssues() {
  const button = document.getElementById('btn-refresh-issues');
  button.disabled = true;
  button.textContent = 'Atualizando...';
  try {
    const started = await dataService.startJiraSyncFromEnv();
    const jobId = started.jobId || started.job?.id;
    if (jobId) {
      const deadline = Date.now() + 4 * 60 * 1000;
      while (Date.now() < deadline) {
        const status = await dataService.getSyncStatus(jobId);
        if (status?.status === 'success') break;
        if (status?.status === 'error') throw new Error(status.error || 'A sincronizacao falhou.');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (Date.now() >= deadline) throw new Error('A sincronizacao continua em andamento. Consulte a tela Dados.');
    }
    const result = await dataService.refreshFromJira();
    if (!result) throw new Error('A atualizacao nao retornou dados.');
    renderIssueExplorer();
  } catch (error) { window.alert(`Erro ao atualizar: ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Atualizar'; }
}

function renderIssueExplorer() {
  const content = document.getElementById('page-content');
  const baseCards = filteredCards({ showBlocked: false, showOverdue: false });
  const cards = filteredCards();
  const blockedCards = baseCards.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED);
  const blockedCount = blockedCards.length;
  const overdueCount = baseCards.filter(isCardOverdue).length;
  const affectedProjects = new Set(blockedCards.map(card => card.projectId)).size;
  content.innerHTML = `<section class="issue-control-panel" aria-label="Filtros e resumo das issues">
      ${filtersTemplate()}
      <div class="issue-summary-strip" aria-label="Resumo dos filtros">
        <button class="issue-summary-item danger ${currentFilters.showBlocked ? 'active' : ''}" id="filter-total-blocked" title="${blockedCount} bloqueados em ${affectedProjects} projeto(s)"><span>Bloqueados</span><strong>${blockedCount}</strong></button>
        <button class="issue-summary-item warning ${currentFilters.showOverdue ? 'active' : ''}" id="filter-total-overdue" title="${overdueCount} issues com prazo vencido"><span>Atrasados</span><strong>${overdueCount}</strong></button>
        <div class="issue-summary-item neutral"><span>Resultado</span><strong>${cards.length}</strong></div>
      </div>
    </section>
    ${viewMode === 'kanban' ? kanbanTemplate(cards) : listTemplate(cards)}`;
  bindFilters();
  document.getElementById('filter-total-blocked')?.addEventListener('click', () => {
    currentFilters.showBlocked = !currentFilters.showBlocked;
    if (currentFilters.showBlocked) currentFilters.showOverdue = false;
    visibleCount = PAGE_SIZE; renderIssueExplorer();
  });
  document.getElementById('filter-total-overdue')?.addEventListener('click', () => {
    currentFilters.showOverdue = !currentFilters.showOverdue;
    if (currentFilters.showOverdue) currentFilters.showBlocked = false;
    visibleCount = PAGE_SIZE; renderIssueExplorer();
  });
  if (viewMode === 'kanban') { initKanbanNavigation(); initDragAndDrop(); bindLoadMoreColumns(); }
  else bindListActions();
}

function filtersTemplate() {
  const projects = dataService.getProjects();
  const users = dataService.getUsers();
  const advancedCount = [currentFilters.priority, currentFilters.type, currentFilters.dueDate]
    .filter(Boolean).length + Number(currentFilters.showNoDate) + Number(currentFilters.showNoAnalyst);
  return `<div class="issue-primary-filters">
    <label class="issue-search"><span class="issue-visually-hidden">Busca</span><input type="search" id="search-issues" aria-label="Buscar issues" placeholder="Buscar chave, título, descrição ou responsável..." value="${sanitize(currentFilters.search)}"></label>
    <label><span class="issue-visually-hidden">Projeto</span><select id="filter-issue-project" aria-label="Filtrar por projeto"><option value="">Todos os projetos</option>${projects.map(project => `<option value="${sanitize(project.key)}" ${currentFilters.projectId === project.key ? 'selected' : ''}>${sanitize(project.name)}</option>`).join('')}</select></label>
    <label><span class="issue-visually-hidden">Analista</span><select id="filter-issue-analyst" aria-label="Filtrar por analista"><option value="">Todos os analistas</option>${users.map(user => `<option value="${sanitize(user.id)}" ${currentFilters.analystId === user.id ? 'selected' : ''}>${sanitize(user.displayName)}</option>`).join('')}</select></label>
    <label><span class="issue-visually-hidden">Status</span><select id="filter-issue-status" aria-label="Filtrar por status"><option value="">Todos os status</option>${dataService.getStatusOptions().map(status => `<option value="${sanitize(status)}" ${currentFilters.status === status ? 'selected' : ''}>${sanitize(status)}</option>`).join('')}</select></label>
    <button class="btn btn-secondary btn-sm issue-more-filters ${filtersExpanded ? 'active' : ''}" id="toggle-issue-filters" aria-expanded="${filtersExpanded}" aria-controls="issue-advanced-filters">Mais filtros${advancedCount ? ` <span>${advancedCount}</span>` : ''}</button>
  </div>
  <div class="issue-advanced-filters ${filtersExpanded ? '' : 'is-collapsed'}" id="issue-advanced-filters">
    <label><span>Prioridade</span><select id="filter-issue-priority"><option value="">Todas</option>${['highest','high','medium','low','lowest'].map(priority => `<option value="${priority}" ${currentFilters.priority === priority ? 'selected' : ''}>${sanitize(priorityLabel(priority))}</option>`).join('')}</select></label>
    <label><span>Tipo</span><select id="filter-issue-type"><option value="">Todos</option>${['epic','story','task','bug','subtask'].map(type => `<option value="${type}" ${currentFilters.type === type ? 'selected' : ''}>${sanitize(typeLabel(type))}</option>`).join('')}</select></label>
    <label><span>Data até</span><input type="date" id="filter-issue-due" value="${sanitize(currentFilters.dueDate)}"></label>
    <label class="issue-check"><input type="checkbox" id="filter-issue-no-date" ${currentFilters.showNoDate ? 'checked' : ''}> Sem data</label>
    <label class="issue-check"><input type="checkbox" id="filter-issue-no-analyst" ${currentFilters.showNoAnalyst ? 'checked' : ''}> Sem analista</label>
    <button class="btn btn-secondary btn-sm" id="clear-issue-filters">Limpar</button>
  </div>`;
}

function bindFilters() {
  [['filter-issue-project','projectId'],['filter-issue-analyst','analystId'],['filter-issue-status','status'],['filter-issue-priority','priority'],['filter-issue-type','type'],['filter-issue-due','dueDate']]
    .forEach(([id, key]) => document.getElementById(id)?.addEventListener('change', event => { currentFilters[key] = event.target.value; visibleCount = PAGE_SIZE; renderIssueExplorer(); }));
  document.getElementById('filter-issue-no-date')?.addEventListener('change', event => { currentFilters.showNoDate = event.target.checked; renderIssueExplorer(); });
  document.getElementById('filter-issue-no-analyst')?.addEventListener('change', event => { currentFilters.showNoAnalyst = event.target.checked; renderIssueExplorer(); });
  document.getElementById('search-issues')?.addEventListener('input', debounce(event => { currentFilters.search = event.target.value; visibleCount = PAGE_SIZE; renderIssueExplorer(); }, 250));
  document.getElementById('toggle-issue-filters')?.addEventListener('click', () => { filtersExpanded = !filtersExpanded; renderIssueExplorer(); });
  document.getElementById('clear-issue-filters')?.addEventListener('click', () => { currentFilters = defaultFilters(); filtersExpanded = false; visibleCount = PAGE_SIZE; Object.keys(columnVisibleLimits).forEach(key => delete columnVisibleLimits[key]); renderIssueExplorer(); });
}

function groupCards(cards) {
  const grouped = Object.fromEntries(COLUMN_ORDER.map(category => [category, []]));
  cards.forEach(card => grouped[resolveStatusCategory(card.status)]?.push(card));
  return COLUMN_ORDER.map(category => ({ category, label: COLUMN_LABELS[category], cards: grouped[category] || [] }));
}

function kanbanTemplate(cards) {
  return `<div class="kanban-wrapper"><button class="kanban-nav-btn kanban-nav-left" id="kanban-scroll-left" aria-label="Rolar para esquerda">‹</button>
    <div class="kanban-container" id="kanban-scroll-container">${groupCards(cards).map(column => {
      const limit = columnVisibleLimits[column.category] || COLUMN_INITIAL_LIMIT;
      return `<section class="kanban-column"><div class="kanban-column-header"><span class="kanban-column-title">${sanitize(column.label)}</span><span class="kanban-column-count">${column.cards.length}</span></div>
        <div class="kanban-column-content" data-status="${column.category}">${column.cards.length ? column.cards.slice(0, limit).map(kanbanCardTemplate).join('') : '<div class="kanban-empty">Nenhum item</div>'}
        ${column.cards.length > limit ? `<button class="btn btn-secondary btn-sm kanban-load-more" data-category="${column.category}">Ver mais ${Math.min(COLUMN_INITIAL_LIMIT, column.cards.length - limit)}</button>` : ''}</div></section>`;
    }).join('')}</div><button class="kanban-nav-btn kanban-nav-right" id="kanban-scroll-right" aria-label="Rolar para direita">›</button></div>`;
}

function kanbanCardTemplate(card) {
  const project = dataService.getProjectById(card.projectId);
  const user = dataService.getUserById(card.assigneeId);
  const overdue = isCardOverdue(card);
  return `<article class="kanban-card ${card.isInconsistent ? 'kanban-card-error' : ''} ${overdue ? 'kanban-card-overdue' : ''}" draggable="true" data-id="${sanitize(card.id)}">
    ${overdue ? '<div class="kanban-card-badge kanban-card-badge-overdue" title="Atrasado">!</div>' : ''}<div class="kanban-card-header">${issueLink(card, 'kanban-card-key')}<span class="kanban-card-priority priority-${sanitize(card.priority)}">${sanitize(priorityLabel(card.priority))}</span></div>
    <div class="kanban-card-title">${sanitize(card.title)}</div>${card.dueDate ? `<div class="kanban-card-due ${overdue ? 'overdue' : ''}">${sanitize(formatDate(card.dueDate))}</div>` : ''}
    <div class="kanban-card-footer"><div class="kanban-card-project">${project?.avatarUrl ? `<img src="${sanitizeTitle(project.avatarUrl)}" class="project-avatar" alt="">` : ''}<span>${sanitize(project?.key || '?')}</span></div>
    <div class="kanban-card-assignee ${user?.id === 'unassigned' ? 'unassigned' : ''}" title="${sanitizeTitle(user?.displayName || 'Nao atribuido')}">${user?.avatarUrl ? `<img src="${sanitizeTitle(user.avatarUrl)}" class="avatar avatar-xs" alt="">` : sanitize((user?.displayName || '?').charAt(0))}</div></div></article>`;
}

function listTemplate(cards) {
  const visible = cards.slice(0, visibleCount);
  return `<div class="table-container issue-list-container"><table class="data-table issue-list-table"><thead><tr><th data-sort="key">Chave</th><th data-sort="title">Issue e descricao</th><th>Projeto</th><th>Responsavel</th><th data-sort="status">Status</th><th data-sort="priority">Prioridade</th><th data-sort="dueDate">Prazo / bloqueio</th><th>Acao</th></tr></thead>
    <tbody>${visible.length ? visible.map(listRowTemplate).join('') : '<tr><td colspan="8" class="empty-state"><h3>Nenhuma issue encontrada</h3><p>Ajuste os filtros e tente novamente.</p></td></tr>'}</tbody></table></div>
    ${cards.length > visible.length ? `<div class="issue-load-more"><button class="btn btn-secondary" id="issues-load-more">Ver mais ${Math.min(PAGE_SIZE, cards.length - visible.length)} de ${cards.length - visible.length}</button></div>` : ''}`;
}

function listRowTemplate(card) {
  const project = dataService.getProjectById(card.projectId);
  const user = dataService.getUserById(card.assigneeId);
  const blocked = resolveStatusCategory(card.status) === StatusCategory.BLOCKED;
  const overdue = isCardOverdue(card);
  const reason = blocked ? card.blockReason : overdue ? 'Prazo vencido' : '';
  const date = blocked ? card.blockedAt : card.dueDate;
  return `<tr><td>${issueLink(card)}</td><td><strong>${sanitize(card.title)}</strong><p class="issue-description">${sanitize(card.description || 'Sem descricao informada no Jira.')}</p>${(card.labels || []).slice(0, 3).map(label => `<span class="issue-tag">#${sanitize(label)}</span>`).join('')}</td>
    <td>${sanitize(project?.name || '—')}</td><td><div class="issue-assignee">${user?.avatarUrl ? `<img src="${sanitizeTitle(user.avatarUrl)}" class="avatar avatar-sm" alt="">` : ''}<span>${sanitize(user?.displayName || 'Nao atribuido')}</span></div></td>
    <td><span class="badge badge-${resolveStatusCategory(card.status)}">${sanitize(card.status)}</span></td><td><span class="badge badge-priority-${sanitize(card.priority)}">${sanitize(priorityLabel(card.priority))}</span></td>
    <td>${date ? `<strong>${sanitize(formatDate(date))}</strong>` : '—'}${reason ? `<p class="issue-block-reason">${sanitize(reason)}</p>` : ''}${blocked && card.pendingWith ? `<small>Pendente com: ${sanitize(card.pendingWith)}</small>` : ''}${blocked && card.actionTaken ? `<small class="issue-block-action">Ação: ${sanitize(card.actionTaken)}</small>` : ''}</td>
    <td><a class="btn btn-secondary btn-sm" href="${sanitizeTitle(safeJiraUrl(card))}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${sanitizeTitle(card.key)} no Jira">Abrir Jira</a></td></tr>`;
}

function bindListActions() {
  document.querySelectorAll('[data-sort]').forEach(header => header.addEventListener('click', () => { const field = header.dataset.sort; currentFilters.sortDir = currentFilters.sortBy === field && currentFilters.sortDir === 'asc' ? 'desc' : 'asc'; currentFilters.sortBy = field; renderIssueExplorer(); }));
  document.getElementById('issues-load-more')?.addEventListener('click', () => { visibleCount += PAGE_SIZE; renderIssueExplorer(); });
}

function bindLoadMoreColumns() {
  document.querySelectorAll('.kanban-load-more').forEach(button => button.addEventListener('click', () => { const category = button.dataset.category; columnVisibleLimits[category] = (columnVisibleLimits[category] || COLUMN_INITIAL_LIMIT) + COLUMN_INITIAL_LIMIT; renderIssueExplorer(); }));
}

function initKanbanNavigation() {
  const container = document.getElementById('kanban-scroll-container');
  const left = document.getElementById('kanban-scroll-left');
  const right = document.getElementById('kanban-scroll-right');
  if (!container) return;
  const update = () => { const max = container.scrollWidth - container.clientWidth; [left, right].forEach(button => { if (button) button.hidden = max <= 10; }); if (left) left.disabled = container.scrollLeft <= 10; if (right) right.disabled = container.scrollLeft >= max - 10; };
  left?.addEventListener('click', () => container.scrollBy({ left: -340, behavior: 'smooth' }));
  right?.addEventListener('click', () => container.scrollBy({ left: 340, behavior: 'smooth' }));
  container.addEventListener('wheel', event => {
    const column = event.target.closest('.kanban-column-content');
    if (column && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      const canScrollDown = event.deltaY > 0 && column.scrollTop + column.clientHeight < column.scrollHeight - 1;
      const canScrollUp = event.deltaY < 0 && column.scrollTop > 0;
      if (canScrollDown || canScrollUp) return;
    }
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && container.scrollWidth > container.clientWidth) { event.preventDefault(); container.scrollLeft += event.deltaY; }
  }, { passive: false });
  container.addEventListener('scroll', update, { passive: true }); requestAnimationFrame(update);
}

function initDragAndDrop() {
  document.querySelectorAll('.kanban-card').forEach(card => { card.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', card.dataset.id); card.classList.add('dragging'); }); card.addEventListener('dragend', () => card.classList.remove('dragging')); });
  document.querySelectorAll('.kanban-column-content').forEach(column => { column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('drag-over'); }); column.addEventListener('dragleave', () => column.classList.remove('drag-over')); column.addEventListener('drop', event => { event.preventDefault(); column.classList.remove('drag-over'); }); });
}
