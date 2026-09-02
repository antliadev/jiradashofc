/**
 * project-reports.js — Relatorios gerenciais e saude dos cards por projeto.
 */
import { dataService } from '../data/data-service.js';
import { isCardOverdue, resolveStatusCategory, StatusCategory } from '../data/models.js';
import { formatDate, formatDateTime, getJiraIssueUrl, sanitize, sanitizeUrl, typeLabel } from '../utils/helpers.js';
import { exportRowsWorkbook } from '../utils/excel-export.js';
import { businessHelp, showToast } from '../utils/ui-feedback.js';
import { calculateCardImpact, calculateProjectHealth, DEFAULT_HEALTH_CONFIG } from '../data/project-health.js';
import { filterHealthRows, syncHealthProject } from '../utils/health-list.js';

const HEALTH_MIN_KEY = 'rja.projectHealth.minimumPercent';
const REPORT_CONFIG_KEY = 'rja.clientReport.config';
const HEALTH_PAGE_SIZE_KEY = 'rja.projectHealth.pageSize';
const HEALTH_PAGE_SIZES = [10, 25, 50, 100];
let healthPageSize = 25;
let healthPage = 1;
let healthSearch = '';
let healthStatusFilter = '';
let healthRiskFilter = '';
let healthAssigneeFilter = '';
let healthSort = 'risk';
let healthSortDirection = 'desc';
let healthRefreshing = false;
let healthActiveProject = null;

function pct(value, total) {
  if (!total) return null;
  return Math.round((value / total) * 100);
}

function pctLabel(value) {
  return value === null || value === undefined ? 'Nao calculavel' : `${value}%`;
}

function cardEndDate(card) {
  return card.plannedEndDate || card.dueDate || null;
}

function cardStartDate(card) {
  return card.plannedStartDate || card.startDate || cardEndDate(card);
}

function isEpic(card) {
  return card.type === 'epic';
}

function isCanceled(card) {
  return String(card.status || '').toLowerCase().includes('cancel');
}

function getRawIssue(card) {
  const rawIssues = dataService.getRawJiraData()?.issues || [];
  return rawIssues.find(issue => issue.issue_id === card.id || issue.issue_key === card.key) || {};
}

function rawTypeLabel(card) {
  return getRawIssue(card).type_name || typeLabel(card.type);
}

function getProjectFromState() {
  const projects = dataService.getProjects();
  const params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
  const requestedKey = params.get('projectKey');
  return dataService.getProjectByKey(requestedKey) || projects[0] || null;
}

function projectOptions(selectedId, { exclude = [] } = {}) {
  return dataService.getProjects().filter(project => !exclude.includes(project.key.toUpperCase())).map(project => (
    `<option value="${sanitize(project.id)}" ${project.id === selectedId ? 'selected' : ''}>${sanitize(project.key)} - ${sanitize(project.name)}</option>`
  )).join('');
}

function cardsForProject(projectId, { includeEpics = true } = {}) {
  return dataService.getCardsByProject(projectId)
    .filter(card => includeEpics || !isEpic(card))
    .filter(card => !isCanceled(card));
}

function getEpicChildren(epic, projectCards) {
  return projectCards.filter(card => card.id !== epic.id && (card.parentKey === epic.key || card.epicKey === epic.key));
}

function summarizeEpic(epic, projectCards) {
  const children = getEpicChildren(epic, projectCards).filter(card => !isCanceled(card));
  const done = children.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length;
  const blocked = children.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length;
  const overdue = children.filter(card => isCardOverdue(card)).length;
  const starts = children.map(cardStartDate).filter(Boolean).map(value => new Date(value));
  const ends = children.map(cardEndDate).filter(Boolean).map(value => new Date(value));
  const progress = pct(done, children.length) || 0;
  const forecast = ends.length ? new Date(Math.max(...ends.map(date => date.getTime()))).toISOString() : null;
  const original = epic.dueDate || cardEndDate(epic) || forecast;
  const status = resolveStatusCategory(epic.status);
  const situation = status === StatusCategory.DONE || progress === 100
    ? 'Atividades Antlia concluidas'
    : blocked || overdue
      ? (overdue ? 'Atrasado' : 'Bloqueado')
      : status === StatusCategory.IN_PROGRESS
        ? 'Em andamento'
        : 'Pendente';

  return {
    epic,
    children,
    done,
    blocked,
    overdue,
    progress,
    forecast,
    original,
    start: starts.length ? new Date(Math.min(...starts.map(date => date.getTime()))).toISOString() : null,
    situation,
  };
}

function reportConfig(projectKey) {
  try {
    const all = JSON.parse(localStorage.getItem(REPORT_CONFIG_KEY) || '{}');
    return all[projectKey] || {};
  } catch {
    return {};
  }
}

function saveReportConfig(projectKey, config) {
  const all = JSON.parse(localStorage.getItem(REPORT_CONFIG_KEY) || '{}');
  all[projectKey] = { ...all[projectKey], ...config, updatedAt: new Date().toISOString() };
  localStorage.setItem(REPORT_CONFIG_KEY, JSON.stringify(all));
}

function renderHeader(title, subtitle) {
  const header = document.getElementById('page-header');
  header.innerHTML = `
    <div>
      <h2>${sanitize(title)}</h2>
      <div class="subtitle">${sanitize(subtitle)}</div>
    </div>
  `;
}

function renderExecutiveReport() {
  const content = document.getElementById('page-content');
  const project = getProjectFromState();
  renderHeader('Relatorio Gerencial - Clientes', 'Pre-visualizacao executiva por epicos, prazos e bloqueios');
  if (!project) {
    content.innerHTML = '<div class="empty-state"><h3>Sem projetos carregados</h3><p>Sincronize os dados para gerar o relatorio.</p></div>';
    return;
  }

  const projectCards = cardsForProject(project.id);
  const epics = projectCards.filter(isEpic).map(epic => summarizeEpic(epic, projectCards));
  const selectedConfig = reportConfig(project.key);
  const selectedEpicKeys = selectedConfig.selectedEpicKeys || epics.map(item => item.epic.key);
  const visibleEpics = epics.filter(item => selectedEpicKeys.includes(item.epic.key));
  const doneCards = projectCards.filter(card => !isEpic(card) && resolveStatusCategory(card.status) === StatusCategory.DONE).length;
  const totalCards = projectCards.filter(card => !isEpic(card)).length;
  const blockedCards = projectCards.filter(card => !isEpic(card) && resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length;
  const overdueCards = projectCards.filter(card => !isEpic(card) && isCardOverdue(card)).length;
  const progress = pct(doneCards, totalCards) || 0;
  const forecastDates = visibleEpics.map(item => item.forecast).filter(Boolean).map(value => new Date(value));
  const antliaForecast = forecastDates.length ? new Date(Math.max(...forecastDates.map(date => date.getTime()))).toISOString() : null;

  content.innerHTML = `
    <div class="report-page">
      <div class="report-toolbar">
        <label>Projeto<select id="report-project">${projectOptions(project.id)}</select></label>
        <label>Titulo<input id="report-title" value="${sanitize(selectedConfig.title || 'Relatorio Gerencial')}"></label>
        <label>Cliente<input id="report-client" value="${sanitize(selectedConfig.client || project.name.split('-')[0]?.trim() || project.name)}"></label>
        <label>Data de referencia<input id="report-date" type="date" value="${sanitize(selectedConfig.referenceDate || new Date().toISOString().slice(0, 10))}"></label>
        <button class="btn btn-primary" id="save-report-config">Salvar configuracao</button>
        <button class="btn btn-secondary" id="export-report-png">PNG</button>
        <button class="btn btn-secondary" id="export-report-pdf">PDF</button>
      </div>

      <section class="client-slide" id="client-report-export">
        <div class="client-slide-header">
          <div>
            <h1>${sanitize(selectedConfig.title || 'Relatorio Gerencial')}</h1>
            <p>${sanitize(selectedConfig.subtitle || 'Acompanhamento executivo das atividades sob responsabilidade da Antlia')}</p>
          </div>
          <div>
            <strong>${sanitize(selectedConfig.client || project.name)}</strong>
            <span>${sanitize(project.key)} - ${sanitize(project.name)}</span>
            <span>Referencia: ${formatDate(selectedConfig.referenceDate || new Date().toISOString())}</span>
            <span>Atualizado: ${formatDateTime(dataService.getSyncMetadata().lastSyncedAt)}</span>
          </div>
        </div>

        <div class="report-kpis">
          <div><strong>${progress}%</strong><span>Progresso Antlia</span></div>
          <div><strong>${epics.length}</strong><span>Epicos</span></div>
          <div><strong>${doneCards}/${totalCards}</strong><span>Cards concluidos</span></div>
          <div><strong>${overdueCards}</strong><span>Atrasados</span></div>
          <div><strong>${blockedCards}</strong><span>Bloqueados</span></div>
          <div><strong>${formatDate(antliaForecast)}</strong><span>Previsao Antlia</span></div>
        </div>

        <div class="client-slide-grid">
          <section>
            <h3>Resumo executivo</h3>
            <textarea id="report-notes" placeholder="Decisoes, estrategia acordada, pontos de atencao e observacoes manuais">${sanitize(selectedConfig.notes || '')}</textarea>
          </section>
          <section>
            <h3>Previsao consolidada</h3>
            <p>Conclusao prevista das atividades Antlia: <strong>${formatDate(antliaForecast)}</strong></p>
            <p>A subida efetiva em UAT fica tratada como dependencia externa e nao compoe o percentual Antlia.</p>
            <p class="muted">Prazo original historico depende de baseline cadastrado ou historico de alteracao de datas no Jira.</p>
          </section>
        </div>

        <section>
          <h3>Linha do tempo dos epicos</h3>
          <div class="epic-timeline">
            ${visibleEpics.map((item, index) => `
              <article class="epic-milestone ${item.situation.toLowerCase().includes('atras') || item.situation.toLowerCase().includes('bloque') ? 'danger' : item.progress === 100 ? 'success' : 'warning'}">
                <small>${index + 1}</small>
                <strong>${sanitize(item.epic.key)}</strong>
                <span>${sanitize(item.epic.title)}</span>
                <b>${item.progress}%</b>
                <em>${sanitize(item.situation)}</em>
              </article>
            `).join('') || '<p class="muted">Nenhum epico encontrado neste projeto.</p>'}
          </div>
        </section>

        <section>
          <h3>Detalhe dos epicos</h3>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Epico</th><th>Status</th><th>Inicio</th><th>Previsao Antlia</th><th>Conclusao</th><th>Atrasados</th><th>Bloqueados</th><th>Situacao</th></tr></thead>
              <tbody>
                ${visibleEpics.map(item => `
                  <tr>
                    <td><strong>${sanitize(item.epic.key)}</strong><br><span class="muted">${sanitize(item.epic.title)}</span></td>
                    <td>${sanitize(item.epic.status)}</td>
                    <td>${formatDate(item.start)}</td>
                    <td>${formatDate(item.forecast)}</td>
                    <td>${item.done}/${item.children.length} - ${item.progress}%</td>
                    <td>${item.overdue}</td>
                    <td>${item.blocked}</td>
                    <td><span class="badge ${item.situation.includes('Atrasado') || item.situation.includes('Bloqueado') ? 'badge-blocked' : item.progress === 100 ? 'badge-done' : 'badge-warning'}">${sanitize(item.situation)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  `;

  bindReportControls(project, visibleEpics);
}

function bindReportControls(project, visibleEpics) {
  document.getElementById('report-project')?.addEventListener('change', event => {
    const selected = dataService.getProjectById(event.target.value);
    if (selected) window.location.hash = `#/projects/executive?projectKey=${selected.key}`;
  });
  document.getElementById('save-report-config')?.addEventListener('click', () => {
    saveReportConfig(project.key, {
      title: document.getElementById('report-title')?.value || '',
      client: document.getElementById('report-client')?.value || '',
      referenceDate: document.getElementById('report-date')?.value || '',
      notes: document.getElementById('report-notes')?.value || '',
      selectedEpicKeys: visibleEpics.map(item => item.epic.key),
    });
    renderExecutiveReport();
  });
  document.getElementById('export-report-png')?.addEventListener('click', () => exportElementAsPng('client-report-export', `relatorio_gerencial_${project.key}`));
  document.getElementById('export-report-pdf')?.addEventListener('click', () => exportElementAsPdf('client-report-export', `relatorio_gerencial_${project.key}`));
}

function commentAvailability() {
  const sample = dataService.getRawJiraData()?.issues?.find(issue => issue.comments || Object.hasOwn(issue, 'comment_count') || Object.hasOwn(issue, 'comments_count'));
  return Boolean(sample);
}

function classifyCommentHealth(card) {
  const raw = getRawIssue(card);
  const human = Number(raw.human_comment_count || raw.comments_human_count || 0);
  const automation = Number(raw.automation_comment_count || raw.comments_automation_count || 0);
  const total = Number(raw.comment_count || raw.comments_count || human + automation || 0);
  if (!commentAvailability()) return { key: 'unavailable', label: 'Comentarios nao sincronizados', human, automation, total };
  if (human > 0) return { key: 'healthy', label: 'Com comentario humano', human, automation, total };
  if (automation > 0) return { key: 'automation', label: 'Somente comentarios de automacao', human, automation, total };
  return { key: 'missing', label: 'Sem comentario humano', human, automation, total };
}

function healthMinimum() {
  return Number(localStorage.getItem(HEALTH_MIN_KEY) || 90);
}

function readHealthPageSize() {
  const stored = Number(localStorage.getItem(HEALTH_PAGE_SIZE_KEY) || 25);
  return HEALTH_PAGE_SIZES.includes(stored) ? stored : 25;
}

function cardJiraLink(card) {
  const url = getJiraIssueUrl(card, dataService.config?.baseUrl);
  return url === '#' ? `<span class="issue-link unavailable" title="URL do Jira nao configurada">${sanitize(card.key)}</span>` : `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer" class="issue-link">${sanitize(card.key)}</a>`;
}

function healthConfig(projectKey) {
  const saved = reportConfig(`health:${projectKey}`);
  const weights = Object.fromEntries(Object.entries(DEFAULT_HEALTH_CONFIG.weights).map(([key, fallback]) => [key, Number(saved.weights?.[key] ?? fallback)]));
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return { ...DEFAULT_HEALTH_CONFIG, weights: total === 100 ? weights : DEFAULT_HEALTH_CONFIG.weights };
}

const HEALTH_HISTORY_KEY = 'rja.projectHealth.history';

function readHealthHistory(projectKey) {
  try {
    const history = JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY) || '{}');
    return Array.isArray(history[projectKey]) ? history[projectKey] : [];
  } catch { return []; }
}

function saveHealthSnapshot(projectKey, score) {
  if (score === null) return [];
  const history = readHealthHistory(projectKey);
  const today = new Date().toISOString().slice(0, 10);
  const next = [...history.filter(item => item.date !== today), { date: today, score }].slice(-30);
  try {
    const all = JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY) || '{}');
    all[projectKey] = next;
    localStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(all));
  } catch { /* storage unavailable must not break the report */ }
  return next;
}

function healthTrend(history) {
  if (history.length < 2) return 'Sem historico suficiente';
  const delta = history.at(-1).score - history.at(-2).score;
  return `${delta > 0 ? '+' : ''}${delta} pontos desde a ultima analise`;
}

function renderHealthReport() {
  const content = document.getElementById('page-content');
  const requestedProject = getProjectFromState();
  const healthProjects = dataService.getProjects().filter(item => !DEFAULT_HEALTH_CONFIG.excludedProjectKeys.includes(item.key.toUpperCase()));
  const project = healthProjects.find(item => item.id === requestedProject?.id) || healthProjects[0] || null;
  if (healthActiveProject !== project?.key) {
    healthActiveProject = project?.key;
    healthPage = 1;
    healthSearch = healthStatusFilter = healthAssigneeFilter = healthRiskFilter = '';
  }
  renderHeader('Saude Detalhamento Cards Projetos', 'Leitura executiva e explicavel da saude operacional do projeto');
  if (!project) {
    content.innerHTML = '<div class="empty-state"><h3>Sem projetos carregados</h3></div>';
    return;
  }

  const minimum = healthMinimum();
  healthPageSize = readHealthPageSize();
  const syncMetadata = dataService.getSyncMetadata();
  const configured = healthConfig(project.key);
  const allProjectSummaries = dataService.getProjects()
    .filter(p => !configured.excludedProjectKeys.includes(p.key.toUpperCase()))
    .map(p => {
    const eligible = cardsForProject(p.id, { includeEpics: false });
    const enriched = eligible.map(card => ({ card, health: classifyCommentHealth(card) }));
    const healthy = enriched.filter(item => item.health.key === 'healthy').length;
    const automation = enriched.filter(item => item.health.key === 'automation').length;
    const unavailable = enriched.filter(item => item.health.key === 'unavailable').length;
    const percent = unavailable ? null : pct(healthy, eligible.length);
    const health = calculateProjectHealth(eligible, { ...healthConfig(p.key), metadata: syncMetadata });
    const history = saveHealthSnapshot(p.key, health.score);
    return {
      project: p,
      eligible,
      enriched,
      healthy,
      automation,
      missing: eligible.length - healthy - automation - unavailable,
      unavailable,
      percent,
      analysts: new Set(eligible.map(card => card.assigneeId)).size,
      health,
      history,
      lastSyncedAt: syncMetadata.lastSyncedAt,
    };
  });
  const summary = allProjectSummaries.find(item => item.project.id === project.id) || allProjectSummaries[0];
  const riskCards = summary.enriched
    .map(item => ({ ...item, impact: calculateCardImpact(item.card, configured), assigneeName: dataService.getUserById(item.card.assigneeId)?.displayName || 'Sem responsavel definido' }))
    .filter(item => item.impact.risk > 0)
    .sort((a, b) => b.impact.risk - a.impact.risk);
  const filteredCards = filterHealthRows(riskCards, { search: healthSearch, status: healthStatusFilter, risk: healthRiskFilter, assignee: healthAssigneeFilter, sort: healthSort, direction: healthSortDirection });
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / healthPageSize));
  healthPage = Math.min(healthPage, totalPages);
  const visibleCards = filteredCards.slice((healthPage - 1) * healthPageSize, healthPage * healthPageSize);
  const status = summary.health.classification.label;

  document.getElementById('page-header')?.insertAdjacentHTML('beforeend', `<div class="page-actions"><button class="btn btn-primary" id="health-refresh" ${healthRefreshing ? 'disabled aria-busy="true"' : ''}>${healthRefreshing ? 'Atualizando...' : 'Atualizar projeto'}</button></div>`);

  content.innerHTML = `
    <div class="report-page">
      <div class="report-toolbar">
        <label>Projeto<select id="health-project">${projectOptions(project.id, { exclude: configured.excludedProjectKeys })}</select></label>
        <label>Minimo esperado<input id="health-minimum" type="number" min="0" max="100" value="${minimum}"></label>
        <button class="btn btn-primary" id="save-health-minimum">Salvar minimo</button>
        <details class="health-weight-config"><summary>Configurar pesos</summary><div class="health-weight-fields">${Object.entries(configured.weights).map(([key, value]) => `<label>${sanitize(key)}<input data-health-weight="${sanitize(key)}" type="number" min="0" max="100" value="${value}"></label>`).join('')}<button class="btn btn-secondary" id="save-health-weights">Aplicar pesos</button></div></details>
        <button class="btn btn-secondary" id="export-health-xlsx" ${filteredCards.length ? '' : 'disabled'}>Exportar resultado (Excel)</button>
      </div>
      <p class="muted" role="status" aria-live="polite">${healthRefreshing ? 'Sincronizando o projeto selecionado com o Jira...' : `Ultima sincronizacao informada: ${formatDateTime(syncMetadata.lastSyncedAt)}`}. Atualizar busca todos os cards de ${sanitize(project.key)} para manter o score completo.</p>

      ${!commentAvailability() ? `
        <div class="report-alert warning">
          Comentarios indisponiveis nesta carga. O score usa os campos estruturados disponiveis; a cobertura de comentarios nao pode ser avaliada.
        </div>
      ` : ''}

      <div class="kpi-grid">
        <div class="kpi-card kpi-info">${businessHelp('Regra: Project Health Score', 'Nota ponderada de prazo, execucao, bloqueios, qualidade, escopo e governanca. O score e deterministico e nao e alterado por IA.')}<div class="kpi-value">${summary.health.score === null ? '—' : summary.health.score}</div><div class="kpi-label">Project Health Score</div><div class="kpi-trend">${sanitize(summary.health.classification.label)} · ${sanitize(healthTrend(summary.history))}</div></div>
        <div class="kpi-card ${summary.health.confidence.level === 'high' ? 'kpi-success' : 'kpi-warning'}">${businessHelp('Regra: Confidence Score', 'Confianca separada do score, composta por cobertura de status, campos obrigatorios, datas, historico, hierarquia e frescor da sincronizacao.')}<div class="kpi-value">${summary.health.confidence.score}</div><div class="kpi-label">Confianca (${summary.health.confidence.level === 'high' ? 'alta' : summary.health.confidence.level === 'medium' ? 'media' : 'baixa'})</div><div class="kpi-trend">${summary.health.confidence.stale ? 'Dados desatualizados' : 'Dados dentro da janela de frescor'}</div></div>
        <div class="kpi-card">${businessHelp('Regra: cards elegíveis', 'Cards que podem ser avaliados pela regra de cobertura de comentários.') }<div class="kpi-value">${summary.eligible.length}</div><div class="kpi-label">Cards elegiveis</div></div>
        <div class="kpi-card kpi-success">${businessHelp('Regra: comentário humano', 'Cards elegíveis que possuem pelo menos um comentário feito por uma pessoa.') }<div class="kpi-value">${summary.healthy}</div><div class="kpi-label">Com comentario humano</div></div>
        <div class="kpi-card kpi-warning">${businessHelp('Regra: sem comentário humano', 'Cards elegíveis sem comentário humano identificado na carga sincronizada.') }<div class="kpi-value">${summary.missing}</div><div class="kpi-label">Sem comentario humano</div></div>
        <div class="kpi-card kpi-danger">${businessHelp('Regra: somente automação', 'Cards que possuem apenas comentários automáticos, sem comentário humano.') }<div class="kpi-value">${summary.automation}</div><div class="kpi-label">Somente automacao</div></div>
        <div class="kpi-card">${businessHelp('Regra: projetos abaixo do mínimo', `Projetos com score ou cobertura abaixo do mínimo configurado (${minimum}%).`) }<div class="kpi-value">${allProjectSummaries.filter(item => item.health.score !== null && item.health.score < minimum).length}</div><div class="kpi-label">Projetos abaixo do minimo</div></div>
      </div>

      <section class="report-section health-score-panel">
        <h3>Por que este projeto esta ${sanitize(summary.health.classification.label.toLowerCase())}?</h3>
        <p class="muted">${summary.health.reasons.length ? `Principais sinais: ${sanitize(summary.health.reasons.join(' · '))}.` : 'Nao foram identificados sinais de deterioracao na carga atual.'} ${summary.health.hardCap !== null ? `O score foi limitado a ${summary.health.hardCap} por uma regra critica.` : ''}</p>
        <div class="kpi-grid">
          ${summary.health.dimensions.map(dimension => `<div class="kpi-card"><div class="kpi-value">${dimension.score}</div><div class="kpi-label">${sanitize(dimension.label)} · peso ${dimension.weight}%</div><div class="progress-bar"><div class="fill" style="width:${dimension.score}%"></div></div></div>`).join('')}
        </div>
      </section>

      <section class="report-section">
        <h3>Resumo por projeto</h3>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Projeto</th><th>Score</th><th>Prazo</th><th>Execucao</th><th>Bloqueios</th><th>Qualidade</th><th>Situacao</th><th>Atualizado</th></tr></thead>
            <tbody>
              ${allProjectSummaries.map(item => `
                <tr>
                  <td><a href="#/projects/health?projectKey=${encodeURIComponent(item.project.key)}">${sanitize(item.project.key)}</a><br><span class="muted">${sanitize(item.project.name)}</span></td>
                  <td><strong>${item.health.score === null ? '—' : item.health.score}</strong></td>
              ${['prazo', 'execucao', 'bloqueios', 'qualidade'].map(key => `<td>${item.health.dimensions.find(d => d.key === key)?.score ?? '—'}</td>`).join('')}
                  <td><span class="badge ${item.health.classification.key === 'healthy' ? 'badge-done' : item.health.classification.key === 'critical' ? 'badge-blocked' : 'badge-warning'}">${sanitize(item.health.classification.label)}</span></td>
                  <td>${formatDateTime(item.lastSyncedAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="report-section">
        <h3>Cards que mais impactam a leitura - ${sanitize(project.key)}</h3>
        <p class="muted">Situacao do projeto: ${sanitize(status)}. Os filtros abaixo afetam apenas os cards e a aba de detalhamento do Excel; o score considera o projeto completo.</p>
        <div class="filter-bar health-card-filters">
          <label><span class="filter-label">Buscar card</span><input type="search" id="health-card-search" placeholder="Chave, titulo ou responsavel" value="${sanitize(healthSearch)}"></label>
          <label><span class="filter-label">Status</span><select id="health-card-status"><option value="">Todos</option>${[...new Set(riskCards.map(item => item.card.status))].sort().map(option => `<option value="${sanitize(option)}" ${option === healthStatusFilter ? 'selected' : ''}>${sanitize(option)}</option>`).join('')}</select></label>
          <label><span class="filter-label">Responsavel</span><select id="health-card-assignee"><option value="">Todos</option>${[...new Map(riskCards.map(item => [item.card.assigneeId || 'unassigned', item.assigneeName]))].map(([id, name]) => `<option value="${sanitize(id)}" ${healthAssigneeFilter === id ? 'selected' : ''}>${sanitize(name)}</option>`).join('')}</select></label>
          <label><span class="filter-label">Risco do card</span><select id="health-card-risk"><option value="">Todos</option><option value="critical" ${healthRiskFilter === 'critical' ? 'selected' : ''}>Critico (85-100)</option><option value="high" ${healthRiskFilter === 'high' ? 'selected' : ''}>Alto (60-84)</option><option value="attention" ${healthRiskFilter === 'attention' ? 'selected' : ''}>Atencao (1-59)</option></select></label>
          <label><span class="filter-label">Ordenar por</span><select id="health-sort">${[['risk', 'Risco'], ['key', 'Chave'], ['title', 'Titulo'], ['updatedAt', 'Atualizacao']].map(([key, label]) => `<option value="${key}" ${healthSort === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span class="filter-label">Ordem</span><select id="health-sort-direction"><option value="desc" ${healthSortDirection === 'desc' ? 'selected' : ''}>Decrescente</option><option value="asc" ${healthSortDirection === 'asc' ? 'selected' : ''}>Crescente</option></select></label>
          <label><span class="filter-label">Exibir</span><select id="health-page-size">${HEALTH_PAGE_SIZES.map(size => `<option value="${size}" ${size === healthPageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label>
          <button class="btn btn-secondary" id="health-clear-filters">Limpar filtros</button>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Card</th><th>Tipo</th><th>Status</th><th>Responsavel</th><th>Atualizado</th><th>Prazo</th><th>Bloqueio</th><th>Comentarios</th></tr></thead>
            <tbody>
              ${!visibleCards.length ? '<tr><td colspan="8"><div class="empty-state"><h3>Nenhum card de risco encontrado</h3><p>Limpe os filtros para conferir todos os cards de risco do projeto.</p></div></td></tr>' : visibleCards.map(({ card, health, impact }) => {
                const user = dataService.getUserById(card.assigneeId);
                return `
                  <tr>
                    <td>${cardJiraLink(card)}<br><span class="muted">${sanitize(card.title)}</span></td>
                    <td>${sanitize(rawTypeLabel(card))}</td>
                    <td>${sanitize(card.status)}</td>
                    <td>${sanitize(user?.displayName || 'Sem responsavel definido')}</td>
                    <td>${formatDate(card.updatedAt)}</td>
                    <td>${formatDate(cardEndDate(card))}<br>${!cardEndDate(card) ? 'Sem prazo informado' : impact.risks.meta?.overdue ? 'Atrasado' : 'No prazo'}</td>
                    <td>${resolveStatusCategory(card.status) === StatusCategory.BLOCKED ? 'Bloqueado' : '—'}</td>
                    <td><span class="badge badge-warning">${sanitize(health.label)} · impacto ${impact.impact}</span><br><span class="muted">${sanitize(impact.reasons.join(', '))}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="load-more-row health-pagination" aria-label="Paginacao dos cards"><span role="status">Exibindo ${filteredCards.length ? (healthPage - 1) * healthPageSize + 1 : 0}-${Math.min(healthPage * healthPageSize, filteredCards.length)} de ${filteredCards.length} cards de risco</span><div><button class="btn btn-secondary" id="health-page-prev" ${healthPage <= 1 ? 'disabled' : ''}>Anterior</button><span class="muted">Pagina ${healthPage} de ${totalPages}</span><button class="btn btn-secondary" id="health-page-next" ${healthPage >= totalPages ? 'disabled' : ''}>Proxima</button></div></div>
      </section>
    </div>
  `;

  document.getElementById('health-project')?.addEventListener('change', event => {
    const selected = dataService.getProjectById(event.target.value);
    if (selected) {
      healthPage = 1;
      healthStatusFilter = '';
      healthAssigneeFilter = '';
      window.location.hash = `#/projects/health?projectKey=${selected.key}`;
    }
  });
  document.getElementById('health-card-search')?.addEventListener('input', event => {
    healthSearch = event.target.value;
    const cursor = event.target.selectionStart;
    healthPage = 1;
    renderHealthReport();
    const input = document.getElementById('health-card-search');
    input.focus({ preventScroll: true });
    input.setSelectionRange(cursor, cursor);
  });
  document.getElementById('health-card-assignee')?.addEventListener('change', event => { healthAssigneeFilter = event.target.value; healthPage = 1; renderHealthReport(); });
  document.getElementById('health-sort')?.addEventListener('change', event => { healthSort = event.target.value; healthPage = 1; renderHealthReport(); });
  document.getElementById('health-sort-direction')?.addEventListener('change', event => { healthSortDirection = event.target.value; healthPage = 1; renderHealthReport(); });
  document.getElementById('health-clear-filters')?.addEventListener('click', () => {
    healthSearch = healthStatusFilter = healthAssigneeFilter = healthRiskFilter = '';
    healthSort = 'risk'; healthSortDirection = 'desc'; healthPage = 1;
    renderHealthReport();
  });
  document.getElementById('health-card-status')?.addEventListener('change', event => { healthStatusFilter = event.target.value; healthPage = 1; renderHealthReport(); });
  document.getElementById('health-card-risk')?.addEventListener('change', event => { healthRiskFilter = event.target.value; healthPage = 1; renderHealthReport(); });
  document.getElementById('health-page-size')?.addEventListener('change', event => {
    healthPageSize = Number(event.target.value);
    localStorage.setItem(HEALTH_PAGE_SIZE_KEY, String(healthPageSize));
    healthPage = 1;
    renderHealthReport();
  });
  document.getElementById('health-page-prev')?.addEventListener('click', () => { healthPage = Math.max(1, healthPage - 1); renderHealthReport(); });
  document.getElementById('health-page-next')?.addEventListener('click', () => { healthPage += 1; renderHealthReport(); });
  document.getElementById('health-refresh')?.addEventListener('click', () => refreshHealthProject(project));
  document.getElementById('save-health-minimum')?.addEventListener('click', () => {
    localStorage.setItem(HEALTH_MIN_KEY, document.getElementById('health-minimum')?.value || '90');
    renderHealthReport();
  });
  document.getElementById('save-health-weights')?.addEventListener('click', () => {
    const weights = Object.fromEntries([...document.querySelectorAll('[data-health-weight]')].map(input => [input.dataset.healthWeight, Number(input.value)]));
    if (Object.values(weights).reduce((sum, value) => sum + value, 0) !== 100) {
      showToast('A soma dos pesos deve ser exatamente 100%.', 'error');
      return;
    }
    saveReportConfig(`health:${project.key}`, { weights });
    renderHealthReport();
  });
  document.getElementById('export-health-xlsx')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await exportHealthWorkbook(allProjectSummaries, summary, filteredCards); }
    catch { showToast('Nao foi possivel exportar o resultado. Tente novamente.', 'error'); }
    finally { const button = document.getElementById('export-health-xlsx'); if (button) button.disabled = !filteredCards.length; }
  });
}

async function refreshHealthProject(project) {
  const button = document.getElementById('health-refresh');
  if (!button || healthRefreshing) return;
  healthRefreshing = true;
  const route = window.location.hash;
  button.disabled = true;
  button.textContent = 'Atualizando...';
  try {
    await syncHealthProject(dataService, project.key);
    showToast(`Projeto ${project.key} atualizado.`, 'success');
  } catch (error) {
    showToast(error.message || 'Nao foi possivel atualizar os dados do Jira.', 'error');
  } finally {
    healthRefreshing = false;
    if (window.location.hash === route) renderHealthReport();
    else {
      const current = document.getElementById('health-refresh');
      if (current) { current.disabled = false; current.removeAttribute('aria-busy'); current.textContent = 'Atualizar projeto'; }
    }
  }
}

function renderDetailedReport() {
  const content = document.getElementById('page-content');
  const project = getProjectFromState();
  renderHeader('Relatorio Gerencial Detalhado - Clientes', 'Cards, epicos, bloqueios, pendencias e rastreabilidade disponivel');
  if (!project) {
    content.innerHTML = '<div class="empty-state"><h3>Sem projetos carregados</h3></div>';
    return;
  }

  const params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
  const statusFilter = params.get('status') || '';
  const projectCards = cardsForProject(project.id, { includeEpics: false });
  const filtered = statusFilter ? projectCards.filter(card => card.status === statusFilter) : projectCards;
  const done = filtered.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length;
  const inProgress = filtered.filter(card => resolveStatusCategory(card.status) === StatusCategory.IN_PROGRESS).length;
  const blocked = filtered.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length;
  const overdue = filtered.filter(card => isCardOverdue(card)).length;
  const epics = [...new Set(filtered.map(card => card.parentKey || card.epicKey).filter(Boolean))];
  const assignees = [...new Set(filtered.map(card => card.assigneeId).filter(Boolean))];
  const coverage = commentAvailability() ? pct(filtered.filter(card => classifyCommentHealth(card).key === 'healthy').length, filtered.length) : null;

  content.innerHTML = `
    <div class="report-page">
      <div class="report-toolbar">
        <label>Projeto<select id="detailed-project">${projectOptions(project.id)}</select></label>
        <label>Status<select id="detailed-status"><option value="">Todos</option>${dataService.getStatusOptions().map(status => `<option value="${sanitize(status)}" ${status === statusFilter ? 'selected' : ''}>${sanitize(status)}</option>`).join('')}</select></label>
        <button class="btn btn-secondary" id="clear-detailed-filters">Limpar filtros</button>
        <button class="btn btn-secondary" id="copy-executive-summary">Copiar resumo</button>
        <button class="btn btn-secondary" id="export-detailed-xlsx">Excel</button>
      </div>

      ${!commentAvailability() ? '<div class="report-alert warning">Analise inteligente de comentarios aguardando sincronizacao de comentarios do Jira. O relatorio abaixo usa dados estruturados atuais.</div>' : ''}

      <div class="kpi-grid">
        <div class="kpi-card">${businessHelp('Regra: cards analisados', 'Quantidade de cards do projeto após o filtro de status selecionado.') }<div class="kpi-value">${filtered.length}</div><div class="kpi-label">Cards analisados</div></div>
        <div class="kpi-card kpi-success">${businessHelp('Regra: concluídos', 'Cards classificados como Concluído pelo mapa de status normalizado.') }<div class="kpi-value">${done}</div><div class="kpi-label">Concluidos</div></div>
        <div class="kpi-card kpi-info">${businessHelp('Regra: em andamento', 'Cards classificados como Em Andamento pelo mapa de status normalizado.') }<div class="kpi-value">${inProgress}</div><div class="kpi-label">Em andamento</div></div>
        <div class="kpi-card kpi-danger">${businessHelp('Regra: bloqueados', 'Cards classificados como Bloqueado pelo mapa de status normalizado.') }<div class="kpi-value">${blocked}</div><div class="kpi-label">Bloqueados</div></div>
        <div class="kpi-card kpi-warning">${businessHelp('Regra: atrasados', 'Cards com data de entrega anterior ao dia atual e que ainda não foram concluídos.') }<div class="kpi-value">${overdue}</div><div class="kpi-label">Atrasados</div></div>
        <div class="kpi-card">${businessHelp('Regra: cobertura das informações', 'Percentual de cards com os campos estruturados necessários para o relatório.') }<div class="kpi-value">${pctLabel(coverage)}</div><div class="kpi-label">Cobertura das informacoes</div></div>
      </div>

      <section class="report-section">
        <h3>Resumo inteligente revisavel</h3>
        <textarea id="detailed-summary">Projeto ${project.name}: ${filtered.length} cards analisados, ${done} concluidos, ${inProgress} em andamento, ${blocked} bloqueados e ${overdue} atrasados. Existem ${epics.length} epicos impactados e ${assignees.length} responsaveis envolvidos. Revise este texto antes de apresentar ao cliente.</textarea>
      </section>

      <section class="report-section">
        <h3>Evolucao por epico</h3>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Epico</th><th>Total</th><th>Concluidos</th><th>Em andamento</th><th>Bloqueados</th><th>Atrasados</th><th>Previsao</th></tr></thead>
            <tbody>
              ${epics.map(epicKey => {
                const cards = filtered.filter(card => (card.parentKey || card.epicKey) === epicKey);
                const doneCount = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length;
                const ends = cards.map(cardEndDate).filter(Boolean).map(value => new Date(value));
                return `
                  <tr>
                    <td><strong>${sanitize(epicKey)}</strong></td>
                    <td>${cards.length}</td>
                    <td>${doneCount} (${pct(doneCount, cards.length) || 0}%)</td>
                    <td>${cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.IN_PROGRESS).length}</td>
                    <td>${cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length}</td>
                    <td>${cards.filter(card => isCardOverdue(card)).length}</td>
                    <td>${formatDate(ends.length ? new Date(Math.max(...ends.map(date => date.getTime()))).toISOString() : null)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="report-section">
        <h3>Detalhamento dos cards</h3>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Card</th><th>Epico</th><th>Tipo</th><th>Status</th><th>Responsavel</th><th>Data limite</th><th>Atualizacao</th><th>Rastreabilidade</th></tr></thead>
            <tbody>
              ${filtered.slice(0, 300).map(card => {
                const user = dataService.getUserById(card.assigneeId);
                return `
                  <tr>
                    <td><a href="${sanitize(card.jiraUrl || '#')}" target="_blank" rel="noopener noreferrer">${sanitize(card.key)}</a><br><span class="muted">${sanitize(card.title)}</span></td>
                    <td>${sanitize(card.parentKey || card.epicKey || '-')}</td>
                    <td>${sanitize(rawTypeLabel(card))}</td>
                    <td>${sanitize(card.status)}</td>
                    <td>${sanitize(user?.displayName || 'Sem responsavel definido')}</td>
                    <td>${formatDate(cardEndDate(card))}</td>
                    <td>${formatDate(card.updatedAt)}</td>
                    <td><span class="badge badge-type">Card Jira</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  document.getElementById('detailed-project')?.addEventListener('change', event => {
    const selected = dataService.getProjectById(event.target.value);
    if (selected) window.location.hash = `#/projects/detailed-report?projectKey=${selected.key}`;
  });
  document.getElementById('detailed-status')?.addEventListener('change', event => {
    window.location.hash = `#/projects/detailed-report?projectKey=${project.key}${event.target.value ? `&status=${encodeURIComponent(event.target.value)}` : ''}`;
  });
  document.getElementById('clear-detailed-filters')?.addEventListener('click', () => {
    window.location.hash = `#/projects/detailed-report?projectKey=${project.key}`;
  });
  document.getElementById('copy-executive-summary')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('detailed-summary')?.value || '');
  });
  document.getElementById('export-detailed-xlsx')?.addEventListener('click', () => exportDetailedWorkbook(filtered, project));
}

async function exportElementAsPng(elementId, filename) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, { backgroundColor: '#0f111a', scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true });
  const link = document.createElement('a');
  link.download = `${filename}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function exportElementAsPdf(elementId, filename) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const { default: html2canvas } = await import('html2canvas');
  const { jsPDF } = await import('jspdf');
  const canvas = await html2canvas(element, { backgroundColor: '#0f111a', scale: 1.5, useCORS: true });
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(`${filename}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`);
}

async function exportHealthWorkbook(projectSummaries, selectedSummary, filteredRows) {
  await exportRowsWorkbook([
    {
      name: 'Resumo por projeto',
      rows: projectSummaries.map(item => ({
        projeto: item.project.key,
        nome: item.project.name,
        elegiveis: item.eligible.length,
        com_humano: item.healthy,
        sem_humano: item.missing,
        somente_automacao: item.automation,
        saude: pctLabel(item.percent),
        project_health_score: item.health.score ?? '',
        classificacao: item.health.classification.label,
        tendencia: healthTrend(item.history),
        principais_sinais: item.health.reasons.join(' | '),
      })),
    },
    {
      name: 'Dimensoes',
      rows: projectSummaries.flatMap(item => item.health.dimensions.map(dimension => ({
        projeto: item.project.key,
        dimensao: dimension.label,
        peso: dimension.weight,
        score: dimension.score,
        impacto: dimension.impact,
      }))),
    },
    {
      name: 'Resumo por analista',
      rows: projectSummaries.flatMap(item => {
        const groups = new Map();
        item.eligible.forEach(card => {
          const key = card.assigneeId || 'unassigned';
          const group = groups.get(key) || { cards: 0, human: 0, missing: 0 };
          group.cards += 1;
          group.human += card.humanCommentCount > 0 ? 1 : 0;
          group.missing += card.humanCommentCount > 0 ? 0 : 1;
          groups.set(key, group);
        });
        return [...groups].map(([assigneeId, group]) => ({
          projeto: item.project.key,
          analista: dataService.getUserById(assigneeId)?.displayName || 'Sem responsavel definido',
          cards: group.cards,
          com_humano: group.human,
          sem_humano: group.missing,
          preenchimento: pctLabel(pct(group.human, group.cards)),
        }));
      }),
    },
    {
      name: 'Cards pendentes',
      rows: filteredRows.map(({ card, health, impact }) => ({
        card: card.key,
        titulo: card.title,
        tipo: rawTypeLabel(card),
        status: card.status,
        responsavel: dataService.getUserById(card.assigneeId)?.displayName || '',
        humanos: health.human,
        automacao: health.automation,
        situacao: health.label,
        impacto: impact.risk,
        fatores_impacto: impact.reasons.join(' | '),
        jira: getJiraIssueUrl(card, dataService.config?.baseUrl),
      })),
    },
  ], `saude_cards_${selectedSummary.project.key}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportDetailedWorkbook(cards, project) {
  await exportRowsWorkbook([
    {
      name: 'Resumo',
      rows: [{
        projeto: project.key,
        nome: project.name,
        cards_analisados: cards.length,
        gerado_em: new Date().toISOString(),
        observacao: commentAvailability() ? 'Comentarios disponiveis na carga.' : 'Comentarios nao sincronizados na carga atual.',
      }],
    },
    {
      name: 'Detalhamento',
      rows: cards.map(card => ({
        card: card.key,
        titulo: card.title,
        epico: card.parentKey || card.epicKey || '',
        tipo: rawTypeLabel(card),
        status: card.status,
        responsavel: dataService.getUserById(card.assigneeId)?.displayName || '',
        data_limite: cardEndDate(card) || '',
        atualizado: card.updatedAt || '',
        jira: card.jiraUrl || '',
      })),
    },
  ], `relatorio_detalhado_${project.key}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function renderProjectExecutiveReport() {
  renderExecutiveReport();
}

export function renderProjectHealthReport() {
  renderHealthReport();
}

export function renderProjectDetailedReport() {
  renderDetailedReport();
}
