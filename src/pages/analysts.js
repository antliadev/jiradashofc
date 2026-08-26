/**
 * analysts.js — Visoes Geral, Comparativo e Evolucao de analistas.
 */
import { dataService } from '../data/data-service.js';
import { isCardOverdue, resolveStatusCategory, StatusCategory } from '../data/models.js';
import { formatDate, sanitize, sanitizeTitle, typeLabel } from '../utils/helpers.js';
import { exportRowsWorkbook } from '../utils/excel-export.js';
import { businessHelp } from '../utils/ui-feedback.js';

const MIN_SAMPLE_KEY = 'rja.analysts.minimumSample';
const SHARED_ANALYST_KEY = 'rja.analysts.sharedUserId';

let comparisonProfessionalsOpen = false;

function routeMode() {
  const path = (window.location.hash.replace(/^#\/?/, '/') || '/analysts').split('?')[0];
  if (path.endsWith('/comparative')) return 'comparative';
  if (path.endsWith('/evolution')) return 'evolution';
  return 'general';
}

function params() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '');
}

function isEpic(card) {
  return card.type === 'epic';
}

function cardEndDate(card) {
  return card.plannedEndDate || card.dueDate || null;
}

function dateInRange(value, start, end) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  if (start && date < new Date(start)) return false;
  if (end) {
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);
    if (date > endDate) return false;
  }
  return true;
}

function businessDaysLate(endDate) {
  if (!endDate) return 0;
  const end = new Date(endDate);
  const today = new Date();
  end.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  if (end >= today) return 0;
  let cursor = new Date(end);
  cursor.setDate(cursor.getDate() + 1);
  let days = 0;
  while (cursor <= today) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function hasHumanCommentsAvailable() {
  const raw = dataService.getRawJiraData()?.issues || [];
  return raw.some(issue => issue.comment_count || issue.comments_count || issue.human_comment_count);
}

function projectOptions(selectedId = '') {
  return `<option value="">Todos</option>${dataService.getProjects().map(project => (
    `<option value="${sanitize(project.id)}" ${project.id === selectedId ? 'selected' : ''}>${sanitize(project.key)} - ${sanitize(project.name)}</option>`
  )).join('')}`;
}

function statusOptions(selected = '') {
  return `<option value="">Todos</option>${dataService.getStatusOptions().map(status => (
    `<option value="${sanitize(status)}" ${status === selected ? 'selected' : ''}>${sanitize(status)}</option>`
  )).join('')}`;
}

function typeOptions(selected = '') {
  const types = [...new Set(dataService.getCards().map(card => card.type).filter(Boolean))].sort();
  return `<option value="">Todos</option>${types.map(type => (
    `<option value="${sanitize(type)}" ${type === selected ? 'selected' : ''}>${sanitize(typeLabel(type))}</option>`
  )).join('')}`;
}

function analystOptions(users, selectedIds = [], { includeEmpty = true } = {}) {
  return `${includeEmpty ? '<option value="">Selecionar profissional</option>' : ''}${users.map(user => (
    `<option value="${sanitize(user.id)}" ${selectedIds.includes(user.id) ? 'selected' : ''}>${sanitize(user.displayName)}</option>`
  )).join('')}`;
}

function renderProfessionalsPicker(users, selectedIds = []) {
  const selectedSet = new Set(selectedIds);
  const selectedUsers = users.filter(user => selectedSet.has(user.id));
  const allSelected = users.length > 0 && selectedUsers.length === users.length;
  const summary = allSelected
    ? 'Todos os profissionais'
    : selectedUsers.length === 0
      ? 'Nenhum selecionado'
      : selectedUsers.length === 1
        ? selectedUsers[0].displayName
        : `${selectedUsers.length} profissionais`;

  return `
    <div class="compact-multi-filter analyst-professionals-filter">
      <span class="filter-label">Profissionais</span>
      <details id="cmp-users-picker" ${comparisonProfessionalsOpen ? 'open' : ''}>
        <summary aria-label="Selecionar profissionais para comparativo">
          <span>${sanitize(summary)}</span>
          <small>${selectedUsers.length}</small>
        </summary>
        <div class="compact-multi-menu analyst-professionals-menu">
          <button type="button" class="compact-multi-clear" id="cmp-users-clear">Limpar seleção</button>
          <label class="compact-multi-all">
            <input type="checkbox" id="cmp-users-all" ${allSelected ? 'checked' : ''}>
            <span>Todos</span>
          </label>
          ${users.map(user => `
            <label title="${sanitizeTitle(user.email || user.displayName)}">
              <input type="checkbox" data-cmp-user value="${sanitize(user.id)}" ${selectedSet.has(user.id) ? 'checked' : ''}>
              <span>${sanitize(user.displayName)}</span>
            </label>
          `).join('')}
        </div>
      </details>
    </div>
  `;
}

function getSharedAnalystId(users) {
  const queryUserId = params().get('userId') || '';
  const storedUserId = localStorage.getItem(SHARED_ANALYST_KEY) || '';
  const userId = queryUserId || storedUserId;
  return users.some(user => user.id === userId) ? userId : '';
}

function persistSharedAnalyst(userId) {
  if (userId) localStorage.setItem(SHARED_ANALYST_KEY, userId);
  else localStorage.removeItem(SHARED_ANALYST_KEY);
}

function baseCards({ userId = '', projectId = '', status = '', type = '', start = '', end = '', includeEpics = false } = {}) {
  return dataService.getCards()
    .filter(card => includeEpics || !isEpic(card))
    .filter(card => !userId || card.assigneeId === userId)
    .filter(card => !projectId || card.projectId === projectId)
    .filter(card => !status || card.status === status)
    .filter(card => !type || card.type === type)
    .filter(card => dateInRange(card.updatedAt || cardEndDate(card), start, end));
}

function calcAnalystMetrics(user, filters = {}) {
  const cards = baseCards({ ...filters, userId: user.id });
  const current = cards.filter(card => resolveStatusCategory(card.status) !== StatusCategory.DONE);
  const done = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE);
  const withDue = cards.filter(card => cardEndDate(card));
  const doneWithDue = done.filter(card => cardEndDate(card));
  const onTime = doneWithDue.filter(card => {
    const resolved = card.resolvedAt ? new Date(card.resolvedAt) : null;
    const due = cardEndDate(card) ? new Date(cardEndDate(card)) : null;
    return resolved && due ? resolved <= due : true;
  });
  const overdue = cards.filter(isCardOverdue);
  const blocked = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED);
  const projects = [...new Set(cards.map(card => card.projectId).filter(Boolean))];
  const noDue = cards.filter(card => !cardEndDate(card));
  const stale = current.filter(card => {
    if (!card.updatedAt) return false;
    return businessDaysLate(card.updatedAt) > 5;
  });
  const commentsAvailable = hasHumanCommentsAvailable();
  const commentedCards = commentsAvailable ? cards.filter(card => {
    const raw = (dataService.getRawJiraData()?.issues || []).find(issue => issue.issue_id === card.id);
    return Number(raw?.human_comment_count || 0) > 0;
  }) : [];
  const commentCoverage = commentsAvailable ? Math.round((commentedCards.length / Math.max(1, cards.length)) * 100) : null;
  const onTimeRate = doneWithDue.length ? Math.round((onTime.length / doneWithDue.length) * 100) : null;
  const delayRate = withDue.length ? Math.round((overdue.length / withDue.length) * 100) : null;
  const blockRate = cards.length ? Math.round((blocked.length / cards.length) * 100) : null;
  const avgLateDays = overdue.length ? Math.round(overdue.reduce((sum, card) => sum + businessDaysLate(cardEndDate(card)), 0) / overdue.length) : 0;
  return {
    user,
    cards,
    current,
    done,
    projects,
    overdue,
    blocked,
    noDue,
    stale,
    onTime,
    onTimeRate,
    delayRate,
    blockRate,
    commentCoverage,
    avgLateDays,
    sampleValid: cards.length >= Number(localStorage.getItem(MIN_SAMPLE_KEY) || 5),
  };
}

function percentLabel(value) {
  return value === null || value === undefined ? 'Nao aplicavel' : `${value}%`;
}

function header(title, subtitle) {
  document.getElementById('page-header').innerHTML = `
    <div>
      <h2>${sanitize(title)}</h2>
      <div class="subtitle">${sanitize(subtitle)}</div>
    </div>
  `;
}

function analystModePath(path, sharedUserId = '') {
  const shouldCarryUser = sharedUserId && (path === '/analysts/general' || path === '/analysts/evolution');
  return `${path}${shouldCarryUser ? `?userId=${encodeURIComponent(sharedUserId)}` : ''}`;
}

function renderModeTabs(mode, sharedUserId = '') {
  return `
    <div class="report-tabs">
      <button class="${mode === 'general' ? 'active' : ''}" onclick="location.hash='#${analystModePath('/analysts/general', sharedUserId)}'">Geral</button>
      <button class="${mode === 'evolution' ? 'active' : ''}" onclick="location.hash='#${analystModePath('/analysts/evolution', sharedUserId)}'">Evolucao</button>
      <button class="${mode === 'comparative' ? 'active' : ''}" onclick="location.hash='#/analysts/comparative'">Comparativo</button>
    </div>
  `;
}

function renderGeneral() {
  const content = document.getElementById('page-content');
  const p = params();
  const users = dataService.getUsersRanked().filter(user => user.id !== 'unassigned');
  const selectedUserId = getSharedAnalystId(users);
  const selectedUser = selectedUserId ? dataService.getUserById(selectedUserId) : null;
  const filters = {
    projectId: p.get('projectId') || '',
    status: p.get('status') || '',
    type: p.get('type') || '',
    start: p.get('start') || '',
    end: p.get('end') || '',
  };
  header('Analistas - Geral', 'Visao individual de atuacao, prazos, bloqueios e carga sem nota unica');
  if (!users.length) {
    content.innerHTML = '<div class="empty-state"><h3>Nenhum analista encontrado</h3></div>';
    return;
  }
  const m = selectedUser ? calcAnalystMetrics(selectedUser, filters) : null;
  const selectedIds = selectedUser ? [selectedUser.id] : [];
  if (selectedUserId) persistSharedAnalyst(selectedUserId);

  content.innerHTML = `
    <div class="report-page">
      ${renderModeTabs('general', selectedUserId)}
      <div class="report-toolbar analyst-general-toolbar">
        <label>Profissional<select id="analyst-user">${analystOptions(users, selectedIds)}</select></label>
        <label>Projeto<select id="analyst-project">${projectOptions(filters.projectId)}</select></label>
        <label>Inicio<input id="analyst-start" type="date" value="${sanitize(filters.start)}"></label>
        <label>Fim<input id="analyst-end" type="date" value="${sanitize(filters.end)}"></label>
        <label>Status<select id="analyst-status">${statusOptions(filters.status)}</select></label>
        <label>Tipo<select id="analyst-type">${typeOptions(filters.type)}</select></label>
        <button class="btn btn-secondary" id="analyst-clear">Limpar filtros</button>
        <button class="btn btn-secondary" id="analyst-export" ${selectedUser ? '' : 'disabled'}>Excel</button>
      </div>

      ${!selectedUser ? '<div class="empty-state"><h3>Selecione um profissional para visualizar os indicadores individuais.</h3></div>' : `
      ${!hasHumanCommentsAvailable() ? '<div class="report-alert warning">Comentarios e historico de alteracoes ainda nao estao sincronizados. Indicadores historicos usam responsavel atual, status atual e datas disponiveis.</div>' : ''}

      <section class="analyst-profile-panel">
        <img src="${sanitizeTitle(selectedUser.avatarUrl || '')}" onerror="this.style.display='none'" alt="${sanitizeTitle(selectedUser.displayName)}">
        <div>
          <h3>${sanitize(selectedUser.displayName)}</h3>
          <p>${sanitize(selectedUser.email || 'Email nao informado')}</p>
          <span>Periodo analisado: ${filters.start ? formatDate(filters.start) : 'inicio da base'} a ${filters.end ? formatDate(filters.end) : 'hoje'}</span>
        </div>
      </section>

      <div class="kpi-grid analyst-kpi-grid">
        <div class="kpi-card">${businessHelp('Regra: projetos em atuação', 'Quantidade de projetos que possuem cards atribuídos ao profissional no período analisado.')}<div class="kpi-value">${m.projects.length}</div><div class="kpi-label">Projetos em atuacao</div></div>
        <div class="kpi-card">${businessHelp('Regra: cards sob responsabilidade', 'Cards atuais atribuídos ao profissional, excluindo os que estão concluídos.')}<div class="kpi-value">${m.current.length}</div><div class="kpi-label">Cards sob responsabilidade</div></div>
        <div class="kpi-card kpi-success">${businessHelp('Regra: cards concluídos', 'Cards do profissional classificados como Concluído.')}<div class="kpi-value">${m.done.length}</div><div class="kpi-label">Cards concluidos</div></div>
        <div class="kpi-card">${businessHelp('Regra: entregas no prazo', 'Percentual de cards concluídos com data de entrega e resolução até o prazo.')}<div class="kpi-value">${percentLabel(m.onTimeRate)}</div><div class="kpi-label">Entregas no prazo</div></div>
        <div class="kpi-card kpi-danger">${businessHelp('Regra: cards atrasados', 'Cards com data vencida que ainda não foram concluídos.')}<div class="kpi-value">${m.overdue.length}</div><div class="kpi-label">Cards atrasados</div><div class="kpi-trend">${m.avgLateDays} dias uteis em media</div></div>
        <div class="kpi-card kpi-warning">${businessHelp('Regra: cards bloqueados', 'Cards classificados como Bloqueado no mapa de status normalizado.')}<div class="kpi-value">${m.blocked.length}</div><div class="kpi-label">Cards bloqueados</div></div>
        <div class="kpi-card">${businessHelp('Regra: cobertura de comentários', 'Percentual de cards com pelo menos um comentário humano, quando os comentários estão disponíveis.')}<div class="kpi-value">${percentLabel(m.commentCoverage)}</div><div class="kpi-label">Cobertura comentarios</div></div>
        <div class="kpi-card">${businessHelp('Regra: sem atualização recente', 'Cards em aberto cuja última atualização ocorreu há mais de cinco dias úteis.')}<div class="kpi-value">${m.stale.length}</div><div class="kpi-label">Sem atualizacao recente</div></div>
      </div>

      <section class="report-section">
        <h3>Projetos em atuacao</h3>
        <div class="mini-bars">
          ${m.projects.map(projectId => {
            const project = dataService.getProjectById(projectId);
            const cards = m.cards.filter(card => card.projectId === projectId);
            const done = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length;
            return `<div><span>${sanitize(project?.key || projectId)}</span><strong>${cards.length} cards</strong><em style="width:${Math.round((done / Math.max(1, cards.length)) * 100)}%"></em></div>`;
          }).join('') || '<p class="muted">Sem projetos no filtro atual.</p>'}
        </div>
      </section>

      <section class="report-section">
        <h3>Detalhamento dos cards usados nos calculos</h3>
        ${cardsTable(m.cards.slice(0, 250))}
      </section>
      `}
    </div>
  `;
  bindGeneral(selectedUser);
}

function cardsTable(cards) {
  return `
    <div class="table-container">
      <table class="data-table">
        <thead><tr><th>Card</th><th>Projeto</th><th>Tipo</th><th>Status</th><th>Data limite</th><th>Atualizado</th><th>Situacao</th></tr></thead>
        <tbody>
          ${cards.map(card => {
            const project = dataService.getProjectById(card.projectId);
            const category = resolveStatusCategory(card.status);
            return `
              <tr>
                <td><a href="${sanitize(card.jiraUrl || '#')}" target="_blank" rel="noopener noreferrer">${sanitize(card.key)}</a><br><span class="muted">${sanitize(card.title)}</span></td>
                <td>${sanitize(project?.key || card.projectId)}</td>
                <td>${sanitize(typeLabel(card.type))}</td>
                <td><span class="badge badge-${sanitize(category)}">${sanitize(card.status)}</span></td>
                <td>${formatDate(cardEndDate(card))}</td>
                <td>${formatDate(card.updatedAt)}</td>
                <td>${isCardOverdue(card) ? '<span class="badge badge-overdue">Atrasado</span>' : '<span class="badge badge-type">Atual</span>'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function updateHash(path, values) {
  const clean = Object.fromEntries(Object.entries(values).filter(([, value]) => value));
  const query = new URLSearchParams(clean).toString();
  window.location.hash = `${path}${query ? `?${query}` : ''}`;
}

function bindGeneral(selectedUser) {
  const apply = () => updateHash('/analysts/general', {
    userId: document.getElementById('analyst-user')?.value || '',
    projectId: document.getElementById('analyst-project')?.value || '',
    start: document.getElementById('analyst-start')?.value || '',
    end: document.getElementById('analyst-end')?.value || '',
    status: document.getElementById('analyst-status')?.value || '',
    type: document.getElementById('analyst-type')?.value || '',
  });
  document.getElementById('analyst-user')?.addEventListener('change', event => {
    persistSharedAnalyst(event.target.value);
    apply();
  });
  ['analyst-user', 'analyst-project', 'analyst-start', 'analyst-end', 'analyst-status', 'analyst-type'].forEach(id => {
    if (id === 'analyst-user') return;
    document.getElementById(id)?.addEventListener('change', apply);
  });
  document.getElementById('analyst-clear')?.addEventListener('click', () => {
    persistSharedAnalyst('');
    updateHash('/analysts/general', {});
  });
  document.getElementById('analyst-export')?.addEventListener('click', () => {
    if (selectedUser) exportAnalystGeneral(selectedUser);
  });
}

function renderComparative() {
  const content = document.getElementById('page-content');
  const p = params();
  const users = dataService.getUsersRanked().filter(user => user.id !== 'unassigned');
  const selectedIds = p.has('users')
    ? (p.get('users') || '').split(',').filter(Boolean)
    : users.map(user => user.id);
  const filters = {
    projectId: p.get('projectId') || '',
    start: p.get('start') || '',
    end: p.get('end') || '',
  };
  const view = p.get('view') || 'absolute';
  const sortBy = p.get('sort') || 'worked';
  const minSample = Number(localStorage.getItem(MIN_SAMPLE_KEY) || 5);
  header('Analistas - Comparativo', 'Comparacao estatistica sem ranking geral e sem nota unica');

  let rows = selectedIds.map(id => dataService.getUserById(id)).filter(Boolean).map(user => calcAnalystMetrics(user, filters));
  rows.sort((a, b) => valueForSort(b, sortBy) - valueForSort(a, sortBy));
  const validRows = rows.filter(row => row.sampleValid);
  const groupDone = rows.reduce((sum, row) => sum + row.done.length, 0);
  const groupWorked = rows.reduce((sum, row) => sum + row.cards.length, 0);
  const avgOnTime = average(validRows.map(row => row.onTimeRate).filter(value => value !== null));
  const medianOnTime = median(validRows.map(row => row.onTimeRate).filter(value => value !== null));

  content.innerHTML = `
    <div class="report-page">
      ${renderModeTabs('comparative')}
      <div class="report-toolbar analyst-comparison-toolbar">
        ${renderProfessionalsPicker(users, selectedIds)}
        <label>Projeto<select id="cmp-project">${projectOptions(filters.projectId)}</select></label>
        <label>Inicio<input id="cmp-start" type="date" value="${sanitize(filters.start)}"></label>
        <label>Fim<input id="cmp-end" type="date" value="${sanitize(filters.end)}"></label>
        <label>Visualizacao<select id="cmp-view"><option value="absolute" ${view === 'absolute' ? 'selected' : ''}>Valores absolutos</option><option value="percent" ${view === 'percent' ? 'selected' : ''}>Percentuais</option><option value="normalized" ${view === 'normalized' ? 'selected' : ''}>Indicadores normalizados</option></select></label>
        <label>Amostra minima<input id="cmp-min" type="number" min="1" value="${minSample}"></label>
        <button class="btn btn-secondary" id="cmp-export">Excel</button>
      </div>

      ${rows.length < 2 ? '<div class="empty-state"><h3>Selecione dois ou mais profissionais para iniciar a comparacao.</h3></div>' : `
        <div class="report-alert info">A tela nao gera ranking geral. Indicadores com menor valor favoravel: atraso, bloqueio, alteracao de prazo e sem atualizacao recente.</div>
        ${!hasHumanCommentsAvailable() ? '<div class="report-alert warning">Comentarios e historico de responsaveis nao estao sincronizados; metricas usam responsavel atual e dados estruturados.</div>' : ''}
        <div class="kpi-grid analyst-kpi-grid">
          <div class="kpi-card">${businessHelp('Regra: profissionais', 'Quantidade de profissionais selecionados para comparação.')}<div class="kpi-value">${rows.length}</div><div class="kpi-label">Profissionais</div></div>
          <div class="kpi-card">${businessHelp('Regra: projetos', 'Quantidade de projetos distintos presentes nos cards dos profissionais selecionados.')}<div class="kpi-value">${new Set(rows.flatMap(row => row.projects)).size}</div><div class="kpi-label">Projetos</div></div>
          <div class="kpi-card">${businessHelp('Regra: cards trabalhados', 'Cards vinculados aos profissionais selecionados dentro dos filtros atuais.')}<div class="kpi-value">${groupWorked}</div><div class="kpi-label">Cards trabalhados</div></div>
          <div class="kpi-card kpi-success">${businessHelp('Regra: cards concluídos', 'Soma dos cards classificados como Concluído para os profissionais selecionados.')}<div class="kpi-value">${groupDone}</div><div class="kpi-label">Cards concluidos</div></div>
          <div class="kpi-card">${businessHelp('Regra: média de prazo', 'Média dos percentuais individuais de entregas concluídas dentro do prazo.')}<div class="kpi-value">${percentLabel(avgOnTime)}</div><div class="kpi-label">Media prazo individual</div></div>
          <div class="kpi-card">${businessHelp('Regra: mediana de prazo', 'Valor central dos percentuais individuais de entregas concluídas dentro do prazo.')}<div class="kpi-value">${percentLabel(medianOnTime)}</div><div class="kpi-label">Mediana prazo</div></div>
        </div>
        <section class="report-section">
          <h3>Graficos comparativos</h3>
          <div class="comparison-bars">
            ${rows.map((row, index) => `
              <div style="--bar:${Math.min(100, displayMetric(row, view))}%;--color:${colorForIndex(index)}">
                <span>${sanitize(row.user.displayName)}</span>
                <em><i></i></em>
                <strong>${displayMetricLabel(row, view)}</strong>
              </div>
            `).join('')}
          </div>
        </section>
        <section class="report-section">
          <h3>Matriz comparativa</h3>
          <div class="table-container">
            <table class="data-table comparison-table">
              <thead><tr>
                <th>Profissional</th>
                <th><button class="table-sort" data-sort="projects">Projetos</button></th>
                <th><button class="table-sort" data-sort="worked">Trabalhados</button></th>
                <th><button class="table-sort" data-sort="current">Atuais</button></th>
                <th><button class="table-sort" data-sort="done">Concluidos</button></th>
                <th><button class="table-sort" data-sort="onTimeRate">No prazo</button></th>
                <th><button class="table-sort" data-sort="blockRate">Taxa bloqueio</button></th>
                <th><button class="table-sort" data-sort="commentCoverage">Comentarios</button></th>
                <th><button class="table-sort" data-sort="delayRate">Taxa atraso</button></th>
                <th>Amostra</th>
              </tr></thead>
              <tbody>
                ${rows.map(row => `
                  <tr>
                    <td class="sticky-col"><strong>${sanitize(row.user.displayName)}</strong><br><span class="muted">${sanitize(row.user.email || '')}</span></td>
                    <td>${row.projects.length}</td>
                    <td>${row.cards.length}</td>
                    <td>${row.current.length}</td>
                    <td>${row.done.length}</td>
                    <td title="${row.onTime.length} de ${row.done.length} cards concluidos com prazo">${percentLabel(row.onTimeRate)}</td>
                    <td title="${row.blocked.length} de ${row.cards.length} cards trabalhados">${percentLabel(row.blockRate)}</td>
                    <td>${percentLabel(row.commentCoverage)}</td>
                    <td title="${row.overdue.length} de ${row.cards.filter(card => cardEndDate(card)).length} cards com prazo">${percentLabel(row.delayRate)}</td>
                    <td><span class="badge ${row.sampleValid ? 'badge-done' : 'badge-warning'}">${row.sampleValid ? 'Valida' : 'Amostra reduzida'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `}
    </div>
  `;
  bindComparative(selectedIds, filters, view);
}

function valueForSort(row, sortBy) {
  const map = {
    projects: row.projects.length,
    worked: row.cards.length,
    current: row.current.length,
    done: row.done.length,
    onTimeRate: row.onTimeRate ?? -1,
    blockRate: row.blockRate ?? -1,
    commentCoverage: row.commentCoverage ?? -1,
    delayRate: row.delayRate ?? -1,
  };
  return map[sortBy] ?? row.cards.length;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function displayMetric(row, view) {
  if (view === 'percent') return row.onTimeRate ?? 0;
  if (view === 'normalized') return row.cards.length ? Math.round((row.done.length / row.cards.length) * 100) : 0;
  return row.done.length;
}

function displayMetricLabel(row, view) {
  if (view === 'percent') return percentLabel(row.onTimeRate);
  if (view === 'normalized') return `${displayMetric(row, view)}% normalizado`;
  return `${row.done.length} concluidos`;
}

function colorForIndex(index) {
  return ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#14b8a6', '#f97316'][index % 8];
}

function bindComparative(selectedIds, filters, view) {
  const apply = () => {
    const users = [...document.querySelectorAll('[data-cmp-user]:checked')].map(option => option.value);
    localStorage.setItem(MIN_SAMPLE_KEY, document.getElementById('cmp-min')?.value || '5');
    updateHash('/analysts/comparative', {
      users: users.join(','),
      projectId: document.getElementById('cmp-project')?.value || '',
      start: document.getElementById('cmp-start')?.value || '',
      end: document.getElementById('cmp-end')?.value || '',
      view: document.getElementById('cmp-view')?.value || view,
      sort: params().get('sort') || '',
    });
  };
  const users = dataService.getUsersRanked().filter(user => user.id !== 'unassigned');
  document.getElementById('cmp-users-picker')?.addEventListener('toggle', event => {
    comparisonProfessionalsOpen = event.target.open;
  });
  document.getElementById('cmp-users-all')?.addEventListener('change', event => {
    document.querySelectorAll('[data-cmp-user]').forEach(input => {
      input.checked = event.target.checked;
    });
    apply();
  });
  document.getElementById('cmp-users-clear')?.addEventListener('click', () => {
    document.querySelectorAll('[data-cmp-user]').forEach(input => {
      input.checked = false;
    });
    apply();
  });
  document.querySelectorAll('[data-cmp-user]').forEach(input => {
    input.addEventListener('change', () => {
      const selectedCount = document.querySelectorAll('[data-cmp-user]:checked').length;
      const allInput = document.getElementById('cmp-users-all');
      if (allInput) allInput.checked = users.length > 0 && selectedCount === users.length;
      apply();
    });
  });
  ['cmp-project', 'cmp-start', 'cmp-end', 'cmp-view', 'cmp-min'].forEach(id => document.getElementById(id)?.addEventListener('change', apply));
  document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => updateHash('/analysts/comparative', { ...filters, users: selectedIds.join(','), view, sort: button.dataset.sort })));
  document.getElementById('cmp-export')?.addEventListener('click', () => exportComparison(selectedIds, filters));
}

function renderEvolution() {
  const content = document.getElementById('page-content');
  const p = params();
  const users = dataService.getUsersRanked().filter(user => user.id !== 'unassigned');
  const selectedUserId = getSharedAnalystId(users);
  const selectedUser = selectedUserId ? dataService.getUserById(selectedUserId) : null;
  const end = p.get('end') || new Date().toISOString().slice(0, 10);
  const start = p.get('start') || (() => {
    const date = new Date(end);
    date.setDate(date.getDate() - 60);
    return date.toISOString().slice(0, 10);
  })();
  const grouping = p.get('grouping') || 'month';
  const filters = { projectId: p.get('projectId') || '', start, end };
  header('Analistas - Evolucao', 'Historico de indicadores por periodo sem nota geral');
  if (!users.length) {
    content.innerHTML = '<div class="empty-state"><h3>Nenhum analista encontrado</h3></div>';
    return;
  }
  const selectedIds = selectedUser ? [selectedUser.id] : [];
  if (selectedUserId) persistSharedAnalyst(selectedUserId);

  const current = selectedUser ? calcAnalystMetrics(selectedUser, filters) : null;
  const previousRange = previousPeriod(start, end);
  const previous = selectedUser ? calcAnalystMetrics(selectedUser, { ...filters, start: previousRange.start, end: previousRange.end }) : null;
  const indicators = [
    evolutionItem('Cards concluidos', previous?.done.length, current?.done.length, 'up'),
    evolutionItem('Entregas no prazo', previous?.onTimeRate, current?.onTimeRate, 'up', true),
    evolutionItem('Taxa de atraso', previous?.delayRate, current?.delayRate, 'down', true),
    evolutionItem('Cards bloqueados', previous?.blocked.length, current?.blocked.length, 'info'),
    evolutionItem('Cobertura comentarios', previous?.commentCoverage, current?.commentCoverage, 'up', true),
    evolutionItem('Sem atualizacao recente', previous?.stale.length, current?.stale.length, 'down'),
  ];
  const buckets = selectedUser ? buildBuckets(current.cards, grouping, start, end) : [];

  content.innerHTML = `
    <div class="report-page">
      ${renderModeTabs('evolution', selectedUserId)}
      <div class="report-toolbar analyst-evolution-toolbar">
        <label>Profissional<select id="evo-user">${analystOptions(users, selectedIds)}</select></label>
        <label>Inicio<input id="evo-start" type="date" value="${sanitize(start)}"></label>
        <label>Fim<input id="evo-end" type="date" value="${sanitize(end)}"></label>
        <label>Agrupamento<select id="evo-grouping"><option value="week" ${grouping === 'week' ? 'selected' : ''}>Semana</option><option value="month" ${grouping === 'month' ? 'selected' : ''}>Mes</option><option value="quarter" ${grouping === 'quarter' ? 'selected' : ''}>Trimestre</option></select></label>
        <label>Projeto<select id="evo-project">${projectOptions(filters.projectId)}</select></label>
        <button class="btn btn-secondary" id="evo-export" ${selectedUser ? '' : 'disabled'}>Excel</button>
      </div>

      ${!selectedUser ? '<div class="empty-state"><h3>Selecione um profissional para visualizar a evolução.</h3></div>' : `
      <div class="kpi-grid analyst-kpi-grid">
        <div class="kpi-card">${businessHelp('Regra: profissional', 'Identifica o profissional selecionado para a análise histórica.')}<div class="kpi-value">${sanitize(selectedUser.displayName)}</div><div class="kpi-label">Profissional</div></div>
        <div class="kpi-card">${businessHelp('Regra: evoluções positivas', 'Quantidade de indicadores cuja variação em relação ao período anterior foi favorável.')}<div class="kpi-value">${indicators.filter(item => item.className === 'positive').length}</div><div class="kpi-label">Evolucoes positivas</div></div>
        <div class="kpi-card kpi-warning">${businessHelp('Regra: pontos de atenção', 'Quantidade de indicadores cuja variação em relação ao período anterior exige atenção.')}<div class="kpi-value">${indicators.filter(item => item.className === 'negative').length}</div><div class="kpi-label">Pontos de atencao</div></div>
        <div class="kpi-card">${businessHelp('Regra: indicadores estáveis', 'Quantidade de indicadores sem variação relevante no período selecionado.')}<div class="kpi-value">${indicators.filter(item => item.className === 'stable').length}</div><div class="kpi-label">Estaveis</div></div>
      </div>

      ${!hasHumanCommentsAvailable() ? '<div class="report-alert warning">Comentarios e historico de alteracoes nao estao sincronizados. Evolucao calculada com datas e status disponiveis.</div>' : ''}

      <section class="report-section">
        <h3>Indicadores de evolucao</h3>
        <div class="evolution-grid">
          ${indicators.map(item => `
            <article class="evolution-card ${item.className}">
              <span>${sanitize(item.name)}</span>
              <strong>${item.isPercent ? percentLabel(item.current) : item.current ?? 'Nao aplicavel'}</strong>
              <p>Anterior: ${item.isPercent ? percentLabel(item.previous) : item.previous ?? 'Nao aplicavel'} · Diferenca: ${item.deltaLabel}</p>
              <em>${sanitize(item.label)}</em>
            </article>
          `).join('')}
        </div>
      </section>

      <section class="report-section">
        <h3>Grafico de evolucao</h3>
        ${renderLineChart(buckets)}
      </section>

      <section class="report-section">
        <h3>Tabela por intervalo</h3>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Periodo</th><th>Cards atualizados</th><th>Concluidos</th><th>Atrasados atuais</th><th>Bloqueados</th><th>Projetos</th></tr></thead>
            <tbody>${buckets.map(bucket => `<tr><td>${sanitize(bucket.label)}</td><td>${bucket.cards.length}</td><td>${bucket.done}</td><td>${bucket.overdue}</td><td>${bucket.blocked}</td><td>${bucket.projects}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
      `}
    </div>
  `;
  bindEvolution(selectedUser, filters, grouping);
}

function previousPeriod(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const previousEnd = new Date(s);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

function evolutionItem(name, previous, current, direction = 'up', isPercent = false) {
  if (previous === null || previous === undefined || current === null || current === undefined) {
    return { name, previous, current, isPercent, deltaLabel: 'Nao calculavel', className: 'attention', label: 'Amostra insuficiente' };
  }
  const delta = current - previous;
  const favorable = direction === 'info' ? null : direction === 'up' ? delta > 0 : delta < 0;
  const className = delta === 0 ? 'stable' : favorable === null ? 'info' : favorable ? 'positive' : 'negative';
  const label = className === 'positive' ? 'Evolucao positiva' : className === 'negative' ? 'Evolucao negativa' : className === 'stable' ? 'Estavel' : 'Informativo';
  return { name, previous, current, isPercent, deltaLabel: `${delta > 0 ? '+' : ''}${delta}${isPercent ? ' p.p.' : ''}`, className, label };
}

function bucketLabel(date, grouping) {
  const d = new Date(date);
  if (grouping === 'week') {
    const first = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - first) / 86400000) + first.getDay() + 1) / 7);
    return `${d.getFullYear()}-S${String(week).padStart(2, '0')}`;
  }
  if (grouping === 'quarter') return `${d.getFullYear()}-T${Math.floor(d.getMonth() / 3) + 1}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildBuckets(cards, grouping, start, end) {
  const map = new Map();
  cards.forEach(card => {
    const date = card.resolvedAt || card.updatedAt || cardEndDate(card);
    if (!dateInRange(date, start, end)) return;
    const label = bucketLabel(date, grouping);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(card);
  });
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, bucketCards]) => ({
    label,
    cards: bucketCards,
    done: bucketCards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length,
    overdue: bucketCards.filter(isCardOverdue).length,
    blocked: bucketCards.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length,
    projects: new Set(bucketCards.map(card => card.projectId)).size,
  }));
}

function renderLineChart(buckets) {
  if (!buckets.length) return '<div class="empty-state"><h3>Sem dados no periodo</h3></div>';
  const max = Math.max(...buckets.flatMap(bucket => [bucket.cards.length, bucket.done, bucket.overdue, bucket.blocked]), 1);
  return `
    <div class="evolution-chart evolution-bar-chart" role="img" aria-label="Evolucao por periodo">
      <div class="evolution-chart-head">
        <span>Periodo</span>
        <span>Cards atualizados</span>
        <span>Concluidos</span>
        <span>Alertas</span>
      </div>
      <div class="evolution-chart-rows">
        ${buckets.map(bucket => `
          <div class="evolution-chart-row">
            <strong>${sanitize(bucket.label)}</strong>
            <div class="evolution-series primary">
              <em style="width:${Math.max(4, Math.round((bucket.cards.length / max) * 100))}%"></em>
              <span>${bucket.cards.length}</span>
            </div>
            <div class="evolution-series success">
              <em style="width:${Math.max(4, Math.round((bucket.done / max) * 100))}%"></em>
              <span>${bucket.done}</span>
            </div>
            <div class="evolution-alerts">
              <span>${bucket.overdue} atrasados</span>
              <span>${bucket.blocked} bloqueados</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bindEvolution(selectedUser, filters, grouping) {
  const apply = () => updateHash('/analysts/evolution', {
    userId: document.getElementById('evo-user')?.value || '',
    start: document.getElementById('evo-start')?.value || filters.start,
    end: document.getElementById('evo-end')?.value || filters.end,
    grouping: document.getElementById('evo-grouping')?.value || grouping,
    projectId: document.getElementById('evo-project')?.value || '',
  });
  document.getElementById('evo-user')?.addEventListener('change', event => {
    persistSharedAnalyst(event.target.value);
    apply();
  });
  ['evo-user', 'evo-start', 'evo-end', 'evo-grouping', 'evo-project'].forEach(id => {
    if (id === 'evo-user') return;
    document.getElementById(id)?.addEventListener('change', apply);
  });
  document.getElementById('evo-export')?.addEventListener('click', () => {
    if (selectedUser) exportEvolution(selectedUser, filters, grouping);
  });
}

async function exportAnalystGeneral(user) {
  const metrics = calcAnalystMetrics(user, Object.fromEntries(params()));
  await exportRowsWorkbook([
    {
      name: 'Resumo',
      rows: [{
        profissional: user.displayName,
        cards: metrics.cards.length,
        concluidos: metrics.done.length,
        atrasados: metrics.overdue.length,
        bloqueados: metrics.blocked.length,
        cobertura_comentarios: percentLabel(metrics.commentCoverage),
      }],
    },
    {
      name: 'Cards',
      rows: metrics.cards.map(card => ({
        card: card.key,
        titulo: card.title,
        projeto: dataService.getProjectById(card.projectId)?.key || '',
        status: card.status,
        data_limite: cardEndDate(card) || '',
        jira: card.jiraUrl || '',
      })),
    },
  ], `analista_geral_${user.displayName.replace(/\s+/g, '_')}.xlsx`);
}

async function exportComparison(userIds, filters) {
  const rows = userIds.map(id => dataService.getUserById(id)).filter(Boolean).map(user => calcAnalystMetrics(user, filters));
  await exportRowsWorkbook([
    {
      name: 'Matriz',
      rows: rows.map(row => ({
        profissional: row.user.displayName,
        projetos: row.projects.length,
        cards_trabalhados: row.cards.length,
        cards_atuais: row.current.length,
        concluidos: row.done.length,
        entregas_no_prazo: percentLabel(row.onTimeRate),
        taxa_bloqueio: percentLabel(row.blockRate),
        cobertura_comentarios: percentLabel(row.commentCoverage),
        taxa_atraso: percentLabel(row.delayRate),
        amostra: row.sampleValid ? 'Valida' : 'Amostra reduzida',
      })),
    },
    {
      name: 'Formulas',
      rows: [{
        regra: 'Sem nota unica e sem ranking geral. Amostras reduzidas permanecem visiveis.',
        amostra_minima: localStorage.getItem(MIN_SAMPLE_KEY) || 5,
      }],
    },
  ], `analistas_comparativo_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportEvolution(user, filters, grouping) {
  const metrics = calcAnalystMetrics(user, filters);
  const buckets = buildBuckets(metrics.cards, grouping, filters.start, filters.end);
  await exportRowsWorkbook([
    { name: 'Evolucao', rows: buckets }
  ], `analista_evolucao_${user.displayName.replace(/\s+/g, '_')}.xlsx`);
}

export function renderAnalysts() {
  const mode = routeMode();
  if (mode === 'comparative') return renderComparative();
  if (mode === 'evolution') return renderEvolution();
  return renderGeneral();
}
