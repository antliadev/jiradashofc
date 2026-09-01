/**
 * cards.js - Pagina de listagem de issues e monitoramento operacional.
 */
import { dataService } from '../data/data-service.js';
import {
  formatDate,
  priorityLabel,
  typeLabel,
  debounce,
  sanitize,
  sanitizeTitle,
  sanitizeUrl,
  getJiraIssueUrl,
} from '../utils/helpers.js';
import { exportRowsWorkbook } from '../utils/excel-export.js';
import { isCardOverdue, resolveStatusCategory, StatusCategory } from '../data/models.js';
import { businessHelp } from '../utils/ui-feedback.js';

const PAGE_SIZE = 100;
const CRITICAL_OVERDUE_DAYS = 7;
const NOT_INFORMED = 'Nao informado';

let visibleCount = PAGE_SIZE;
let currentMonitoringMode = '';
let monitoringProjectChart = null;

let currentFilters = {
  projectId: '',
  assigneeId: '',
  status: '',
  priority: '',
  search: '',
  statusCategory: '',
  overdue: false,
  sortBy: 'key',
  sortDir: 'asc',
};

let monitoringFilters = {
  projectIds: [],
  assigneeIds: [],
  statuses: [],
  pendingWith: [],
  search: '',
  view: 'list',
  sortBy: '',
  sortDir: 'desc',
  showChart: true,
};
let openMonitoringFilter = '';
let monitoringOutsideCloseBound = false;

const MONITORING_MODES = {
  overdue: {
    title: 'Cards com Data em Atraso',
    subtitle: 'Cards com Data limite vencida, indicadores e exportacao',
    emptyTitle: 'Nenhum card em atraso foi encontrado',
    defaultSortBy: 'businessDaysOverdue',
    defaultSortDir: 'desc',
  },
  blocked: {
    title: 'Cards Bloqueados',
    subtitle: 'Cards com status Bloqueado, campos de bloqueio e grafico por projeto',
    emptyTitle: 'Nenhum card bloqueado foi encontrado',
    defaultSortBy: 'projectName',
    defaultSortDir: 'asc',
  },
};

function applyMonitoringMode(mode = '') {
  if (currentMonitoringMode === mode) return;
  currentMonitoringMode = mode;
  visibleCount = PAGE_SIZE;

  if (monitoringProjectChart) {
    monitoringProjectChart.destroy();
    monitoringProjectChart = null;
  }

  if (mode) {
    monitoringFilters = {
      projectIds: [],
      assigneeIds: [],
      statuses: [],
      pendingWith: [],
      search: '',
      view: 'list',
      sortBy: MONITORING_MODES[mode].defaultSortBy,
      sortDir: MONITORING_MODES[mode].defaultSortDir,
      showChart: true,
    };
    return;
  }

  currentFilters = {
    ...currentFilters,
    status: '',
    statusCategory: '',
    overdue: false,
  };
}

function projectKeysFromIds(projectIds = []) {
  return [...new Set((projectIds || [])
    .map(id => dataService.getProjectById(id)?.key || id)
    .filter(Boolean))];
}

function generalSyncScope() {
  return {
    projectKeys: currentFilters.projectId ? projectKeysFromIds([currentFilters.projectId]) : [],
    statuses: currentFilters.status ? [currentFilters.status] : [],
    priorities: currentFilters.priority ? [currentFilters.priority] : [],
    search: currentFilters.search || '',
    overdue: Boolean(currentFilters.overdue)
  };
}

function monitoringSyncScope() {
  const issueKeys = uniqueSorted(getMonitoringRows(currentMonitoringMode)
    .map(row => row.key)
    .filter(Boolean));

  return {
    projectKeys: projectKeysFromIds(monitoringFilters.projectIds),
    assigneeIds: monitoringFilters.assigneeIds || [],
    statuses: monitoringFilters.statuses || [],
    search: monitoringFilters.search || '',
    overdue: currentMonitoringMode === 'overdue',
    blocked: currentMonitoringMode === 'blocked',
    issueKeys
  };
}

export function renderCards(params = {}) {
  applyMonitoringMode(params.monitoring || '');

  const header = document.getElementById('page-header');
  const modeConfig = MONITORING_MODES[currentMonitoringMode];
  header.innerHTML = `
    <div>
      <h2>${modeConfig ? modeConfig.title : 'Cards / Issues'}</h2>
      <div class="subtitle">${modeConfig ? modeConfig.subtitle : 'Visao operacional de todas as tarefas'}</div>
    </div>
    ${modeConfig ? `
      <div class="page-actions">
        <button class="btn btn-secondary" id="monitoring-refresh">Atualizar</button>
        <button class="btn btn-primary" id="monitoring-export" disabled>Exportar Excel</button>
      </div>
    ` : ''}
  `;

  if (currentMonitoringMode) {
    renderMonitoringContent();
    return;
  }

  renderCardsContent();
}

function renderCardsContent() {
  const content = document.getElementById('page-content');
  const projects = dataService.getProjects();
  const statusOptions = dataService.getStatusOptions(currentFilters.projectId);
  if (currentFilters.status && !statusOptions.includes(currentFilters.status)) currentFilters.status = '';
  const cards = dataService.getCards(currentFilters);
  const visibleCards = cards.slice(0, visibleCount);

  content.innerHTML = `
    <div class="filter-bar">
      <label>
        <span class="filter-label">Projeto</span>
        <select id="filter-project">
          <option value="">Todos os Projetos</option>
          ${projects.map(p => `<option value="${sanitize(p.id)}" ${currentFilters.projectId === p.id ? 'selected' : ''}>${sanitize(p.name)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span class="filter-label">Status</span>
        <select id="filter-status">
          <option value="">Todos os Status</option>
          ${statusOptions.map(s => `<option value="${sanitize(s)}" ${currentFilters.status === s ? 'selected' : ''}>${sanitize(s)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span class="filter-label">Prioridade</span>
        <select id="filter-priority">
          <option value="">Todas</option>
          <option value="highest" ${currentFilters.priority === 'highest' ? 'selected' : ''}>Critica</option>
          <option value="high" ${currentFilters.priority === 'high' ? 'selected' : ''}>Alta</option>
          <option value="medium" ${currentFilters.priority === 'medium' ? 'selected' : ''}>Media</option>
          <option value="low" ${currentFilters.priority === 'low' ? 'selected' : ''}>Baixa</option>
        </select>
      </label>
      <label class="filter-search">
        <span class="filter-label">Busca</span>
        <input type="search" id="search-cards" placeholder="Buscar por chave, titulo ou tag..." value="${sanitizeTitle(currentFilters.search)}">
      </label>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th><button class="table-sort" data-sort="key">Chave</button></th>
            <th><button class="table-sort" data-sort="title">Titulo</button></th>
            <th>Projeto</th>
            <th>Responsavel</th>
            <th><button class="table-sort" data-sort="status">Status</button></th>
            <th><button class="table-sort" data-sort="priority">Prioridade</button></th>
            <th>Prazo</th>
          </tr>
        </thead>
        <tbody>
          ${cards.length === 0 ? renderEmptyRow(7, 'Nenhum card encontrado', 'Tente ajustar os filtros ou o termo de busca.') : visibleCards.map(renderGeneralCardRow).join('')}
        </tbody>
      </table>
    </div>
    ${cards.length > visibleCards.length ? `
      <div class="load-more-row">
        <button class="btn btn-secondary" id="cards-load-more">
          Ver mais ${Math.min(PAGE_SIZE, cards.length - visibleCards.length)} de ${cards.length - visibleCards.length}
        </button>
      </div>
    ` : ''}
  `;

  document.getElementById('filter-project').addEventListener('change', (e) => {
    currentFilters.projectId = e.target.value;
    visibleCount = PAGE_SIZE;
    renderCardsContent();
  });
  document.getElementById('filter-status').addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    currentFilters.statusCategory = '';
    visibleCount = PAGE_SIZE;
    renderCardsContent();
  });
  document.getElementById('filter-priority').addEventListener('change', (e) => {
    currentFilters.priority = e.target.value;
    visibleCount = PAGE_SIZE;
    renderCardsContent();
  });
  document.getElementById('search-cards').addEventListener('input', debounce((e) => {
    currentFilters.search = e.target.value;
    visibleCount = PAGE_SIZE;
    renderCardsContent();
  }, 300));
  document.getElementById('cards-load-more')?.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderCardsContent();
  });
  document.querySelectorAll('.table-sort').forEach(button => {
    button.addEventListener('click', () => sortGeneralCards(button.dataset.sort));
  });
}

function renderMonitoringContent() {
  const content = document.getElementById('page-content');
  const mode = currentMonitoringMode;
  const baseRows = getBaseMonitoringRows(mode);
  const filterOptions = getMonitoringFilterOptions(baseRows, mode);
  monitoringFilters.projectIds = monitoringFilters.projectIds.filter(projectId => filterOptions.projects.some(option => option.value === projectId));
  monitoringFilters.assigneeIds = monitoringFilters.assigneeIds.filter(assigneeId => filterOptions.assignees.some(option => option.value === assigneeId));
  monitoringFilters.statuses = monitoringFilters.statuses.filter(status => filterOptions.statuses.some(option => option.value === status));
  monitoringFilters.pendingWith = monitoringFilters.pendingWith.filter(value => filterOptions.pendingWith.some(option => option.value === value));
  const rows = getMonitoringRows(mode);
  const visibleRows = rows.slice(0, visibleCount);
  const metrics = getMonitoringMetrics(rows, mode);

  content.innerHTML = `
    <section class="monitoring-shell" data-monitoring-mode="${sanitize(mode)}">
      ${renderMonitoringKpis(metrics, mode)}
      ${renderMonitoringFilters({ filterOptions, rows })}
      ${renderMonitoringProjectChart(rows, mode)}
      ${renderMonitoringToolbar(rows)}
      ${monitoringFilters.view === 'cards'
        ? renderMonitoringCardsView(visibleRows, mode)
        : renderMonitoringTable(visibleRows, rows.length, mode)}
      ${rows.length > visibleRows.length ? `
        <div class="load-more-row">
          <button class="btn btn-secondary" id="monitoring-load-more">
            Ver mais ${Math.min(PAGE_SIZE, rows.length - visibleRows.length)} de ${rows.length - visibleRows.length}
          </button>
        </div>
      ` : ''}
    </section>
  `;

  bindMonitoringEvents(rows);
  drawMonitoringProjectChart(rows, mode);
  updateExportButton(rows.length > 0);
}

function renderGeneralCardRow(c) {
  const project = dataService.getProjectById(c.projectId);
  const user = dataService.getUserById(c.assigneeId);
  const statusCat = resolveStatusCategory(c.status);
  return `
    <tr>
      <td>${renderIssueLink(c)}</td>
      <td>
        <div class="cell-title" title="${sanitizeTitle(c.title)}">${sanitize(c.title)}</div>
        <div class="cell-tags">
          <span class="badge badge-type">${typeLabel(c.type)}</span>
          ${(c.labels || []).slice(0, 2).map(l => `<span class="cell-tag">#${sanitize(l)}</span>`).join('')}
        </div>
      </td>
      <td><strong>${sanitize(project ? project.name : '-')}</strong></td>
      <td>${renderUser(user)}</td>
      <td><span class="badge badge-${statusCat}">${sanitize(c.status)}</span></td>
      <td><span class="badge badge-priority-${sanitize(c.priority)}">${priorityLabel(c.priority)}</span></td>
      <td>
        <span class="${isCardOverdue(c) ? 'badge badge-overdue' : ''}">${formatDate(c.dueDate)}</span>
      </td>
    </tr>
  `;
}

function renderMonitoringKpis(metrics, mode) {
  if (mode === 'blocked') {
    return `
      <div class="kpi-grid monitoring-kpis">
        ${kpiCard(metrics.total, 'Total de Bloqueados', 'Cards com status Bloqueado', 'danger')}
        ${kpiCard(metrics.projects, 'Projetos Bloqueados', 'Projetos com bloqueio ativo', 'warning')}
        ${kpiCard(metrics.assignees, 'Responsaveis Impactados', 'Responsaveis envolvidos', 'info')}
      </div>
    `;
  }

  return `
    <div class="kpi-grid monitoring-kpis">
      ${kpiCard(metrics.total, 'Total de Atrasos', 'Cards vencidos nos filtros', 'danger')}
      ${kpiCard(metrics.critical, 'Atraso Critico', `Mais de ${CRITICAL_OVERDUE_DAYS} dias uteis`, 'warning')}
      ${kpiCard(metrics.projects, 'Projetos Impactados', 'Projetos com atraso', 'info')}
      ${kpiCard(metrics.assignees, 'Responsaveis Envolvidos', 'Responsaveis com atraso', 'success')}
    </div>
  `;
}

function renderMonitoringFilters({ filterOptions, rows }) {
  const isBlocked = currentMonitoringMode === 'blocked';
  return `
    <div class="monitoring-panel">
      <div class="monitoring-filter-grid">
        <label class="filter-search">
          <span class="filter-label">Pesquisa</span>
          <input type="search" id="monitoring-search" placeholder="${isBlocked ? 'Chave, nome, motivo, acao, responsavel...' : 'Chave ou nome do card...'}" value="${sanitizeTitle(monitoringFilters.search)}">
        </label>
        ${renderCompactMultiFilter('Projeto', 'projectIds', filterOptions.projects)}
        ${renderCompactMultiFilter('Responsavel', 'assigneeIds', filterOptions.assignees)}
        ${renderCompactMultiFilter('Status', 'statuses', filterOptions.statuses)}
        ${isBlocked ? `
          ${renderCompactMultiFilter('Pendente com?', 'pendingWith', filterOptions.pendingWith)}
        ` : ''}
        <label>
          <span class="filter-label">Ordenacao</span>
          <select id="monitoring-sort">
            ${getSortOptions(currentMonitoringMode).map(option => `<option value="${sanitize(option.value)}" ${monitoringFilters.sortBy === option.value ? 'selected' : ''}>${sanitize(option.label)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span class="filter-label">Direcao</span>
          <select id="monitoring-sort-dir">
            <option value="asc" ${monitoringFilters.sortDir === 'asc' ? 'selected' : ''}>Crescente</option>
            <option value="desc" ${monitoringFilters.sortDir === 'desc' ? 'selected' : ''}>Decrescente</option>
          </select>
        </label>
      </div>
      <div class="monitoring-filter-actions">
        <span>${rows.length} resultado(s) nos filtros atuais</span>
        <button class="btn btn-secondary btn-sm" id="monitoring-clear">Limpar filtros</button>
      </div>
    </div>
  `;
}

function renderCompactMultiFilter(label, filterKey, options) {
  const selected = monitoringFilters[filterKey] || [];
  const allSelected = options.length > 0 && selected.length === options.length;
  const summary = selected.length === 0
    ? 'Todos'
    : selected.length === 1
      ? options.find(option => option.value === selected[0])?.label || '1 selecionado'
      : `${selected.length} selecionados`;
  return `
    <div class="compact-multi-filter">
      <span class="filter-label">${sanitize(label)}</span>
      <details data-filter-key="${sanitize(filterKey)}" ${openMonitoringFilter === filterKey ? 'open' : ''}>
        <summary>
          <span>${sanitize(summary)}</span>
          <small>${selected.length || 'Todos'}</small>
        </summary>
        <div class="compact-multi-menu">
          <label class="compact-multi-all">
            <input type="checkbox" data-monitoring-filter-all="${sanitize(filterKey)}" ${allSelected ? 'checked' : ''} ${options.length ? '' : 'disabled'}>
            <span>Todos</span>
          </label>
          ${options.map(option => `
            <label>
              <input type="checkbox" data-monitoring-filter="${sanitize(filterKey)}" value="${sanitize(option.value)}" ${selected.includes(option.value) ? 'checked' : ''}>
              <span>${sanitize(option.label)}</span>
            </label>
          `).join('')}
        </div>
      </details>
    </div>
  `;
}

function renderMonitoringToolbar(rows) {
  return `
    <div class="monitoring-toolbar">
      <div class="view-toggle" role="group" aria-label="Forma de visualizacao">
        <button class="tab-btn ${monitoringFilters.view === 'list' ? 'active' : ''}" data-view="list">Lista</button>
        <button class="tab-btn ${monitoringFilters.view === 'cards' ? 'active' : ''}" data-view="cards">Cards</button>
      </div>
      <div class="monitoring-toolbar-meta" id="monitoring-refresh-status">${rows.length ? 'Dados recalculados conforme filtros aplicados' : 'Sem resultados para os filtros atuais'}</div>
    </div>
  `;
}

function renderMonitoringTable(rows, total, mode) {
  const isBlocked = mode === 'blocked';
  const colSpan = isBlocked ? 8 : 7;
  return `
    <div class="table-container monitoring-table">
      <table class="data-table">
        <thead>
          <tr>
            <th><button class="table-sort" data-sort="title">Nome do card</button></th>
            <th><button class="table-sort" data-sort="projectName">Projeto</button></th>
            <th><button class="table-sort" data-sort="epicLabel">Epico</button></th>
            <th><button class="table-sort" data-sort="assigneeName">Responsavel</button></th>
            ${isBlocked ? `
              <th><button class="table-sort" data-sort="blockReason">Motivo do bloqueio</button></th>
              <th><button class="table-sort" data-sort="actionTaken">Acao Tomada</button></th>
              <th><button class="table-sort" data-sort="pendingWith">Pendente com?</button></th>
            ` : `
              <th><button class="table-sort" data-sort="dueDate">Data limite</button></th>
              <th><button class="table-sort" data-sort="businessDaysOverdue">Dias uteis em atraso</button></th>
            `}
            <th><button class="table-sort" data-sort="status">Status</button></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? renderEmptyRow(colSpan, MONITORING_MODES[mode].emptyTitle, 'A lista permanece vazia e a exportacao fica desabilitada.') : rows.map(row => renderMonitoringRow(row, mode)).join('')}
        </tbody>
      </table>
    </div>
    ${total > rows.length ? `<div class="monitoring-count-note">Mostrando ${rows.length} de ${total} registros.</div>` : ''}
  `;
}

function renderMonitoringRow(row, mode) {
  if (mode === 'blocked') {
    return `
      <tr class="${row.hasMissingBlockInfo ? 'row-warning' : ''}">
        <td>${renderIssueLink(row.card)}<div class="cell-title muted">${sanitize(row.title)}</div></td>
        <td>${sanitize(row.projectName)}</td>
        <td>${sanitize(row.epicLabel)}</td>
        <td>${sanitize(row.assigneeName)}</td>
        <td>${renderLongField(row.blockReason, row.missingBlockReason)}</td>
        <td>${renderLongField(row.actionTaken, row.missingActionTaken)}</td>
        <td>${renderLongField(row.pendingWith, row.missingPendingWith)}</td>
        <td><span class="badge badge-blocked">${sanitize(row.status)}</span></td>
      </tr>
    `;
  }

  return `
    <tr class="${row.isCritical ? 'row-critical' : ''}">
      <td>${renderIssueLink(row.card)}<div class="cell-title muted">${sanitize(row.title)}</div></td>
      <td>${sanitize(row.projectName)}</td>
      <td>${sanitize(row.epicLabel)}</td>
      <td>${sanitize(row.assigneeName)}</td>
      <td>${formatDate(row.dueDate)}</td>
      <td><span class="badge ${row.isCritical ? 'badge-overdue' : 'badge-warning'}">${row.businessDaysOverdue}</span></td>
      <td><span class="badge badge-${sanitize(row.statusCategory)}">${sanitize(row.status)}</span></td>
    </tr>
  `;
}

function renderMonitoringCardsView(rows, mode) {
  if (!rows.length) {
    return `
      <div class="empty-state monitoring-empty">
        <h3>${sanitize(MONITORING_MODES[mode].emptyTitle)}</h3>
        <p>Ajuste os filtros ou atualize os dados para consultar novamente.</p>
      </div>
    `;
  }

  return `
    <div class="monitoring-card-grid">
      ${rows.map(row => mode === 'blocked' ? renderBlockedCard(row) : renderOverdueCard(row)).join('')}
    </div>
  `;
}

function renderOverdueCard(row) {
  return `
    <article class="monitoring-card ${row.isCritical ? 'critical' : ''}">
      <div class="monitoring-card-head">
        <div>${renderIssueLink(row.card)}<h3>${sanitize(row.title)}</h3></div>
        <span class="badge ${row.isCritical ? 'badge-overdue' : 'badge-warning'}">${row.businessDaysOverdue} dias uteis</span>
      </div>
      <dl>
        <div><dt>Projeto</dt><dd>${sanitize(row.projectName)}</dd></div>
        <div><dt>Epico</dt><dd>${sanitize(row.epicLabel)}</dd></div>
        <div><dt>Responsavel</dt><dd>${sanitize(row.assigneeName)}</dd></div>
        <div><dt>Status</dt><dd><span class="badge badge-${sanitize(row.statusCategory)}">${sanitize(row.status)}</span></dd></div>
        <div><dt>Data limite</dt><dd>${formatDate(row.dueDate)}</dd></div>
      </dl>
    </article>
  `;
}

function renderBlockedCard(row) {
  return `
    <article class="monitoring-card ${row.hasMissingBlockInfo ? 'warning' : ''}">
      <div class="monitoring-card-head">
        <div>${renderIssueLink(row.card)}<h3>${sanitize(row.title)}</h3></div>
        ${row.hasMissingBlockInfo ? '<span class="badge badge-warning">Pendente preenchimento</span>' : '<span class="badge badge-blocked">Bloqueado</span>'}
      </div>
      <dl>
        <div><dt>Projeto</dt><dd>${sanitize(row.projectName)}</dd></div>
        <div><dt>Epico</dt><dd>${sanitize(row.epicLabel)}</dd></div>
        <div><dt>Responsavel</dt><dd>${sanitize(row.assigneeName)}</dd></div>
        <div><dt>Motivo do bloqueio</dt><dd>${renderBlockInfo(row.blockReason, row.missingBlockReason)}</dd></div>
        <div><dt>Acao Tomada</dt><dd>${renderBlockInfo(row.actionTaken, row.missingActionTaken)}</dd></div>
        <div><dt>Pendente com?</dt><dd>${renderBlockInfo(row.pendingWith, row.missingPendingWith)}</dd></div>
      </dl>
    </article>
  `;
}

function renderMonitoringProjectChart(rows, mode) {
  if (!monitoringFilters.showChart) return '';
  const isBlocked = mode === 'blocked';
  return `
    <div class="monitoring-panel monitoring-project-chart-panel">
      <div class="monitoring-panel-header">
        <div>
          <h3>${isBlocked ? 'Bloqueios por Projeto' : 'Atrasos por Projeto'}</h3>
          <p>Selecione uma barra para filtrar a tela pelo projeto.</p>
        </div>
      </div>
      ${rows.length ? '<canvas id="monitoring-project-chart" height="96"></canvas>' : '<div class="monitoring-chart-empty">Sem dados para o grafico.</div>'}
    </div>
  `;
}

function bindMonitoringEvents(rows) {
  document.getElementById('monitoring-refresh')?.addEventListener('click', refreshMonitoringFromJira);
  document.getElementById('monitoring-export')?.addEventListener('click', () => exportMonitoringRows(rows));
  document.getElementById('monitoring-clear')?.addEventListener('click', () => {
    resetMonitoringFilters();
    renderMonitoringContent();
  });
  document.getElementById('monitoring-load-more')?.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderMonitoringContent();
  });
  document.getElementById('monitoring-search')?.addEventListener('input', debounce((e) => {
    monitoringFilters.search = e.target.value;
    visibleCount = PAGE_SIZE;
    renderMonitoringContent();
  }, 250));
  document.querySelectorAll('[data-monitoring-filter]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.monitoringFilter;
      openMonitoringFilter = key;
      monitoringFilters[key] = [...document.querySelectorAll(`[data-monitoring-filter="${key}"]:checked`)]
        .map(item => item.value);
      visibleCount = PAGE_SIZE;
      renderMonitoringContent();
    });
  });
  document.querySelectorAll('[data-monitoring-filter-all]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.monitoringFilterAll;
      openMonitoringFilter = key;
      monitoringFilters[key] = input.checked
        ? [...document.querySelectorAll(`[data-monitoring-filter="${key}"]`)].map(item => item.value)
        : [];
      visibleCount = PAGE_SIZE;
      renderMonitoringContent();
    });
  });
  document.querySelectorAll('.compact-multi-filter details').forEach(details => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        openMonitoringFilter = details.dataset.filterKey || '';
        document.querySelectorAll('.compact-multi-filter details').forEach(other => {
          if (other !== details) other.open = false;
        });
      } else if (openMonitoringFilter === details.dataset.filterKey) {
        openMonitoringFilter = '';
      }
    });
  });
  bindMonitoringOutsideClose();
  document.getElementById('monitoring-sort')?.addEventListener('change', (e) => {
    monitoringFilters.sortBy = e.target.value;
    renderMonitoringContent();
  });
  document.getElementById('monitoring-sort-dir')?.addEventListener('change', (e) => {
    monitoringFilters.sortDir = e.target.value;
    renderMonitoringContent();
  });
  document.querySelectorAll('.view-toggle .tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      monitoringFilters.view = button.dataset.view;
      renderMonitoringContent();
    });
  });
  document.querySelectorAll('.monitoring-table .table-sort').forEach(button => {
    button.addEventListener('click', () => {
      sortMonitoringRows(button.dataset.sort);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSyncJob(jobId) {
  if (!jobId) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await dataService.getSyncStatus(jobId);
    const current = status?.status || status?.lastSyncStatus;
    if (['success', 'completed'].includes(current)) return status;
    if (['error', 'failed'].includes(current)) {
      throw new Error(status.error || status.lastSyncError || 'Sincronizacao do Jira falhou.');
    }
    await sleep(4000);
  }
  throw new Error('Sincronizacao iniciada, mas nao terminou dentro da janela de acompanhamento.');
}

async function refreshMonitoringFromJira() {
  const button = document.getElementById('monitoring-refresh');
  const status = document.getElementById('monitoring-refresh-status');
  if (!button) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Atualizando...';
  if (status) status.textContent = 'Sincronizando dados recentes do Jira...';

  try {
    const sync = await dataService.startScopedJiraSync(currentMonitoringMode ? monitoringSyncScope() : generalSyncScope());
    const jobId = sync.jobId || sync.job?.id || sync.id;
    if (status) status.textContent = sync.alreadyRunning ? 'Sincronizacao em andamento. Aguardando conclusao...' : 'Sincronizacao iniciada. Aguardando conclusao...';
    await waitForSyncJob(jobId);
    await dataService.ensureLoaded({ force: true });
    renderMonitoringContent();
  } catch (error) {
    console.error('[Monitoring] Falha ao atualizar dados do Jira:', error);
    if (status) status.textContent = error.message || 'Nao foi possivel atualizar os dados do Jira.';
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function bindMonitoringOutsideClose() {
  if (monitoringOutsideCloseBound) return;
  monitoringOutsideCloseBound = true;
  document.addEventListener('click', event => {
    if (event.target.closest('.compact-multi-filter')) return;
    openMonitoringFilter = '';
    document.querySelectorAll('.compact-multi-filter details[open]').forEach(details => {
      details.open = false;
    });
  });
}

function getMonitoringRows(mode) {
  return applyMonitoringFilters(getBaseMonitoringRows(mode), mode);
}

function getBaseMonitoringRows(mode) {
  const cards = dataService.getCards();
  return cards
    .filter(card => mode === 'blocked'
      ? resolveStatusCategory(card.status) === StatusCategory.BLOCKED
      : isCardOverdue(card))
    .map(card => buildMonitoringRow(card));
}

export function getMonitoringFilterOptions(rows, _mode) {
  const projects = countRowsBy(rows, 'projectId')
    .map(item => ({
      value: item.value,
      label: `${item.label} (${item.total})`,
    }));
  const assignees = countRowsBy(rows, 'assigneeId')
    .map(item => ({
      value: item.value,
      label: `${item.label} (${item.total})`,
    }));
  const statuses = countRowsBy(rows, 'status')
    .map(item => ({
      value: item.value,
      label: `${item.label} (${item.total})`,
    }));
  const pendingWith = countRowsBy(rows.filter(row => row.pendingWith), 'pendingWith')
    .map(item => ({ value: item.value, label: item.label }));

  return { projects, assignees, statuses, pendingWith };
}

function buildMonitoringRow(card) {
  const project = dataService.getProjectById(card.projectId);
  const user = dataService.getUserById(card.assigneeId);
  const blockReason = getBlockField(card, ['blockReason', 'block_reason', 'blockedReason', 'blocked_reason'], ['motivo do bloqueio', 'motivo bloqueio', 'block reason', 'blocked reason', 'reason blocked', 'impediment reason']);
  const actionTaken = getBlockField(card, ['actionTaken', 'action_taken', 'takenAction', 'taken_action'], ['acao tomada', 'ação tomada', 'action taken', 'taken action', 'resolution action']);
  const pendingWith = getBlockField(card, ['pendingWith', 'pending_with', 'pendingOwner', 'pending_owner'], ['pendente com', 'pendente com?', 'pending with', 'pending', 'blocked by']);
  const businessDaysOverdue = calculateBusinessDaysOverdue(card.dueDate);

  return {
    card,
    key: card.key,
    title: card.title || '',
    projectId: card.projectId,
    projectName: project?.name || card.projectId || '-',
    assigneeId: card.assigneeId,
    assigneeName: user?.displayName || 'Nao atribuido',
    status: card.status || '',
    statusCategory: resolveStatusCategory(card.status || ''),
    dueDate: card.dueDate || null,
    businessDaysOverdue,
    isCritical: businessDaysOverdue > CRITICAL_OVERDUE_DAYS,
    epicLabel: getEpicLabel(card),
    blockReason,
    actionTaken,
    pendingWith,
    missingBlockReason: blockReason === NOT_INFORMED,
    missingActionTaken: actionTaken === NOT_INFORMED,
    missingPendingWith: pendingWith === NOT_INFORMED,
    hasMissingBlockInfo: [blockReason, actionTaken, pendingWith].some(value => value === NOT_INFORMED),
  };
}

function applyMonitoringFilters(rows, mode) {
  let result = [...rows];
  const q = monitoringFilters.search.trim().toLowerCase();

  if (monitoringFilters.projectIds.length) {
    result = result.filter(row => monitoringFilters.projectIds.includes(row.projectId));
  }
  if (monitoringFilters.assigneeIds.length) {
    result = result.filter(row => monitoringFilters.assigneeIds.includes(row.assigneeId));
  }
  if (monitoringFilters.statuses.length) {
    result = result.filter(row => monitoringFilters.statuses.includes(row.status));
  }
  if (mode === 'blocked' && monitoringFilters.pendingWith.length) {
    result = result.filter(row => monitoringFilters.pendingWith.includes(row.pendingWith));
  }
  if (q) {
    result = result.filter(row => {
      const values = mode === 'blocked'
        ? [row.key, row.title, row.blockReason, row.actionTaken, row.assigneeName, row.pendingWith]
        : [row.key, row.title];
      return values.some(value => String(value || '').toLowerCase().includes(q));
    });
  }

  sortRows(result, monitoringFilters.sortBy, monitoringFilters.sortDir);
  return result;
}

function getMonitoringMetrics(rows, mode) {
  const projects = new Set(rows.map(row => row.projectId).filter(Boolean));
  const assignees = new Set(rows.map(row => row.assigneeId).filter(Boolean));
  const metrics = {
    total: rows.length,
    projects: projects.size,
    assignees: assignees.size,
  };
  if (mode === 'overdue') {
    metrics.critical = rows.filter(row => row.isCritical).length;
  }
  return metrics;
}

function sortRows(rows, sortBy, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    if (typeof av === 'number' || typeof bv === 'number') return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir;
  });
}

function sortMonitoringRows(field) {
  if (monitoringFilters.sortBy === field) {
    monitoringFilters.sortDir = monitoringFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    monitoringFilters.sortBy = field;
    monitoringFilters.sortDir = field === 'businessDaysOverdue' ? 'desc' : 'asc';
  }
  renderMonitoringContent();
}

function sortGeneralCards(field) {
  if (currentFilters.sortBy === field) {
    currentFilters.sortDir = currentFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentFilters.sortBy = field;
    currentFilters.sortDir = 'asc';
  }
  visibleCount = PAGE_SIZE;
  renderCardsContent();
}

function resetMonitoringFilters() {
  monitoringFilters = {
    projectIds: [],
    assigneeIds: [],
    statuses: [],
    pendingWith: [],
    search: '',
    view: monitoringFilters.view,
    sortBy: MONITORING_MODES[currentMonitoringMode].defaultSortBy,
    sortDir: MONITORING_MODES[currentMonitoringMode].defaultSortDir,
    showChart: true,
  };
  visibleCount = PAGE_SIZE;
}

async function drawMonitoringProjectChart(rows, mode) {
  const canvas = document.getElementById('monitoring-project-chart');
  if (!canvas) return;

  const grouped = groupRowsByProject(rows);
  const Chart = await loadChart();
  if (monitoringProjectChart) monitoringProjectChart.destroy();

  monitoringProjectChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: grouped.map(item => item.projectName),
      datasets: [{
        label: mode === 'blocked' ? 'Cards bloqueados' : 'Cards em atraso',
        data: grouped.map(item => item.total),
        backgroundColor: mode === 'blocked' ? '#ef4444' : '#f59e0b',
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (_event, elements) => {
        if (!elements.length) return;
        const item = grouped[elements[0].index];
        monitoringFilters.projectIds = [item.projectId];
        visibleCount = PAGE_SIZE;
        renderMonitoringContent();
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

async function loadChart() {
  const module = await import('chart.js/auto');
  return module.default;
}

async function exportMonitoringRows(rows) {
  if (!rows.length) return;
  const data = rows.map(row => currentMonitoringMode === 'blocked' ? {
    'Nome do card': `${row.key} - ${row.title}`,
    Projeto: row.projectName,
    Epico: row.epicLabel,
    Responsavel: row.assigneeName,
    'Motivo do bloqueio': row.blockReason,
    'Acao Tomada': row.actionTaken,
    'Pendente com?': row.pendingWith,
  } : {
    'Nome do card': `${row.key} - ${row.title}`,
    Projeto: row.projectName,
    Epico: row.epicLabel,
    Responsavel: row.assigneeName,
    'Data limite': formatDate(row.dueDate),
    'Dias uteis em atraso': row.businessDaysOverdue,
    Status: row.status,
  });

  await exportRowsWorkbook([
    { name: currentMonitoringMode === 'blocked' ? 'Bloqueados' : 'Atrasados', rows: data }
  ], `${currentMonitoringMode === 'blocked' ? 'cards_bloqueados' : 'cards_em_atraso'}_${timestampForFile()}.xlsx`);
}

function updateExportButton(enabled) {
  const button = document.getElementById('monitoring-export');
  if (!button) return;
  button.disabled = !enabled;
}

function calculateBusinessDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = startOfDay(new Date(dueDate));
  const today = startOfDay(new Date());
  if (isNaN(due.getTime()) || due >= today) return 0;

  let total = 0;
  const cursor = new Date(due);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= today) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) total++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getBlockField(card, directKeys, labels) {
  for (const key of directKeys) {
    if (hasText(card[key])) return cleanFieldValue(card[key]);
  }

  const raw = card.rawFields || {};
  const rawValue = findFieldValue(raw, labels);
  return hasText(rawValue) ? cleanFieldValue(rawValue) : NOT_INFORMED;
}

function findFieldValue(source, labels) {
  if (!source || typeof source !== 'object') return null;
  const normalizedLabels = labels.map(normalizeKey);

  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = normalizeKey(key);
    if (normalizedLabels.some(label => normalizedKey === label || normalizedKey.includes(label))) {
      return value;
    }
    if (value && typeof value === 'object') {
      const name = normalizeKey(value.name || value.label || value.fieldName || '');
      if (normalizedLabels.some(label => name === label || name.includes(label))) {
        return value.value ?? value.text ?? value.displayName ?? value.name;
      }
    }
  }
  return null;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanFieldValue(value) {
  if (Array.isArray(value)) return value.map(cleanFieldValue).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return value.displayName || value.name || value.value || value.text || JSON.stringify(value);
  }
  return String(value || '').trim() || NOT_INFORMED;
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function getEpicLabel(card) {
  if (card.parentKey && card.parentTitle) return `${card.parentKey} - ${card.parentTitle}`;
  if (card.epicKey) return card.epicKey;
  if (card.parentKey) return card.parentKey;
  return '-';
}

function groupRowsByProject(rows) {
  return countRowsBy(rows, 'projectId')
    .map(item => ({ projectId: item.value, projectName: item.label, total: item.total }));
}

function countRowsBy(rows, valueKey) {
  const labelKey = valueKey === 'projectId'
    ? 'projectName'
    : valueKey === 'assigneeId'
      ? 'assigneeName'
      : valueKey;
  const map = new Map();
  rows.forEach(row => {
    const value = row[valueKey];
    if (!value) return;
    const current = map.get(value) || { value, label: row[labelKey] || value, total: 0 };
    current.total++;
    map.set(value, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
}

function getSortOptions(mode) {
  if (mode === 'blocked') {
    return [
      { value: 'projectName', label: 'Projeto' },
      { value: 'title', label: 'Nome do card' },
      { value: 'assigneeName', label: 'Responsavel' },
      { value: 'blockReason', label: 'Motivo do bloqueio' },
      { value: 'actionTaken', label: 'Acao Tomada' },
      { value: 'pendingWith', label: 'Pendente com?' },
    ];
  }
  return [
    { value: 'businessDaysOverdue', label: 'Dias uteis em atraso' },
    { value: 'dueDate', label: 'Data limite' },
    { value: 'projectName', label: 'Projeto' },
    { value: 'title', label: 'Nome do card' },
    { value: 'assigneeName', label: 'Responsavel' },
    { value: 'status', label: 'Status' },
  ];
}



function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function kpiCard(value, label, trend, tone) {
  return `
    <div class="kpi-card kpi-${sanitize(tone)}">
      ${businessHelp(`Regra: ${label}`, trend)}
      <div class="kpi-value">${sanitize(String(value))}</div>
      <div class="kpi-label">${sanitize(label)}</div>
      <div class="kpi-trend">${sanitize(trend)}</div>
    </div>
  `;
}

function renderIssueLink(card) {
  const jiraUrl = getJiraIssueUrl(card, dataService.config?.baseUrl);
  if (jiraUrl === '#') {
    return `<span class="issue-link unavailable" title="URL do Jira nao configurada">${sanitize(card.key)}</span>`;
  }
  return `<a href="${sanitizeUrl(jiraUrl)}" target="_blank" rel="noopener noreferrer" class="issue-link">${sanitize(card.key)}</a>`;
}

function renderUser(user) {
  return `
    <div class="user-cell">
      <img src="${sanitizeTitle(user ? user.avatarUrl : '')}" class="avatar avatar-sm" onerror="this.style.display='none'" alt="${sanitizeTitle(user ? user.displayName : '')}">
      <span>${sanitize(user ? user.displayName : 'Nao atribuido')}</span>
    </div>
  `;
}

function renderLongField(value, missing) {
  return `<span class="long-cell ${missing ? 'missing' : ''}" title="${sanitizeTitle(value)}">${sanitize(value)}</span>`;
}

function renderBlockInfo(value, missing) {
  return `<span class="${missing ? 'missing-info' : ''}" title="${sanitizeTitle(value)}">${sanitize(value)}</span>`;
}

function renderEmptyRow(colSpan, title, description) {
  return `
    <tr>
      <td colspan="${colSpan}" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <h3>${sanitize(title)}</h3>
        <p>${sanitize(description)}</p>
      </td>
    </tr>
  `;
}

function timestampForFile() {
  const d = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
