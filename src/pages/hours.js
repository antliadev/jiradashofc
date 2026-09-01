import '../styles/hours.css';
import { dataService } from '../data/data-service.js';
import { sanitize } from '../utils/helpers.js';
import { businessHelp } from '../utils/ui-feedback.js';

const HOURS_PROJECTS = {
  CRAWFORD: { key: 'CRAWFORD', name: 'Crawford', logo: '/crawford-logo.png' },
  DOCW: { key: 'DOCW', name: 'Docwise', logo: '/docwise-logo.png' }
};
const TIME_ZONE = 'America/Sao_Paulo';
let currentReport = null;
let currentProject = HOURS_PROJECTS.CRAWFORD;
let hoursBreakdownMode = 'card';
let entriesPage = 1;
let entriesPageSize = 10;
let entriesSortDir = 'desc';

function currentCompetence() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
}

function normalizeCompetence(value) {
  return /^\d{4}-\d{2}$/.test(value || '') ? value : currentCompetence();
}

function competenceLabel(value) {
  const [year, month] = normalizeCompetence(value).split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}/${year}`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSeconds(totalSeconds) {
  const normalized = Math.max(0, Math.round(number(totalSeconds)));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.round((normalized % 3600) / 60);
  if (minutes === 60) return `${hours + 1}:00hrs`;
  return `${hours}:${String(minutes).padStart(2, '0')}hrs`;
}

function formatHours(value) {
  return formatSeconds(number(value) * 3600);
}

function formatDuration(entry) {
  const totalSeconds = number(entry.timeSeconds ?? number(entry.timeHours) * 3600);
  return formatSeconds(totalSeconds);
}

function excelDuration(value) {
  return formatHours(value);
}

function excelEntryDuration(entry) {
  return formatDuration(entry);
}

function durationTitleFromEntry(entry) {
  const totalSeconds = Math.max(0, Math.round(number(entry.timeSeconds ?? number(entry.timeHours) * 3600)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const dateOnly = String(value).slice(0, 10);
  const [year, month, day] = dateOnly.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function alertInfo(level, utilization) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'exceeded' || utilization > 100) return { css: 'exceeded', label: 'Excedido' };
  if (normalized === 'exhausted' || utilization === 100) return { css: 'exhausted', label: 'Esgotado' };
  if (normalized === 'critical' || utilization >= 90) return { css: 'critical', label: 'Crítico' };
  if (normalized === 'attention' || utilization >= 80) return { css: 'attention', label: 'Atenção' };
  return { css: 'healthy', label: 'Dentro da meta' };
}

function reportModel(payload, competence, projectKey) {
  const usedHours = number(payload.usedHours);
  const allowanceHours = number(payload.allowanceHours || 100);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const utilizationPercent = number(payload.utilizationPercent ?? (allowanceHours ? usedHours / allowanceHours * 100 : 0));
  return {
    ...payload,
    projectKey: payload.projectKey || projectKey,
    competence: normalizeCompetence(payload.competence || competence),
    usedHours,
    billingMode: payload.billingMode === 'cumulative' ? 'cumulative' : 'monthly',
    periodUsedHours: number(payload.periodUsedHours ?? usedHours),
    allowanceHours,
    availableHours: Math.max(0, number(payload.availableHours ?? allowanceHours - usedHours)),
    overageHours: Math.max(0, number(payload.overageHours ?? usedHours - allowanceHours)),
    utilizationPercent,
    byApplication: Array.isArray(payload.byApplication) ? payload.byApplication : [],
    monthlyHistory: Array.isArray(payload.monthlyHistory) ? payload.monthlyHistory : [],
    entries,
    allEntries: Array.isArray(payload.allEntries) ? payload.allEntries : entries,
    totalProjectCards: number(payload.totalProjectCards),
    cardsWithWorklog: number(payload.cardsWithWorklog),
    cardsWithoutWorklog: Array.isArray(payload.cardsWithoutWorklog) ? payload.cardsWithoutWorklog : []
  };
}

function renderLoading(competence) {
  document.getElementById('page-content').innerHTML = `
    <section class="hours-page" aria-busy="true">
      <div class="hours-loading"><div class="spinner"></div><p>Carregando apontamentos de ${sanitize(competenceLabel(competence))}…</p></div>
    </section>`;
}

function renderError(error, competence) {
  document.getElementById('page-content').innerHTML = `
    <section class="hours-page">
      <div class="hours-state hours-error" role="alert">
        <h3>Não foi possível carregar o controle de horas</h3>
        <p>${sanitize(error?.message || 'Falha inesperada ao consultar os apontamentos.')}</p>
        <button class="btn btn-primary" id="hours-retry">Tentar novamente</button>
      </div>
    </section>`;
  document.getElementById('hours-retry')?.addEventListener('click', () => loadReport(currentProject.key, competence));
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

function hoursSyncScope(projectKey) {
  return { hoursProjectKey: projectKey };
}

function applicationBars(items) {
  if (!items.length) return '<div class="hours-inline-empty">Nenhum projeto com horas nesta competência.</div>';
  const max = Math.max(...items.map(item => number(item.hours)), 1);
  return items.map(item => {
    const width = Math.max(2, number(item.hours) / max * 100);
    return `<div class="hours-bar-row">
      <span title="${sanitize(item.name || 'Sem projeto')}">${sanitize(item.name || 'Sem projeto')}</span>
      <div class="hours-bar-track"><i style="width:${width}%"></i></div>
      <strong>${sanitize(formatHours(item.hours))}</strong>
    </div>`;
  }).join('');
}

function cardBreakdown(entries) {
  const cards = new Map();
  for (const entry of entries) {
    const ticket = entry.ticket || 'Sem ticket';
    const current = cards.get(ticket) || {
      name: `${ticket} · ${entry.issueDescription || entry.description || 'Sem descrição'}`,
      hours: 0
    };
    current.hours += number(entry.timeHours ?? entry.hours ?? number(entry.timeSeconds) / 3600);
    cards.set(ticket, current);
  }
  return [...cards.values()].sort((a, b) => b.hours - a.hours);
}

function renderHoursBreakdown(report) {
  const target = document.getElementById('hours-breakdown-bars');
  if (!target) return;
  target.innerHTML = applicationBars(hoursBreakdownMode === 'card' ? cardBreakdown(report.entries) : report.byApplication);
  document.querySelectorAll('[data-hours-breakdown]').forEach(button => {
    const active = button.dataset.hoursBreakdown === hoursBreakdownMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function monthlyBars(items) {
  if (!items.length) return '<div class="hours-inline-empty">O histórico mensal ainda não está disponível.</div>';
  const max = Math.max(...items.map(item => number(item.usedHours)), 1);
  return `<div class="hours-month-bars">${items.map(item => {
    const height = Math.max(3, number(item.usedHours) / max * 100);
    const label = competenceLabel(item.competence).replace('/', ' ');
    return `<div class="hours-month-column" title="${sanitize(`${label}: ${formatHours(item.usedHours)}`)}">
      <strong>${sanitize(formatHours(item.usedHours))}</strong>
      <div><i style="height:${height}%"></i></div>
      <span>${sanitize(label)}</span>
    </div>`;
  }).join('')}</div>`;
}

function jiraTicketLink(entry) {
  const ticket = sanitize(entry.ticket || '—');
  if (!entry.jiraUrl) return `<strong>${ticket}</strong>`;
  return `<a href="${sanitize(entry.jiraUrl)}" target="_blank" rel="noopener noreferrer"><strong>${ticket}</strong></a>`;
}

function sortedEntries(entries) {
  const direction = entriesSortDir === 'asc' ? 1 : -1;
  return [...entries].sort((left, right) => {
    const monthCompare = String(left.monthYear || '').localeCompare(String(right.monthYear || ''), 'pt-BR');
    if (monthCompare) return monthCompare * direction;
    return (new Date(left.date).getTime() - new Date(right.date).getTime()) * direction;
  });
}

function entriesTable(entries) {
  if (!entries.length) {
    return `<div class="hours-state hours-empty">
      <h3>Nenhum apontamento encontrado</h3>
      <p>Registre worklogs nos cards ${sanitize(currentProject.name)} para que o histórico seja calculado automaticamente.</p>
    </div>`;
  }
  const sorted = sortedEntries(entries);
  const totalPages = Math.max(1, Math.ceil(sorted.length / entriesPageSize));
  entriesPage = Math.min(Math.max(1, entriesPage), totalPages);
  const start = (entriesPage - 1) * entriesPageSize;
  const visibleEntries = sorted.slice(start, start + entriesPageSize);
  return `<div class="hours-table-wrap"><table class="hours-table">
    <thead><tr><th>Data</th><th>Ticket</th><th>Projeto</th><th>Descrição</th><th>Tempo</th><th><button class="hours-sort-button" id="hours-sort-month" type="button">Mês/Ano ${entriesSortDir === 'asc' ? '↑' : '↓'}</button></th></tr></thead>
    <tbody>${visibleEntries.map(entry => `<tr>
      <td>${sanitize(formatDate(entry.date))}</td>
      <td>${jiraTicketLink(entry)}</td>
      <td>${sanitize(entry.application || 'Sem projeto')}</td>
      <td class="hours-description" title="${sanitize(entry.description || '')}">${sanitize(entry.description || '—')}</td>
      <td title="${sanitize(durationTitleFromEntry(entry))}">${sanitize(formatDuration(entry))}</td>
      <td>${sanitize(entry.monthYear || currentReport.competence)}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  <div class="hours-pagination">
    <label>Exibir
      <select id="hours-page-size">
        ${[10, 50, 100].map(size => `<option value="${size}" ${entriesPageSize === size ? 'selected' : ''}>${size}</option>`).join('')}
      </select>
    </label>
    <span>Mostrando ${start + 1}-${Math.min(start + entriesPageSize, sorted.length)} de ${sorted.length}</span>
    <div>
      <button class="btn btn-secondary btn-sm" id="hours-prev-page" ${entriesPage <= 1 ? 'disabled' : ''}>Anterior</button>
      <button class="btn btn-secondary btn-sm" id="hours-next-page" ${entriesPage >= totalPages ? 'disabled' : ''}>Próxima</button>
    </div>
  </div>`;
}

function renderReport(report) {
  currentReport = report;
  const isCumulative = report.billingMode === 'cumulative';
  const alert = alertInfo(report.alertLevel, report.utilizationPercent);
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <section class="hours-page">
      <div class="hours-toolbar">
        <div class="hours-report-intro">
          <div class="hours-client-brand" aria-label="Cliente ${sanitize(currentProject.name)}">
            <span>Cliente</span>
            <div class="hours-client-logo"><img src="${sanitize(currentProject.logo)}" alt="${sanitize(currentProject.name)}"></div>
          </div>
          <div>
            <span class="hours-eyebrow">Controle executivo · ${sanitize(report.projectKey)}</span>
            <h1>Relatório de Horas ${sanitize(competenceLabel(report.competence))}</h1>
            <p>${isCumulative ? 'Saldo contratual acumulado e consumo calculado pelos worklogs até a competência selecionada.' : 'Consumo calculado pelos worklogs do Jira na competência selecionada.'}</p>
          </div>
        </div>
        <div class="hours-actions">
          <label for="hours-competence">Competência
            <input type="month" id="hours-competence" value="${sanitize(report.competence)}" aria-label="Selecionar competência">
          </label>
          <button class="btn btn-secondary" id="hours-refresh">Atualizar ${sanitize(currentProject.name)}</button>
          <button class="btn btn-primary" id="hours-export" ${report.allEntries.length ? '' : 'disabled'}>Exportar planilha</button>
          <button class="btn btn-secondary" id="hours-export-pdf" ${report.allEntries.length ? '' : 'disabled'}>Exportar PDF</button>
          <span class="hours-refresh-status" id="hours-refresh-status" aria-live="polite"></span>
        </div>
      </div>

      <div class="hours-kpis">
        <article class="hours-kpi used">${businessHelp('Regra: horas utilizadas', 'Soma dos worklogs do projeto na competência. No contrato cumulativo, inclui também o saldo das competências anteriores.')}<span>${isCumulative ? 'Horas utilizadas acumuladas' : 'Horas utilizadas'}</span><strong>${sanitize(formatHours(report.usedHours))}</strong><small>${isCumulative ? `${formatHours(report.periodUsedHours)} nesta competência · ` : ''}de ${sanitize(formatHours(report.allowanceHours))}</small></article>
        <article class="hours-kpi available">${businessHelp('Regra: horas disponíveis', 'Limite contratado menos as horas utilizadas. No acumulativo, o saldo considera as competências anteriores e não reinicia mensalmente.')}<span>Horas disponíveis</span><strong>${sanitize(formatHours(report.availableHours))}</strong><small>${isCumulative ? 'saldo acumulado do contrato, sem reset mensal' : 'renovação mensal, sem acúmulo'}</small></article>
        <article class="hours-kpi utilization ${alert.css}">${businessHelp('Regra: consumo', 'Percentual de utilização calculado por horas utilizadas dividido pelo limite de horas da competência ou contrato.')}<span>Consumo</span><strong>${sanitize(report.utilizationPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))}%</strong><small>${sanitize(alert.label)}</small></article>
        <article class="hours-kpi overage ${report.overageHours > 0 ? 'visible' : ''}">${businessHelp('Regra: horas excedentes', 'Horas utilizadas que ultrapassam o limite contratado. O valor nunca é negativo.')}<span>Horas excedentes</span><strong>${sanitize(formatHours(report.overageHours))}</strong><small>${report.overageHours > 0 ? 'acima do limite contratado' : 'sem excedente no período'}</small></article>
        <article class="hours-kpi cards">${businessHelp('Regra: cards do Jira', 'Conta os cards do projeto e separa os que possuem pelo menos um worklog dos que não possuem apontamento na competência.')}<span>Cards do Jira</span><strong>${sanitize(String(report.totalProjectCards))}</strong><small>${sanitize(String(report.cardsWithWorklog))} com apontamento · ${sanitize(String(report.cardsWithoutWorklog.length))} sem apontamento</small></article>
      </div>

      <div class="hours-chart-grid">
        <article class="hours-panel">
          <div class="hours-panel-heading">
          <div><h2>Distribuição das horas ${businessHelp('Regra da distribuição', 'Agrupa as horas por card ou por projeto, conforme o modo selecionado.')}</h2><span>Visualize todos os cards ou o consolidado executivo</span></div>
            <div class="hours-segmented" aria-label="Agrupamento das horas">
              <button type="button" data-hours-breakdown="card" aria-pressed="true">Por card (${cardBreakdown(report.entries).length})</button>
              <button type="button" data-hours-breakdown="epic" aria-pressed="false">Por projeto (${report.byApplication.length})</button>
            </div>
          </div>
          <div id="hours-breakdown-bars">${applicationBars(cardBreakdown(report.entries))}</div>
        </article>
        <article class="hours-panel"><div class="hours-panel-heading"><h2>Consumo por mês ${businessHelp('Regra do histórico mensal', 'Exibe as horas utilizadas agrupadas por competência mensal, respeitando o modelo de cobrança do contrato.')}</h2><span>Histórico de horas utilizadas</span></div>${monthlyBars(report.monthlyHistory)}</article>
      </div>

      <article class="hours-panel hours-detail-panel">
        <div class="hours-panel-heading"><h2>Detalhamento dos apontamentos</h2><span>${report.allEntries.length} registro${report.allEntries.length === 1 ? '' : 's'} no histórico</span></div>
        ${entriesTable(report.allEntries)}
      </article>
    </section>`;

  document.getElementById('hours-competence')?.addEventListener('change', event => loadReport(currentProject.key, event.target.value));
  document.getElementById('hours-refresh')?.addEventListener('click', refreshCurrentHoursProject);
  document.getElementById('hours-export')?.addEventListener('click', exportWorkbook);
  document.getElementById('hours-export-pdf')?.addEventListener('click', exportPdf);
  bindEntriesControls();
  document.querySelectorAll('[data-hours-breakdown]').forEach(button => button.addEventListener('click', () => {
    hoursBreakdownMode = button.dataset.hoursBreakdown;
    renderHoursBreakdown(report);
  }));
}

function bindEntriesControls() {
  document.getElementById('hours-page-size')?.addEventListener('change', event => {
    entriesPageSize = Number(event.target.value) || 10;
    entriesPage = 1;
    renderReport(currentReport);
  });
  document.getElementById('hours-prev-page')?.addEventListener('click', () => {
    entriesPage = Math.max(1, entriesPage - 1);
    renderReport(currentReport);
  });
  document.getElementById('hours-next-page')?.addEventListener('click', () => {
    entriesPage += 1;
    renderReport(currentReport);
  });
  document.getElementById('hours-sort-month')?.addEventListener('click', () => {
    entriesSortDir = entriesSortDir === 'asc' ? 'desc' : 'asc';
    entriesPage = 1;
    renderReport(currentReport);
  });
}

function excelSafe(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function styleWorksheet(sheet, widths) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + widths.length)}1` };
  sheet.columns = widths.map(width => ({ width }));
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
  header.alignment = { vertical: 'middle' };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    row.alignment = { vertical: 'top' };
  });
}

async function exportWorkbook() {
  if (!currentReport?.allEntries?.length) return;
  const button = document.getElementById('hours-export');
  button.disabled = true;
  button.textContent = 'Gerando…';
  try {
    const ExcelModule = await import('exceljs');
    const ExcelJS = ExcelModule.default || ExcelModule;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Radar Jira Antlia';
    workbook.created = new Date();

    const description = workbook.addWorksheet('Descricao');
    description.addRow(['DATA', 'TICKET', 'PROJETO', 'DESCRIÇÃO DA ATUAÇÃO', 'TEMPO', 'MES/ANO']);
    currentReport.allEntries.forEach(entry => description.addRow([
      formatDate(entry.date), excelSafe(entry.ticket), excelSafe(entry.application || 'Sem projeto'),
      excelSafe(entry.description), excelEntryDuration(entry),
      excelSafe(entry.monthYear || currentReport.competence)
    ]));
    styleWorksheet(description, [14, 16, 28, 64, 12, 14]);

    const consumption = workbook.addWorksheet('Consumo');
    consumption.addRow(['MES/ANO', 'HORAS DA COMPETÊNCIA', 'HORAS CONTABILIZADAS', 'CONSUMO (%)']);
    currentReport.monthlyHistory.forEach(item => consumption.addRow([
      excelSafe(item.competence), excelDuration(item.usedHours), excelDuration(item.accountableUsedHours ?? item.usedHours), number(item.consumptionPercentage) / 100
    ]));
    consumption.getColumn(4).numFmt = '0.00%';
    styleWorksheet(consumption, [16, 24, 24, 18]);

    const hours = workbook.addWorksheet('Horas');
    hours.addRow(['PROJETO', 'MES/ANO', 'MODELO', 'HORAS CONTRATADAS', 'HORAS UTILIZADAS', 'HORAS DA COMPETÊNCIA', 'HORAS DISPONÍVEIS', 'HORAS EXCEDENTES']);
    hours.addRow([excelSafe(currentReport.projectKey), excelSafe(currentReport.competence), currentReport.billingMode === 'cumulative' ? 'ACUMULADO' : 'MENSAL', excelDuration(currentReport.allowanceHours), excelDuration(currentReport.usedHours), excelDuration(currentReport.periodUsedHours), excelDuration(currentReport.availableHours), excelDuration(currentReport.overageHours)]);
    styleWorksheet(hours, [18, 16, 16, 22, 20, 22, 22, 20]);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Relatorio-Horas-${currentReport.projectKey}-${currentReport.competence}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[Hours] Falha ao exportar planilha:', error);
    window.alert('Não foi possível gerar a planilha. Tente novamente.');
  } finally {
    button.disabled = false;
    button.textContent = 'Exportar planilha';
  }
}

async function exportPdf() {
  if (!currentReport?.allEntries?.length) return;
  const button = document.getElementById('hours-export-pdf');
  button.disabled = true;
  button.textContent = 'Gerando PDF...';
  try {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const element = document.querySelector('.hours-page');
    const canvas = await html2canvas(element, { backgroundColor: '#0f1117', scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`Relatorio-Horas-${currentReport.projectKey}-${currentReport.competence}.pdf`);
  } catch (error) {
    console.error('[Hours] Falha ao exportar PDF:', error);
    window.alert('Não foi possível gerar o PDF. Tente novamente.');
  } finally {
    button.disabled = false;
    button.textContent = 'Exportar PDF';
  }
}

async function refreshCurrentHoursProject() {
  const button = document.getElementById('hours-refresh');
  const status = document.getElementById('hours-refresh-status');
  if (!button) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Atualizando...';
  if (status) status.textContent = `Sincronizando somente ${currentProject.name} no Jira...`;

  try {
    const sync = await dataService.startScopedJiraSync(hoursSyncScope(currentProject.key));
    const jobId = sync.jobId || sync.job?.id || sync.id;
    if (status) status.textContent = sync.alreadyRunning ? 'Sincronizacao em andamento. Aguardando conclusao...' : 'Sincronizacao iniciada. Aguardando conclusao...';
    await waitForSyncJob(jobId);
    if (status) status.textContent = 'Dados atualizados. Recarregando relatorio...';
    entriesPage = 1;
    await loadReport(currentProject.key, currentReport?.competence);
  } catch (error) {
    console.error('[Hours] Falha ao atualizar dados do Jira:', error);
    if (status) status.textContent = error.message || 'Nao foi possivel atualizar os dados do Jira.';
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadReport(projectKey, competence) {
  const normalized = normalizeCompetence(competence);
  renderLoading(normalized);
  try {
    const payload = await dataService.loadHoursDashboard(projectKey, normalized);
    renderReport(reportModel(payload, normalized, projectKey));
  } catch (error) {
    renderError(error, normalized);
  }
}

export function renderHours(options = {}) {
  const requestedKey = String(options.projectKey || 'CRAWFORD').toUpperCase();
  currentProject = HOURS_PROJECTS[requestedKey] || HOURS_PROJECTS.CRAWFORD;
  hoursBreakdownMode = 'card';
  entriesPage = 1;
  const header = document.getElementById('page-header');
  if (header) header.innerHTML = `<div><h2>Controle de Horas</h2><div class="subtitle">${sanitize(currentProject.name)} · dados automáticos do Jira</div></div>`;
  const hashQuery = window.location.hash.split('?')[1] || '';
  const competence = normalizeCompetence(new URLSearchParams(hashQuery).get('competence'));
  loadReport(currentProject.key, competence);
}
