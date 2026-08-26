/**
 * executive.js — Resumo Executivo do Projeto
 * Layout: 2 colunas (esquerda: Status + KPIs + Conquistas + Proximos Passos | direita: Progresso + Time + acompanhamento)
 */
import '../styles/executive.css';
import { dataService } from '../data/data-service.js';
import { formatDate, sanitize } from '../utils/helpers.js';
import { toDate, signedDaysBetween } from '../data/schedule-service.js';

let html2canvasModule = null;
let jsPDFModule = null;

async function loadHtml2Canvas() {
  if (!html2canvasModule) html2canvasModule = (await import('html2canvas')).default;
  return html2canvasModule;
}

async function loadJsPDF() {
  if (!jsPDFModule) jsPDFModule = (await import('jspdf')).jsPDF;
  return jsPDFModule;
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function formatDays(value, suffix = 'dias') {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value} ${suffix}`;
}

function scheduleToneClass(value, type = 'variance') {
  if (value === null || value === undefined) return 'muted';
  if (type === 'buffer') {
    if (value > 0) return 'success';
    if (value === 0) return 'warning';
    return 'danger';
  }
  if (type === 'gap') {
    if (value > 0) return 'warning';
    if (value === 0) return 'success';
    return 'success';
  }
  if (value >= 0) return 'success';
  if (value > -10) return 'warning';
  return 'danger';
}



function renderProgressLine(label, value, total, colorClass) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return `
    <div class="exec-status-row">
      <span>${sanitize(label)}</span>
      <div class="exec-status-track"><div class="exec-status-fill ${colorClass}" style="width:${percent}%"></div></div>
      <strong>${value} (${percent}%)</strong>
    </div>
  `;
}

function renderScheduleTimeline(schedule) {
  const plannedStart = schedule.plannedStartDate;
  const plannedEnd = schedule.plannedEndDate;
  const effectiveStart = schedule.effectiveStartDate;
  const effectiveEnd = schedule.effectiveEndDate;
  const dates = [plannedStart, plannedEnd, effectiveStart, effectiveEnd]
    .map(toDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const first = dates[0] || toDate(new Date());
  const last = dates[dates.length - 1] || first;
  const totalDays = Math.max(1, signedDaysBetween(first, last) || 1);
  const position = value => {
    const date = toDate(value);
    if (!date) return null;
    return Math.max(0, Math.min(100, ((signedDaysBetween(first, date) || 0) / totalDays) * 100));
  };
  const plannedLeft = position(plannedStart);
  const plannedRight = position(plannedEnd);
  const effectiveLeft = position(effectiveStart);
  const effectiveRight = position(effectiveEnd);
  const plannedWidth = plannedLeft !== null && plannedRight !== null ? Math.max(4, plannedRight - plannedLeft) : 0;
  const effectiveWidth = effectiveLeft !== null && effectiveRight !== null ? Math.max(4, effectiveRight - effectiveLeft) : 0;
  const bufferLeft = effectiveRight !== null && plannedRight !== null ? Math.min(effectiveRight, plannedRight) : null;
  const bufferWidth = effectiveRight !== null && plannedRight !== null ? Math.max(0, Math.abs(plannedRight - effectiveRight)) : 0;

  return `
    <div class="exec-timeline">
      <div class="exec-timeline-legend">
        <span><i class="planned"></i>Período previsto (proposta)</span>
        <span><i class="effective"></i>Período efetivo (Jira)</span>
        <span><i class="buffer"></i>Gordura</span>
      </div>
      <div class="exec-timeline-bars">
        ${plannedWidth ? `<div class="exec-timeline-bar planned" style="left:${plannedLeft}%;width:${plannedWidth}%;"></div>` : '<div class="exec-timeline-empty">Datas previstas em proposta ainda não informadas.</div>'}
        ${effectiveWidth ? `<div class="exec-timeline-bar effective" style="left:${effectiveLeft}%;width:${effectiveWidth}%;"></div>` : ''}
        <div class="exec-timeline-buffer ${schedule.bufferDays < 0 ? 'danger' : ''}" style="left:${bufferLeft ?? 0}%;width:${bufferWidth}%;">
          ${schedule.bufferDays !== null ? `${Math.abs(schedule.bufferDays)} dias` : ''}
        </div>
      </div>
      <div class="exec-timeline-points">
        <span><strong>${formatDate(plannedStart)}</strong><small>Início previsto</small></span>
        <span><strong>${formatDate(effectiveStart)}</strong><small>Início efetivo</small></span>
        <span><strong>${formatDate(effectiveEnd)}</strong><small>Fim efetivo</small></span>
        <span><strong>${formatDate(plannedEnd)}</strong><small>Fim previsto</small></span>
      </div>
    </div>
  `;
}

function renderExecutiveDashboard(summary, formatTicket) {
  const {
    project, progressPercent, totals, team, risks, achievements,
    nextSteps, lastSync, farol, schedule, deliverables, statusBreakdown,
  } = summary;
  const plannedStartValue = schedule.plannedStartDate || '';
  const plannedEndValue = schedule.plannedEndDate || '';
  const lastSyncLabel = lastSync ? new Date(lastSync).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '—';
  const farolClass = farol?.cor || 'green';
  const topAlert = schedule.alerts?.[0]?.label || 'Cronograma dentro dos critérios atuais.';

  return `
    <div class="executive-page executive-v2">
      <div class="exec-topbar">
        <div>
          <h1>Resumo Executivo</h1>
          <div class="exec-project-line">
            <span class="exec-project-pill"><span class="exec-health-dot ${farolClass}"></span>${sanitize(project.key)} · ${sanitize(project.name)}</span>
          </div>
        </div>
        <div class="exec-topbar-actions">
          <div class="exec-sync">Última atualização dos dados: ${sanitize(lastSyncLabel)}</div>
          <button class="executive-export-btn" id="export-png-btn" aria-label="Exportar resumo em PNG" onclick="exportExecutivePNG('${encodeURIComponent(project.key)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            PNG
          </button>
          <button class="executive-export-btn" id="export-pdf-btn" aria-label="Exportar resumo em PDF" onclick="exportExecutivePDF('${encodeURIComponent(project.key)}')" style="background:linear-gradient(135deg,#10B981,#059669)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            PDF
          </button>
        </div>
      </div>

      <div id="executive-export-area">
      <div class="exec-kpi-row">
        <div class="exec-kpi-card farol ${farolClass}">
          <div class="exec-farol-ring"><span></span></div>
          <div><small>Farol do projeto</small><strong>${progressPercent}%</strong><p>${sanitize(topAlert)}</p></div>
        </div>
        <div class="exec-kpi-card"><small>Total de tickets</small><strong>${totals.issues}</strong><p>100% do total</p></div>
        <div class="exec-kpi-card success"><small>Concluídos</small><strong>${totals.done}</strong><p>${progressPercent}% do total</p></div>
        <div class="exec-kpi-card progress"><small>Em andamento</small><strong>${totals.inProgress}</strong><p>${totals.issues ? Math.round((totals.inProgress / totals.issues) * 100) : 0}% do total</p></div>
        <div class="exec-kpi-card danger"><small>Bloqueados</small><strong>${totals.blocked}</strong><p>${totals.issues ? Math.round((totals.blocked / totals.issues) * 100) : 0}% do total</p></div>
        <div class="exec-kpi-card warning"><small>Data parcial</small><strong>${totals.datePartial || 0}</strong><p>Sem início no Jira</p></div>
      </div>

      <div class="exec-main-grid">
        <section class="exec-card exec-schedule-card">
          <div class="exec-card-title-row">
            <div>
              <div class="exec-card-title">Cronograma do Projeto</div>
              <p>Proposta, execução Jira e margem de segurança em uma visão única.</p>
            </div>
            <span class="exec-schedule-health ${farolClass}" aria-label="Indicador visual do cronograma"></span>
          </div>
          <div class="exec-schedule-layout">
            <form class="exec-schedule-list" id="exec-schedule-form">
              <label class="proposal"><i></i><span>Início previsto (proposta)</span><input type="date" name="plannedStartDate" value="${sanitize(plannedStartValue)}"></label>
              <label class="jira"><i></i><span>Início efetivo (Jira)</span><strong>${formatDate(schedule.effectiveStartDate)}</strong><small>Menor início encontrado nos tickets</small></label>
              <label class="gap"><i></i><span>Gap de início</span><strong class="${scheduleToneClass(schedule.startGapDays, 'gap')}">${formatDays(schedule.startGapDays)}</strong><small>${schedule.startGapDays === null ? 'Datas insuficientes' : schedule.startGapDays > 0 ? 'Execução começou após o previsto' : schedule.startGapDays < 0 ? 'Execução antecipada' : 'Execução conforme previsto'}</small></label>
              <label class="proposal"><i></i><span>Fim previsto (proposta)</span><input type="date" name="plannedEndDate" value="${sanitize(plannedEndValue)}"></label>
              <label class="jira"><i></i><span>Fim efetivo (Jira)</span><strong>${formatDate(schedule.effectiveEndDate)}</strong><small>Maior fim planejado nos tickets</small></label>
              <label class="buffer"><i></i><span>Gordura do projeto</span><strong class="${scheduleToneClass(schedule.bufferDays, 'buffer')}">${formatDays(schedule.bufferDays)}</strong><small>${schedule.bufferDays === null ? 'Datas insuficientes' : schedule.bufferDays > 0 ? 'Margem de segurança disponível' : schedule.bufferDays < 0 ? 'Planejado além do vendido' : 'Sem margem de segurança'}</small></label>
              <div class="exec-save-row"><button type="submit" class="exec-save-btn">Salvar datas de proposta</button></div>
            </form>
            <div class="exec-schedule-metrics">
              <div class="exec-metric-box"><small>Prazo decorrido</small><strong>${formatPercent(schedule.elapsedPercentage)}</strong><div><span style="width:${schedule.elapsedPercentage || 0}%"></span></div><p>Base ${schedule.contractualElapsedPercentage !== null ? 'proposta' : 'Jira'}</p></div>
              <div class="exec-metric-box success"><small>Conclusão real</small><strong>${formatPercent(schedule.completionPercentage)}</strong><div><span style="width:${schedule.completionPercentage || 0}%"></span></div><p>${totals.done} de ${totals.issues} tickets concluídos</p></div>
              <div class="exec-metric-box variance ${scheduleToneClass(schedule.scheduleVariance)}"><small>Diferença (real vs esperado)</small><strong>${formatDays(schedule.scheduleVariance, 'p.p.')}</strong><p>${schedule.scheduleVariance === null ? 'Dados insuficientes.' : schedule.scheduleVariance >= 0 ? 'Projeto acima ou no ritmo esperado.' : 'Projeto abaixo do andamento esperado.'}</p></div>
              ${renderScheduleTimeline(schedule)}
            </div>
          </div>
        </section>

        <section class="exec-card">
          <div class="exec-card-title">Progresso por Status</div>
          <div class="exec-status-list">
            ${statusBreakdown.slice(0, 6).map((item, idx) => renderProgressLine(item.name, item.count, totals.issues, ['success','progress','danger','warning','planned','muted'][idx] || 'muted')).join('')}
          </div>
        </section>

        <section class="exec-card">
          <div class="exec-card-title">Time do Projeto</div>
          <div class="exec-team-row">
            ${team.slice(0, 5).map(member => `
              <div class="exec-team-member">
                ${member.avatar ? `<img src="${sanitize(member.avatar)}" alt="">` : `<div class="exec-avatar-fallback">${sanitize(member.name?.slice(0, 2) || 'NA')}</div>`}
                <strong>${sanitize(member.name)}</strong>
                <span>${member.totalTickets} tickets</span>
              </div>
            `).join('')}
          </div>
        </section>
      </div>

      <div class="exec-bottom-grid">
        <section class="exec-card">
          <div class="exec-card-title">Entregáveis</div>
          <div class="exec-deliverables">
            ${(deliverables || []).slice(0, 6).map(item => `
              <div class="exec-deliverable-row">
                <strong>${sanitize(item.name)}</strong>
                <span>${formatDate(item.plannedStartDate)} - ${formatDate(item.plannedEndDate)}</span>
                <div class="exec-mini-track"><i style="width:${item.completionPercentage}%"></i></div>
                <em>${item.completionPercentage}%</em>
                <b class="${item.riskStatus}" aria-label="Indicador visual do entregavel"></b>
              </div>
            `).join('') || '<div class="executive-list-empty">Nenhum entregável identificado</div>'}
          </div>
        </section>

        <section class="exec-card">
          <div class="exec-card-title">Últimas Conquistas</div>
          <div class="exec-compact-list">
            ${achievements.length ? achievements.map(a => `<div><b>✓</b><span>${formatTicket(a)}<small>${formatDate(a.resolvedAt)}</small></span></div>`).join('') : '<div class="executive-list-empty">Nenhuma conquista ainda</div>'}
          </div>
        </section>

        <section class="exec-card">
          <div class="exec-card-title">Próximos Passos</div>
          <div class="exec-compact-list next">
            ${nextSteps.length ? nextSteps.map(n => `<div><b>→</b><span>${formatTicket(n)}<small>${sanitize(n.status)}</small></span></div>`).join('') : '<div class="executive-list-empty">Nenhum próximo passo</div>'}
          </div>
        </section>
      </div>

      <section class="exec-card exec-risk-card">
        <div class="exec-card-title">Pontos de Acompanhamento</div>
        <div class="exec-risk-row">
          ${risks.length ? risks.slice(0, 4).map(r => `<div class="exec-risk-item ${r.level === 'Alto' ? 'high' : 'medium'}"><strong>${sanitize(r.key)} — ${sanitize(r.title)}</strong><span>${sanitize(r.reason)} · Resp: ${sanitize(r.assignee)}</span><b aria-label="Indicador visual do item"></b></div>`).join('') : '<div class="executive-list-empty">Nenhum item de acompanhamento pendente</div>'}
        </div>
      </section>
      </div>
    </div>
  `;
}

// Funções de exportação no escopo global
window.exportExecutivePNG = async function(projectKey) {
  // Decodificar se vier encodeado
  const decodedKey = decodeURIComponent(projectKey);
  
  const element = document.getElementById('executive-export-area');
  if (!element) {
    alert('Área de exportação não encontrada');
    return;
  }

  const btn = document.getElementById('export-png-btn');
  if (!btn) {
    alert('Botão de exportação não encontrado');
    return;
  }
  
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>Exportando...</span>';
  btn.disabled = true;

  try {
    // Verificar se dados estão carregados
    const summary = dataService.buildProjectExecutiveSummary(decodedKey);
    if (!summary) {
      throw new Error('Dados do projeto não carregados. Sincronize os dados primeiro.');
    }

    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(element, {
      backgroundColor: '#0B0F1A',
      scale: 2,
      useCORS: true,
      logging: false
    });

    const link = document.createElement('a');
    link.download = 'resumo-executivo-' + encodeURIComponent(decodedKey) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (e) {
    console.error('Erro ao exportar PNG:', e);
    alert('Erro ao exportar: ' + e.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

window.exportExecutivePDF = async function(projectKey) {
  // Decodificar se vier encodeado
  const decodedKey = decodeURIComponent(projectKey);
  
  const element = document.getElementById('executive-export-area');
  if (!element) {
    alert('Área de exportação não encontrada');
    return;
  }

  const btn = document.getElementById('export-pdf-btn');
  if (!btn) {
    alert('Botão de exportação não encontrado');
    return;
  }

  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>Exportando...</span>';
  btn.disabled = true;

  try {
    // Verificar se dados estão carregados
    const summary = dataService.buildProjectExecutiveSummary(decodedKey);
    if (!summary) {
      throw new Error('Dados do projeto não carregados. Sincronize os dados primeiro.');
    }

    const html2canvas = await loadHtml2Canvas();
    const jsPDF = await loadJsPDF();
    const canvas = await html2canvas(element, {
      backgroundColor: '#0B0F1A',
      scale: 2,
      useCORS: true,
      logging: false
    });

    const imgData = canvas.toDataURL('image/png');

    // Usar formato A4 Landscape para melhor compatibilidade
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    // Calcular dimensões para manter aspect ratio
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = Math.min((pageWidth - 20) / imgWidth, (pageHeight - 20) / imgHeight);
    const width = imgWidth * ratio;
    const height = imgHeight * ratio;
    
    // Centralizar a imagem
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    pdf.addImage(imgData, 'PNG', x, y, width, height);
    pdf.save('resumo-executivo-' + encodeURIComponent(decodedKey) + '.pdf');
  } catch (e) {
    console.error('Erro ao exportar PDF:', e);
    alert('Erro ao exportar: ' + e.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

window.saveExecutiveSchedule = async function(projectKey, form) {
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn?.textContent || '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Salvando...';
  }

  try {
    await dataService.saveProjectMetadata(projectKey, {
      plannedStartDate: form.plannedStartDate.value || null,
      plannedEndDate: form.plannedEndDate.value || null,
    });
    renderExecutiveContent(projectKey);
  } catch (error) {
    alert('Erro ao salvar datas: ' + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

export function renderExecutive(params) {
  const projectKey = params?.projectKey;
  
  const header = document.getElementById('page-header');
  header.innerHTML = `
    <div>
      <h2>Resumo Executivo</h2>
      <div class="subtitle">Painel executivo do projeto</div>
    </div>
    <div class="page-actions">
      <select class="executive-project-select" id="project-select" onchange="location.hash='#/executive/' + this.value">
        <option value="">Selecionar projeto...</option>
        ${dataService.getProjects().map(p => `<option value="${sanitize(p.key)}" ${p.key === projectKey ? 'selected' : ''}>${sanitize(p.name)}</option>`).join('')}
      </select>
    </div>
  `;

  renderExecutiveContent(projectKey);
}

function renderExecutiveContent(projectKey) {
  const content = document.getElementById('page-content');
  
  // Se não há projeto selecionado
  if (!projectKey) {
    content.innerHTML = `
      <div class="executive-page">
        <div class="executive-select-page">
          <div class="executive-select-container">
            <div class="executive-select-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64">
                <path d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"/>
              </svg>
            </div>
            <h2>Selecione um Projeto</h2>
            <p>Escolha um projeto para visualizar o resumo executivo</p>
            <div class="executive-select-grid">
              ${dataService.getProjects().map(p => `
                <button class="executive-select-card" onclick="location.hash='#/executive/${sanitize(p.key)}'">
                  <span class="executive-select-key">${sanitize(p.key)}</span>
                  <span class="executive-select-name">${sanitize(p.name)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Buscar dados do projeto
  const summary = dataService.buildProjectExecutiveSummary(projectKey);
  
  if (!summary) {
    content.innerHTML = `
      <div class="executive-page">
        <div class="executive-empty">
          <div class="executive-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h3>Projeto não encontrado</h3>
          <p>O projeto ${sanitize(projectKey)} não possui dados sincronizados.</p>
          <button class="btn btn-primary" onclick="location.hash='#/data'">Sincronizar Dados</button>
        </div>
      </div>
    `;
    return;
  }

  const { project } = summary;

  // Função para exibir ticket: key + " — " + title (com sanitização)
  const formatTicket = (item) => {
    const title = item.title || 'Sem título';
    return `${sanitize(item.key)} — ${sanitize(title)}`;
  };

  content.innerHTML = renderExecutiveDashboard(summary, formatTicket);
  document.getElementById('exec-schedule-form')?.addEventListener('submit', event => {
    event.preventDefault();
    window.saveExecutiveSchedule(project.key, event.currentTarget);
  });
}
