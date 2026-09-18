/**
 * dashboard.js — Página principal de visão executiva
 * Versão com filtros completos
 */
import { dataService } from '../data/data-service.js';
import { resolveStatusCategory, StatusCategory, isCardOverdue } from '../data/models.js';
import { STATUS_COLORS, healthLabel, sanitize, formatDateTime, formatDate, priorityLabel, sanitizeTitle, getJiraIssueUrl } from '../utils/helpers.js';
import { businessHelp } from '../utils/ui-feedback.js';
import { canAccessPermission } from '../utils/access-control.js';

let dashboardChart = null;
let selectedWorkloadProject = '';
let ChartModule = null;
let chartRenderToken = 0;

// Estado global de filtros
let dashboardFilters = {
  projectId: '',
  analystId: '',
  status: '',
  priority: '',
  dateStart: '',
  dateEnd: '',
  showOverdue: false,
  showNoDate: false,
  showNoAnalyst: false
};

// Cache para estatísticas filtradas
let statsCache = {
  key: '',
  data: null
};

const KPI_CARD_CONFIG = {
  activeProjects: {
    label: 'Projetos Ativos',
    empty: 'Nenhum card encontrado nos projetos ativos para os filtros selecionados.',
    getCards: cards => cards,
  },
  totalCards: {
    label: 'Total de Cards',
    empty: 'Nenhum card encontrado para os filtros selecionados.',
    getCards: cards => cards,
  },
  inProgress: {
    label: 'Cards em Andamento',
    empty: 'Nenhum card em andamento para os filtros selecionados.',
    getCards: cards => cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.IN_PROGRESS),
  },
  overdue: {
    label: 'Cards Atrasados',
    empty: 'Nenhum card atrasado para os filtros selecionados.',
    getCards: cards => cards.filter(card => isCardOverdue(card)),
  },
  dataHealth: {
    label: 'Saúde de Dados',
    empty: 'Nenhum card com inconsistência de dados para os filtros selecionados.',
    getCards: cards => cards.filter(card => card.isInconsistent),
  },
};



export function renderDashboard() {
  const header = document.getElementById('page-header');
  const metadata = dataService.getSyncMetadata();
  const projects = dataService.getProjects();
  const users = dataService.getUsersForSelection();

  // Verificar se há filtros ativos
  const activeFilters = getActiveFilterCount();
  const clearBtnStyle = activeFilters > 0 ? '' : 'display: none;';

  header.innerHTML = `
    <div>
      <h2>Dashboard Executivo</h2>
      <div class="subtitle" style="display: flex; align-items: center; gap: 12px;">
        <span>Visão geral de todos os projetos e entregas</span>
        <span style="width: 1px; height: 12px; background: var(--border);"></span>
        <span style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Atualizado em: ${metadata.lastSyncedAt ? formatDateTime(metadata.lastSyncedAt) : 'Nunca'}
          ${metadata.lastSyncStatus === 'running' ? '<span style="color: var(--info); animation: pulse 1s infinite;">(Sincronizando...)</span>' : ''}
        </span>
      </div>
    </div>
    <div class="page-actions" style="display: flex; gap: 8px; align-items: center;">
      <button id="btn-clear-filters" class="btn btn-secondary" style="${clearBtnStyle}" title="Limpar todos os filtros">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        Limpar Filtros (${activeFilters})
      </button>
    </div>
  `;

  // Renderizar conteúdo com filtros
  renderDashboardContent();

  // Event listeners para filtros
  setupFilterListeners(projects, users);

  // Listener para limpar filtros
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    dashboardFilters = {
      projectId: '',
      analystId: '',
      status: '',
      priority: '',
      dateStart: '',
      dateEnd: '',
      showOverdue: false,
      showNoDate: false,
      showNoAnalyst: false
    };
    // Invalidar cache ao limpar filtros
    statsCache = { key: '', data: null };
    // Recarregar a página para resetar selects
    renderDashboard();
  });
}

function getActiveFilterCount() {
  let count = 0;
  if (dashboardFilters.projectId) count++;
  if (dashboardFilters.analystId) count++;
  if (dashboardFilters.status) count++;
  if (dashboardFilters.priority) count++;
  if (dashboardFilters.dateStart) count++;
  if (dashboardFilters.dateEnd) count++;
  if (dashboardFilters.showOverdue) count++;
  if (dashboardFilters.showNoDate) count++;
  if (dashboardFilters.showNoAnalyst) count++;
  return count;
}

function setupFilterListeners() {
  // Filtro por projeto
  document.getElementById('filter-project')?.addEventListener('change', (e) => {
    dashboardFilters.projectId = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtro por analista
  document.getElementById('filter-analyst')?.addEventListener('change', (e) => {
    dashboardFilters.analystId = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtro por status
  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    dashboardFilters.status = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtro por prioridade
  document.getElementById('filter-priority')?.addEventListener('change', (e) => {
    dashboardFilters.priority = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtro por data inicial
  document.getElementById('filter-date-start')?.addEventListener('change', (e) => {
    dashboardFilters.dateStart = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtro por data final
  document.getElementById('filter-date-end')?.addEventListener('change', (e) => {
    dashboardFilters.dateEnd = e.target.value;
    statsCache = { key: '', data: null };
    renderDashboard();
  });

  // Filtros rápidos
  document.querySelectorAll('[data-quick-filter]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.quickFilter;
      dashboardFilters[key] = !dashboardFilters[key];
      statsCache = { key: '', data: null };
      renderDashboard();
    });
  });

  document.querySelectorAll('[data-clear-filter]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.clearFilter;
      dashboardFilters[key] = key.startsWith('show') ? false : '';
      statsCache = { key: '', data: null };
      renderDashboard();
    });
  });
}

function quickFilterButton({ key, label, tone }) {
  const active = Boolean(dashboardFilters[key]);
  return `
    <button type="button" class="quick-filter-chip ${active ? 'active' : ''} tone-${tone}" data-quick-filter="${key}" aria-pressed="${active ? 'true' : 'false'}">
      <span>${sanitize(label)}</span>
    </button>
  `;
}

function clearFilterChip(key, label, tone = 'accent') {
  return `
    <button type="button" class="active-filter-chip tone-${tone}" data-clear-filter="${key}" title="Remover filtro ${sanitizeTitle(label)}">
      <span>${sanitize(label)}</span>
      <strong aria-hidden="true">x</strong>
    </button>
  `;
}

function renderDashboardContent() {
  const content = document.getElementById('page-content');
  const projects = dataService.getProjects();
  const users = dataService.getUsersForSelection();

  // Obter estatísticas com filtros
  const stats = getFilteredStats();

  // Obter projetos filtrados para a tabela
  const filteredProjects = getFilteredProjects();

  // Obter workload filtrado
  const workload = getFilteredWorkload();

  // Gerar HTML dos filtros ativos
  const activeFiltersHtml = renderActiveFilters();

  content.innerHTML = `
    <!-- BARRA DE FILTROS -->
    <div class="filter-bar dashboard-filter-bar">
      <div class="filter-field">
        <span class="filter-label">Projeto</span>
        <select id="filter-project" class="filter-select">
          <option value="">Todos os Projetos</option>
          ${projects.map(p => `<option value="${sanitize(p.id)}" ${dashboardFilters.projectId === p.id ? 'selected' : ''}>${sanitize(p.name)}</option>`).join('')}
        </select>
      </div>

      <div class="filter-field">
        <span class="filter-label">Analista</span>
        <select id="filter-analyst" class="filter-select">
          <option value="">Todos os Analistas</option>
          ${users.map(u => `<option value="${sanitize(u.id)}" ${dashboardFilters.analystId === u.id ? 'selected' : ''}>${sanitize(u.displayName)}</option>`).join('')}
        </select>
      </div>

      <div class="filter-field">
        <span class="filter-label">Status</span>
        <select id="filter-status" class="filter-select">
          <option value="">Todos os Status</option>
          ${dataService.getStatusOptions().map(s => `<option value="${sanitize(s)}" ${dashboardFilters.status === s ? 'selected' : ''}>${sanitize(s)}</option>`).join('')}
        </select>
      </div>

      <div class="filter-field filter-field-sm">
        <span class="filter-label">Prioridade</span>
        <select id="filter-priority" class="filter-select">
          <option value="">Todas</option>
          <option value="highest" ${dashboardFilters.priority === 'highest' ? 'selected' : ''}>Crítica</option>
          <option value="high" ${dashboardFilters.priority === 'high' ? 'selected' : ''}>Alta</option>
          <option value="medium" ${dashboardFilters.priority === 'medium' ? 'selected' : ''}>Média</option>
          <option value="low" ${dashboardFilters.priority === 'low' ? 'selected' : ''}>Baixa</option>
          <option value="lowest" ${dashboardFilters.priority === 'lowest' ? 'selected' : ''}>Muito Baixa</option>
        </select>
      </div>

      <div class="filter-field filter-field-date">
        <span class="filter-label">Inicial</span>
        <input type="date" id="filter-date-start" class="filter-input" value="${dashboardFilters.dateStart}">
      </div>

      <div class="filter-field filter-field-date">
        <span class="filter-label">Final</span>
        <input type="date" id="filter-date-end" class="filter-input" value="${dashboardFilters.dateEnd}">
      </div>

      <div class="quick-filter-group" aria-label="Filtros rapidos">
        ${quickFilterButton({ key: 'showOverdue', label: 'Vencidos', tone: 'danger' })}
        ${quickFilterButton({ key: 'showNoDate', label: 'Sem data', tone: 'warning' })}
        ${quickFilterButton({ key: 'showNoAnalyst', label: 'Sem analista', tone: 'accent' })}
      </div>
    </div>

    <!-- INDICADORES DE FILTROS ATIVOS -->
    ${activeFiltersHtml ? `
    <div class="active-filters-bar">
      <span>Filtros ativos:</span>
      ${activeFiltersHtml}
    </div>
    ` : ''}

    <!-- VERIFICAÇÃO DE ESTADO VAZIO -->
    ${stats.totalCards === 0 ? `
    <div class="empty-state" style="padding: 60px; text-align: center;">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom: 16px;">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <h3 style="color: var(--text-primary); margin-bottom: 8px;">Nenhum dado encontrado</h3>
      <p style="color: var(--text-muted);">Configure as credenciais do Jira na página Dados e clique em Sincronizar.</p>
      <button class="btn btn-primary" onclick="location.hash='#/data'" style="margin-top: 16px;">Ir para Dados</button>
    </div>
    ` : `

    <!-- KPI GRID -->
    <div class="kpi-grid dashboard-kpi-grid">
      <div role="button" tabindex="0" class="kpi-card dashboard-kpi-action" data-dashboard-kpi="activeProjects" aria-label="Ver cards de projetos ativos">
        ${businessHelp('Como é calculado?', 'Quantidade de projetos que possuem cards depois da aplicação dos filtros. O sistema não consulta um campo de status do projeto.')}
        <div class="kpi-label">Projetos Ativos</div>
        <div class="kpi-value">${stats.totalProjects}</div>
        <div class="kpi-icon" style="background: rgba(99,102,241,0.1); color: #6366f1;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
      </div>
      <div role="button" tabindex="0" class="kpi-card dashboard-kpi-action" data-dashboard-kpi="totalCards" aria-label="Ver todos os cards filtrados">
        ${businessHelp('Como é calculado?', 'Contagem de cards retornados após aplicar projeto, analista, status, prioridade, período e filtros rápidos.')}
        <div class="kpi-label">Total de Cards</div>
        <div class="kpi-value">${stats.totalCards}</div>
        <div class="kpi-icon" style="background: rgba(59,130,246,0.1); color: #3b82f6;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        </div>
      </div>
      <div role="button" tabindex="0" class="kpi-card dashboard-kpi-action" data-dashboard-kpi="inProgress" aria-label="Ver cards em andamento">
        ${businessHelp('Como é calculado?', 'Cards cujo status do Jira é classificado como Em Andamento pelo mapa padrão de status normalizados.')}
        <div class="kpi-label">Em Andamento</div>
        <div class="kpi-value">${stats.byCategory.in_progress}</div>
        <div class="kpi-icon" style="background: rgba(16,185,129,0.1); color: #10b981;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
        </div>
      </div>
      <div role="button" tabindex="0" class="kpi-card dashboard-kpi-action" data-dashboard-kpi="overdue" aria-label="Ver cards atrasados">
        ${businessHelp('Como é calculado?', 'Cards com data de entrega anterior ao dia atual, desde que tenham data válida e ainda não estejam concluídos.')}
        <div class="kpi-label">Atrasados</div>
        <div class="kpi-value ${stats.overdue > 0 ? 'text-danger' : ''}">${stats.overdue}</div>
        <div class="kpi-icon" style="background: rgba(239,68,68,0.1); color: #ef4444;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
      </div>
      <div role="button" tabindex="0" class="kpi-card dashboard-kpi-action" data-dashboard-kpi="dataHealth" aria-label="Ver cards com inconsistência de dados">
        ${businessHelp('Como é calculado?', 'Contagem de cards marcados como inconsistentes durante a normalização dos dados do Jira.')}
        <div class="kpi-label">Saúde de Dados</div>
        <div class="kpi-value ${stats.inconsistent > 0 ? 'text-warning' : ''}">${stats.inconsistent}</div>
        <div class="kpi-icon" style="background: rgba(245,158,11,0.1); color: #f59e0b;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
      </div>
    </div>

    <!-- CHARTS GRID -->
    <div class="charts-grid">
      <div class="chart-card">
        <h3>Distribuição por Status ${businessHelp('Regra de status', 'Cada status original do Jira é convertido em A Fazer, Em Andamento, Concluído ou Bloqueado pelo mapa de status normalizado.')}</h3>
        <canvas id="statusChart"></canvas>
        ${renderStatusCompletionSummary(stats)}
      </div>
      <div class="chart-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3>Carga de Trabalho por Analista ${businessHelp('Regra de carga', 'Agrupa os cards filtrados pelo analista responsável. O percentual da barra compara cada total com o maior total da lista.')}</h3>
          <select id="workload-project-select" style="background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; font-size: 12px;">
            <option value="">Todos os Projetos</option>
            ${projects.map(p => `<option value="${sanitize(p.key)}" ${selectedWorkloadProject === p.key ? 'selected' : ''}>${sanitize(p.name)}</option>`).join('')}
          </select>
        </div>
        <div id="workload-container" style="max-height: 300px; overflow-y: auto;">
          ${renderWorkloadList(workload)}
        </div>
      </div>
      <div class="chart-card chart-full">
        <h3>Progresso por Projeto ${businessHelp('Regra de progresso', 'O progresso de cada projeto é a proporção de cards concluídos em relação ao total de cards daquele projeto.')}</h3>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Saúde</th>
                <th>Progresso</th>
                <th>Status</th>
                <th>Atrasados</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${filteredProjects.map(p => {
                const pStats = dataService.getProjectStats(p.id);
                return `
                  <tr>
                    <td>
                      <div style="font-weight: 600;">${sanitize(p.name)}</div>
                      <div style="font-size: 11px; color: var(--text-muted);">${sanitize(p.key)}</div>
                    </td>
                    <td>
                      <span class="badge badge-health-${pStats.health}">${healthLabel(pStats.health)}</span>
                    </td>
                    <td style="width: 200px;">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="progress-bar" style="flex: 1;">
                          <div class="fill" style="width: ${pStats.progress}%;"></div>
                        </div>
                        <span style="font-size: 12px; font-weight: 600;">${pStats.progress}%</span>
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; gap: 4px;">
                        <span class="badge badge-todo" title="A Fazer">${pStats.todo}</span>
                        <span class="badge badge-progress" title="Em Andamento">${pStats.inProgress}</span>
                        <span class="badge badge-done" title="Concluído">${pStats.done}</span>
                      </div>
                    </td>
                    <td>
                      <span class="${pStats.overdue > 0 ? 'badge badge-overdue' : ''}">${pStats.overdue}</span>
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="location.hash='#/board?projectKey=${sanitize(p.key)}'">Ver no Kanban</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- AUDIT SECTION -->
    <div class="audit-section">
      <div class="section-header">
        <h3>Auditoria de Saúde dos Dados</h3>
        <p class="subtitle">Identificação de tickets com informações incompletas no Jira</p>
      </div>

      <div class="audit-grid">
        ${renderAuditCard('Sem Analista', stats.inconsistentData?.noAssignee || [], 'crítico para medir carga de trabalho')}
        ${renderAuditCard('Sem Prioridade', stats.inconsistentData?.noPriority || [], 'afeta a ordenação e foco')}
        ${renderAuditCard('Sem Data Entrega', stats.inconsistentData?.noDueDate || [], 'impede previsão de entrega')}
        ${renderAuditCard('Em Progresso Sem Dono', stats.inconsistentData?.stuckInProgress || [], 'tickets que podem estar parados')}
      </div>

      <div class="table-container" style="margin-top: 20px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Resumo</th>
              <th>Problema Identificado</th>
              <th>Analista</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${renderInconsistentTableRows()}
          </tbody>
        </table>
      </div>
    </div>
    `}
  `;

  if (!canAccessPermission('analysts.comparative')) {
    document.getElementById('workload-container')?.closest('.chart-card')?.remove();
  }
  initCharts(stats, canAccessPermission('analysts.comparative') ? workload : []);
  bindDashboardKpiCards();

  // Listener para o seletor de projeto no gráfico de workload
  document.getElementById('workload-project-select')?.addEventListener('change', (e) => {
    selectedWorkloadProject = e.target.value;
    // Recarregar com filtro de projeto específico
    const newWorkload = selectedWorkloadProject
      ? getFilteredWorkload().filter(w => {
          const cards = dataService.getCardsByProject(dataService.getProjects().find(p => p.key === selectedWorkloadProject)?.id);
          return cards.some(c => c.assigneeId === w.user.id);
        })
      : getFilteredWorkload();

    document.getElementById('workload-container').innerHTML = renderWorkloadList(newWorkload);
  });
}

function getFilteredCardsForDashboard() {
  let cards = [...dataService.getCards()];

  if (dashboardFilters.projectId) {
    cards = cards.filter(c => c.projectId === dashboardFilters.projectId);
  }

  if (dashboardFilters.analystId) {
    cards = cards.filter(c => c.assigneeId === dashboardFilters.analystId);
  }

  if (dashboardFilters.status) {
    cards = cards.filter(c => c.status === dashboardFilters.status);
  }

  if (dashboardFilters.priority) {
    cards = cards.filter(c => c.priority === dashboardFilters.priority);
  }

  if (dashboardFilters.dateStart) {
    const startDate = new Date(dashboardFilters.dateStart);
    cards = cards.filter(c => c.dueDate && new Date(c.dueDate) >= startDate);
  }

  if (dashboardFilters.dateEnd) {
    const endDate = new Date(dashboardFilters.dateEnd);
    cards = cards.filter(c => c.dueDate && new Date(c.dueDate) <= endDate);
  }

  if (dashboardFilters.showOverdue) {
    cards = cards.filter(c => isCardOverdue(c));
  }

  if (dashboardFilters.showNoDate) {
    cards = cards.filter(c => !c.dueDate);
  }

  if (dashboardFilters.showNoAnalyst) {
    cards = cards.filter(c => !c.assigneeId || c.assigneeId === 'unassigned');
  }

  return cards;
}

function renderStatusCompletionSummary(stats) {
  const done = stats.byCategory.done || 0;
  const notDone = Math.max(0, stats.totalCards - done);
  const donePercent = stats.totalCards ? Math.round((done / stats.totalCards) * 100) : 0;
  const notDonePercent = stats.totalCards ? Math.round((notDone / stats.totalCards) * 100) : 0;

  return `
    <div class="dashboard-status-percentages" aria-label="Percentual de cards concluídos e não concluídos">
      <div class="dashboard-status-percentage done"><span>Concluídos</span><strong>${donePercent}%</strong><small>${done} card(s)</small></div>
      <div class="dashboard-status-percentage pending"><span>Não concluídos</span><strong>${notDonePercent}%</strong><small>${notDone} card(s)</small></div>
    </div>
  `;
}

function bindDashboardKpiCards() {
  document.querySelectorAll('[data-dashboard-kpi]').forEach(button => {
    button.addEventListener('click', event => {
      if (event.target.closest('.business-help')) return;
      showDashboardKpiModal(button.dataset.dashboardKpi);
    });
    button.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key) || event.target.closest('.business-help')) return;
      event.preventDefault();
      showDashboardKpiModal(button.dataset.dashboardKpi);
    });
  });
}

function dashboardCardJiraLink(card) {
  const url = getJiraIssueUrl(card, dataService.config?.baseUrl);
  if (url === '#') {
    return `<span class="issue-link unavailable" title="URL do Jira não configurada">${sanitize(card.key)}</span>`;
  }
  return `<a class="issue-link" href="${sanitizeTitle(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${sanitizeTitle(card.key)} no Jira">${sanitize(card.key)}</a>`;
}

function renderDashboardKpiRows(cards) {
  if (!cards.length) return '';
  return cards.map(card => {
    const project = dataService.getProjectById(card.projectId);
    const assignee = dataService.getUserById(card.assigneeId);
    const category = resolveStatusCategory(card.status);
    return `
      <article class="dashboard-kpi-modal-row">
        <div>
          <strong>${dashboardCardJiraLink(card)}</strong>
          <span>${sanitize(card.title || 'Sem resumo informado')}</span>
        </div>
        <div class="dashboard-kpi-modal-meta">
          <span>${sanitize(project?.key || project?.name || 'Sem projeto')}</span>
          <span>${sanitize(assignee?.displayName || 'Não atribuído')}</span>
          <span class="badge badge-${category}">${sanitize(card.status || 'Sem status')}</span>
          ${isCardOverdue(card) ? '<span class="badge badge-overdue">Atrasado</span>' : ''}
        </div>
      </article>
    `;
  }).join('');
}

function showDashboardKpiModal(kpiKey) {
  const config = KPI_CARD_CONFIG[kpiKey];
  if (!config) return;
  const cards = config.getCards(getFilteredCardsForDashboard())
    .sort((left, right) => String(right.updatedAt || right.dueDate || '').localeCompare(String(left.updatedAt || left.dueDate || '')));
  const previous = document.querySelector('.ui-modal-backdrop[data-dashboard-kpi-modal]');
  if (previous) previous.remove();

  const modal = document.createElement('div');
  modal.className = 'ui-modal-backdrop';
  modal.dataset.dashboardKpiModal = 'true';
  modal.innerHTML = `
    <section class="ui-modal dashboard-kpi-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-kpi-modal-title">
      <div class="ui-modal-icon" aria-hidden="true">i</div>
      <div class="ui-modal-body">
        <h2 id="dashboard-kpi-modal-title">${sanitize(config.label)}</h2>
        <p>${cards.length} card(s) encontrado(s) com os filtros atuais.</p>
        <div class="dashboard-kpi-modal-list">
          ${cards.length ? renderDashboardKpiRows(cards) : `<div class="dashboard-kpi-modal-empty">${sanitize(config.empty)}</div>`}
        </div>
      </div>
      <div class="ui-modal-actions">
        <button type="button" class="btn btn-secondary" data-close-modal>Fechar</button>
      </div>
    </section>
  `;
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-close-modal]')) modal.remove();
  });
  document.addEventListener('keydown', function closeOnEscape(event) {
    if (event.key !== 'Escape' || !document.body.contains(modal)) return;
    modal.remove();
    document.removeEventListener('keydown', closeOnEscape);
  });
  document.body.appendChild(modal);
  modal.querySelector('[data-close-modal]')?.focus();
}

/**
 * Renderiza lista de carga de trabalho com scroll e tooltips
 */
function renderWorkloadList(workload) {
  if (workload.length === 0) {
    return '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhum dado de carga de trabalho para os filtros selecionados.</div>';
  }

  // Ordenar por total de cards (maior primeiro)
  const sorted = [...workload].sort((a, b) => b.total - a.total);
  const maxTotal = Math.max(...sorted.map(w => w.total));

  return sorted.map(w => {
    const percent = maxTotal > 0 ? Math.round((w.total / maxTotal) * 100) : 0;

    return `
      <div class="workload-item" style="display: flex; align-items: center; gap: 12px; padding: 10px; border-bottom: 1px solid var(--border); position: relative;" title="Total: ${w.total} | Andamento: ${w.inProgress} | Concluídos: ${w.done}">
        <div style="min-width: 120px;">
          <div style="font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${sanitize(w.user.displayName)}">
            ${sanitize(w.user.displayName)}
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">${w.total} cards</div>
        </div>
        <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
          <div style="flex: 1; height: 20px; background: var(--bg-secondary); border-radius: 4px; overflow: hidden; position: relative;">
            <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--accent), #818cf8); border-radius: 4px; transition: width 0.3s ease;"></div>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 10px; font-weight: 700; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
              ${w.total}
            </div>
          </div>
          <div style="display: flex; gap: 6px; min-width: 80px;">
            <span class="badge badge-progress" style="font-size: 10px;" title="Em Andamento">${w.inProgress}</span>
            <span class="badge badge-done" style="font-size: 10px;" title="Concluídos">${w.done}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Obtém estatísticas filtradas com base nos filtros atuais
 * Com cache para evitar recálculos desnecessários
 */
function getFilteredStats() {
  // Gerar chave de cache baseada nos filtros atuais
  const cacheKey = JSON.stringify(dashboardFilters);

  // Retornar cache se filtros não mudaram
  if (statsCache.key === cacheKey && statsCache.data) {
    return statsCache.data;
  }

  const cards = getFilteredCardsForDashboard();
  const projectIds = new Set(cards.map(card => card.projectId));
  const projects = dataService.getProjects().filter(project => projectIds.has(project.id));

  // Calcular estatísticas
  const total = cards.length;
  const byCategory = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
  const byPriority = { highest: 0, high: 0, medium: 0, low: 0, lowest: 0 };
  let overdue = 0;
  let inconsistent = 0;

  cards.forEach(c => {
    byCategory[resolveStatusCategory(c.status)]++;
    if (byPriority[c.priority] !== undefined) byPriority[c.priority]++;
    if (isCardOverdue(c)) overdue++;
    if (c.isInconsistent) inconsistent++;
  });

  // Dados de auditoria filtrados
  const inconsistentData = {
    noAssignee: cards.filter(c => !c.assigneeId || c.assigneeId === 'unassigned'),
    noPriority: cards.filter(c => !c.priority),
    noDueDate: cards.filter(c => !c.dueDate),
    stuckInProgress: cards.filter(c => c.status.toLowerCase().includes('progress') && (!c.assigneeId || c.assigneeId === 'unassigned')),
    unknownStatus: cards.filter(c => c.status === 'Unknown')
  };

  const result = {
    totalProjects: projects.length,
    totalCards: total,
    byCategory,
    byPriority,
    overdue,
    inconsistent,
    inconsistentData
  };

  // Atualizar cache
  statsCache = { key: cacheKey, data: result };

  return result;
}

/**
 * Obtém projetos que têm cards após aplicação dos filtros
 */
function getFilteredProjects() {
  const projectIds = new Set(getFilteredCardsForDashboard().map(card => card.projectId));
  return dataService.getProjects().filter(project => projectIds.has(project.id));
}

/**
 * Obtém workload filtrado por analista
 */
function getFilteredWorkload() {
  let cards = [...dataService.getCards()];
  const users = dataService.getUsersForSelection();

  // Aplicar filtros aos cards
  if (dashboardFilters.projectId) {
    cards = cards.filter(c => c.projectId === dashboardFilters.projectId);
  }

  if (dashboardFilters.analystId) {
    cards = cards.filter(c => c.assigneeId === dashboardFilters.analystId);
  }

  if (dashboardFilters.status) {
    cards = cards.filter(c => c.status === dashboardFilters.status);
  }

  if (dashboardFilters.priority) {
    cards = cards.filter(c => c.priority === dashboardFilters.priority);
  }

  // Calcular workload por usuário
  const workloadByUser = new Map();
  users.forEach(user => {
    workloadByUser.set(user.id, { user, total: 0, inProgress: 0, done: 0 });
  });

  cards.forEach(card => {
    const item = workloadByUser.get(card.assigneeId);
    if (!item) return;
    item.total++;
    const category = resolveStatusCategory(card.status);
    if (category === StatusCategory.IN_PROGRESS) item.inProgress++;
    if (category === StatusCategory.DONE) item.done++;
  });

  return [...workloadByUser.values()].filter(w => w.total > 0);
}

/**
 * Renderiza indicadores visuais dos filtros ativos
 */
function renderActiveFilters() {
  const filters = [];
  const projects = dataService.getProjects();
  const users = dataService.getUsersForSelection();

  if (dashboardFilters.projectId) {
    const p = projects.find(p => p.id === dashboardFilters.projectId);
    if (p) filters.push(clearFilterChip('projectId', `Projeto: ${p.name}`));
  }

  if (dashboardFilters.analystId) {
    const u = users.find(u => u.id === dashboardFilters.analystId);
    if (u) filters.push(clearFilterChip('analystId', `Analista: ${u.displayName}`));
  }

  if (dashboardFilters.status) {
    filters.push(clearFilterChip('status', `Status: ${dashboardFilters.status}`));
  }

  if (dashboardFilters.priority) {
    filters.push(clearFilterChip('priority', `Prioridade: ${priorityLabel(dashboardFilters.priority)}`));
  }

  if (dashboardFilters.dateStart) {
    filters.push(clearFilterChip('dateStart', `De: ${formatDate(dashboardFilters.dateStart)}`));
  }

  if (dashboardFilters.dateEnd) {
    filters.push(clearFilterChip('dateEnd', `Até: ${formatDate(dashboardFilters.dateEnd)}`));
  }

  if (dashboardFilters.showOverdue) {
    filters.push(clearFilterChip('showOverdue', 'Vencidos', 'danger'));
  }


  if (dashboardFilters.showNoDate) {
    filters.push(clearFilterChip('showNoDate', 'Sem data', 'warning'));
  }

  if (dashboardFilters.showNoAnalyst) {
    filters.push(clearFilterChip('showNoAnalyst', 'Sem analista', 'accent'));
  }

  return filters.join('');
}

function renderAuditCard(title, list, tooltip) {
  const count = list.length;
  const isOk = count === 0;
  return `
    <div class="audit-card ${isOk ? 'audit-ok' : 'audit-warning'}">
      ${businessHelp(`Regra: ${title}`, tooltip)}
      <div class="audit-icon">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          ${isOk ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'}
        </svg>
      </div>
      <div class="audit-info">
        <div class="audit-count">${count}</div>
        <div class="audit-label">${title}</div>
        <div class="audit-tooltip" title="${sanitizeTitle(tooltip)}">${tooltip}</div>
      </div>
    </div>
  `;
}

function renderInconsistentTableRows() {
  const stats = getFilteredStats();
  const summary = stats.inconsistentData;

  const allInconsistent = new Set([
    ...summary.noAssignee,
    ...summary.noPriority,
    ...summary.noDueDate,
    ...summary.stuckInProgress,
    ...summary.unknownStatus
  ]);

  if (allInconsistent.size === 0) {
    return '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">Parabéns! Todos os tickets estão com dados consistentes.</td></tr>';
  }

  return Array.from(allInconsistent).map(c => {
    const problems = [];
    if (!c.assigneeId || c.assigneeId === 'unassigned') problems.push('Sem analista');
    if (summary.noPriority.includes(c)) problems.push('Sem prioridade');
    if (!c.dueDate) problems.push('Sem data de entrega');
    if (c.status.toLowerCase().includes('progress') && (!c.assigneeId || c.assigneeId === 'unassigned')) problems.push('Em progresso sem dono');
    if (c.status === 'Unknown') problems.push('Status desconhecido');

    const config = dataService.config;
    const jiraUrl = getJiraIssueUrl(c, config?.baseUrl);
    const onclick = jiraUrl === '#' ? "onclick=\"alert('Link indisponível: URL do Jira não configurada. Por favor, ajuste as configurações de conexão.'); return false;\"" : "";

    return `
      <tr>
        <td><a href="${jiraUrl}" target="_blank" rel="noopener noreferrer" class="issue-link" ${onclick} style="font-weight: 600; color: var(--accent); text-decoration: none; border-bottom: 1px dashed transparent; transition: all 0.2s;" onmouseover="this.style.borderBottomColor='var(--accent)'" onmouseout="this.style.borderBottomColor='transparent'">${sanitize(c.key)}</a></td>
        <td><div class="text-truncate" style="max-width: 300px;">${sanitize(c.title)}</div></td>
        <td>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${problems.map(p => `<span class="badge badge-blocked" style="font-size: 10px;">${p}</span>`).join('')}
          </div>
        </td>
        <td>${sanitize(dataService.getUserById(c.assigneeId)?.displayName || 'Não atribuído')}</td>
        <td>
          <a href="${jiraUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" ${onclick} style="display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
            Corrigir no Jira
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadChart() {
  if (!ChartModule) {
    ChartModule = (await import('chart.js/auto')).default;
  }
  return ChartModule;
}

async function initCharts(stats) {
  const token = ++chartRenderToken;
  // Destruir gráficos anteriores se existirem
  if (dashboardChart) dashboardChart.destroy();

  const ctxStatus = document.getElementById('statusChart')?.getContext('2d');
  if (ctxStatus && stats.totalCards > 0) {
    const Chart = await loadChart();
    if (token !== chartRenderToken) return;
    dashboardChart = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: ['A Fazer', 'Em Andamento', 'Concluído', 'Bloqueado'],
        datasets: [{
          data: [stats.byCategory.todo, stats.byCategory.in_progress, stats.byCategory.done, stats.byCategory.blocked],
          backgroundColor: [STATUS_COLORS.todo, STATUS_COLORS.in_progress, STATUS_COLORS.done, STATUS_COLORS.blocked],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), padding: 20, font: { size: 11 } } }
        },
        cutout: '70%'
      }
    });
  }

  // O gráfico de workload foi substituído por uma lista com scroll e tooltips
  //see renderWorkloadList() acima
}
