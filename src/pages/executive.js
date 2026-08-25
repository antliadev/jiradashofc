/**
 * executive.js — Resumo Executivo do Projeto
 * Layout: 2 colunas (esquerda: Status + KPIs + Conquistas + Proximos Passos | direita: Progresso + Time + acompanhamento)
 */
import '../styles/executive.css';
import { dataService } from '../data/data-service.js';
import { formatDate, sanitize, sanitizeTitle } from '../utils/helpers.js';
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

function riskLabel(risk) {
  const labels = { low: 'Baixo', medium: 'Médio', high: 'Alto' };
  return labels[risk] || risk || '—';
}

function statusLabel(status) {
  const labels = {
    done: 'Concluído',
    blocked: 'Bloqueado',
    in_progress: 'Em andamento',
    todo: 'Não iniciado',
  };
  return labels[status] || status || '—';
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

  const { project, healthStatus, healthLabel, progressPercent, totals, team, risks, achievements, nextSteps, lastSync, farol } = summary;

  // Cores do semáforo
  const healthColors = {
    green: { bg: '#22C55E', light: 'rgba(34, 197, 94, 0.15)', glow: 'rgba(34, 197, 94, 0.3)' },
    yellow: { bg: '#F59E0B', light: 'rgba(245, 158, 11, 0.15)', glow: 'rgba(245, 158, 11, 0.3)' },
    red: { bg: '#EF4444', light: 'rgba(239, 68, 68, 0.15)', glow: 'rgba(239, 68, 68, 0.3)' }
  };
  
  const health = healthColors[healthStatus];

  // Cores do farol (pode ser diferente do healthStatus)
  const farolEmoji = { green: '🟢', yellow: '🟡', red: '🔴' };
  const farolColors = healthColors[farol?.cor || 'green'];
  const farolDataRef = farol?.dataReferencia ? new Date(farol.dataReferencia).toLocaleDateString('pt-BR') : '';

  // Calcular percentuais das barras
  const donePercent = totals.issues > 0 ? Math.round((totals.done / totals.issues) * 100) : 0;
  const progressBarPercent = totals.issues > 0 ? Math.round((totals.inProgress / totals.issues) * 100) : 0;
  const blockedBarPercent = totals.issues > 0 ? Math.round((totals.blocked / totals.issues) * 100) : 0;
  const otherPercent = Math.max(0, 100 - donePercent - progressBarPercent - blockedBarPercent);

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
  return;

  content.innerHTML = `
    <div class="executive-page">
      <div class="executive-panel">
        
        <!-- HEADER -->
        <div class="executive-header">
          <div class="executive-header-left">
            <div class="executive-project-badge" style="background: linear-gradient(135deg, #3B82F6, #8B5CF6)">${sanitize(project.key.substring(0, 2))}</div>
            <div class="executive-project-title">
              <h1>${sanitize(project.name)}</h1>
              <span class="executive-project-meta"><span class="executive-key-badge">${sanitize(project.key)}</span> • Atualizado ${formatDate(lastSync)}</span>
            </div>
          </div>
          <div class="executive-header-right">
            <span class="executive-company-text">ANTLIA</span>
            <button class="executive-export-btn" id="export-png-btn" onclick="exportExecutivePNG('${encodeURIComponent(sanitize(project.key))}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              PNG
            </button>
            <button class="executive-export-btn" id="export-pdf-btn" onclick="exportExecutivePDF('${encodeURIComponent(sanitize(project.key))}')" style="background: linear-gradient(135deg, #10B981, #059669)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
              PDF
            </button>
          </div>
        </div>

        <!-- WRAPPER PARA EXPORTAÇÃO -->
        <div id="executive-export-area" style="padding: 16px 0;">

        ${farol ? `
        <!-- FAROL DO PROJETO (Destaque antes do grid) -->
        <div class="farol-card" style="border-color: ${farolColors.bg}; box-shadow: 0 4px 20px ${farolColors.glow}">
          <div class="farol-indicator" style="background: ${farolColors.light}; border: 2px solid ${farolColors.bg}">
            <span class="farol-emoji">${farolEmoji[farol.cor]}</span>
          </div>
          <div class="farol-info">
            <div class="farol-title">Farol do Projeto</div>
            <div class="farol-status" style="color: ${farolColors.bg}">${farol.label}</div>
            <div class="farol-subtitle">Baseado nos tickets com data limite até ${farolDataRef}</div>
          </div>
          <div class="farol-details">
            <div class="farol-detail-item">
              <span class="farol-detail-value">${farol.deveriaConcluido}</span>
              <span class="farol-detail-label">Planejado</span>
            </div>
            <div class="farol-detail-item">
              <span class="farol-detail-value">${farol.realmenteConcluido}</span>
              <span class="farol-detail-label">Concluído</span>
            </div>
            <div class="farol-detail-item">
              <span class="farol-detail-value">${farol.diferencaPercentual}%</span>
              <span class="farol-detail-label">Diferença</span>
            </div>
          </div>
        </div>
        ` : ''}
        
        <!-- GRID PRINCIPAL: 2 COLUNAS -->
        <div class="executive-grid">
          
          <!-- COLUNA ESQUERDA -->
          <div class="executive-column">
            
            <!-- 1. STATUS GERAL -->
            <div class="executive-card executive-status-card" style="border-color: var(--border); box-shadow: 0 4px 24px rgba(0,0,0,0.2);">
              <div class="executive-status-content" style="align-items: center; justify-content: flex-start; gap: 24px;">
                <div class="executive-progress-ring">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#1F2937" stroke-width="8"/>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--accent)" stroke-width="8" 
                      stroke-dasharray="${progressPercent * 2.64} 264" stroke-linecap="round" 
                      transform="rotate(-90 50 50)">
                      <animate attributeName="stroke-dasharray" from="0 264" to="${progressPercent * 2.64} 264" dur="1s" fill="freeze"/>
                    </circle>
                  </svg>
                  <div class="executive-progress-text">
                    <span class="executive-percent" style="color: var(--text-primary)">${progressPercent}%</span>
                    <span class="executive-label" style="color: var(--text-muted)">concluído</span>
                  </div>
                </div>
                <div class="executive-status-info">
                  <div class="executive-status-label" style="color: var(--text-primary); font-size: 1.1rem; font-weight: 500;">Porcentagem de Conclusão</div>
                </div>
              </div>
            </div>

            <!-- 2. KPIs -->
            <div class="executive-kpis-grid">
              <div class="executive-kpi-card">
                <div class="executive-kpi-icon">📊</div>
                <div class="executive-kpi-value">${totals.issues}</div>
                <div class="executive-kpi-label">Total</div>
              </div>
              <div class="executive-kpi-card done">
                <div class="executive-kpi-icon">✓</div>
                <div class="executive-kpi-value">${totals.done}</div>
                <div class="executive-kpi-label">Concluídos</div>
              </div>
              <div class="executive-kpi-card progress">
                <div class="executive-kpi-icon">⚡</div>
                <div class="executive-kpi-value">${totals.inProgress}</div>
                <div class="executive-kpi-label">Em Andamento</div>
              </div>
              <div class="executive-kpi-card blocked">
                <div class="executive-kpi-icon">🚧</div>
                <div class="executive-kpi-value">${totals.blocked}</div>
                <div class="executive-kpi-label">Bloqueados</div>
              </div>
            </div>

            <!-- 3. ÚLTIMAS CONQUISTAS -->
            <div class="executive-card executive-list-card">
              <div class="executive-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Últimas Conquistas
              </div>
              <div class="executive-list-content">
                ${achievements.length > 0 ? achievements.map(a => `
                  <div class="executive-list-item achievement">
                    <span class="executive-list-icon">✓</span>
                    <div class="executive-list-body">
                      <span class="executive-list-title" title="${sanitizeTitle(a.title)}">${formatTicket(a)}</span>
                      <span class="executive-list-meta">${formatDate(a.resolvedAt)}</span>
                    </div>
                  </div>
                `).join('') : '<div class="executive-list-empty">Nenhuma conquista ainda</div>'}
              </div>
            </div>

            <!-- 4. PRÓXIMOS PASSOS -->
            <div class="executive-card executive-list-card">
              <div class="executive-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                Próximos Passos
              </div>
              <div class="executive-list-content">
                ${nextSteps.length > 0 ? nextSteps.map(n => `
                  <div class="executive-list-item">
                    <span class="executive-list-priority priority-${n.priority?.toLowerCase() || 'medium'}">${n.priority || 'Medium'}</span>
                    <div class="executive-list-body">
                      <span class="executive-list-title" title="${sanitizeTitle(n.title)}">${formatTicket(n)}</span>
                      <span class="executive-list-meta">${n.status}</span>
                    </div>
                  </div>
                `).join('') : '<div class="executive-list-empty">Nenhum próximo passo</div>'}
              </div>
            </div>
          </div>

          <!-- COLUNA DIREITA -->
          <div class="executive-column">
            
            <!-- 5. PROGRESSO DO PROJETO -->
            <div class="executive-card executive-progress-card">
              <div class="executive-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
                Progresso do Projeto
              </div>
              <div class="executive-bars">
                <div class="executive-bar-item">
                  <div class="executive-bar-header">
                    <span>Concluído</span>
                    <span class="executive-bar-count done">${totals.done} (${donePercent}%)</span>
                  </div>
                  <div class="executive-bar-track">
                    <div class="executive-bar-fill done" style="width: ${donePercent}%"></div>
                  </div>
                </div>
                <div class="executive-bar-item">
                  <div class="executive-bar-header">
                    <span>Em Progresso</span>
                    <span class="executive-bar-count progress">${totals.inProgress} (${progressBarPercent}%)</span>
                  </div>
                  <div class="executive-bar-track">
                    <div class="executive-bar-fill progress" style="width: ${progressBarPercent}%"></div>
                  </div>
                </div>
                <div class="executive-bar-item">
                  <div class="executive-bar-header">
                    <span>Bloqueado</span>
                    <span class="executive-bar-count blocked">${totals.blocked} (${blockedBarPercent}%)</span>
                  </div>
                  <div class="executive-bar-track">
                    <div class="executive-bar-fill blocked" style="width: ${blockedBarPercent}%"></div>
                  </div>
                </div>
                <div class="executive-bar-item">
                  <div class="executive-bar-header">
                    <span>Outros</span>
                    <span class="executive-bar-count">${totals.issues - totals.done - totals.inProgress - totals.blocked} (${otherPercent}%)</span>
                  </div>
                  <div class="executive-bar-track">
                    <div class="executive-bar-fill other" style="width: ${otherPercent}%"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 6. TIME DO PROJETO -->
            <div class="executive-card executive-team-card">
              <div class="executive-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                Time do Projeto
              </div>
              <div class="executive-team-grid">
                ${team.length > 0 ? team.map(t => `
                  <div class="executive-team-item">
                    <img src="${sanitizeTitle(t.avatar || '')}" class="executive-team-avatar" alt="${sanitizeTitle(t.name)}" onerror="this.style.display='none'">
                    <div class="executive-team-info">
                      <div class="executive-team-name" title="${sanitizeTitle(t.name)}">${sanitize(t.name)}</div>
                      <div class="executive-team-tickets">${t.totalTickets} tickets</div>
                    </div>
                  </div>
                `).join('') : '<div class="executive-list-empty">Nenhum membro</div>'}
              </div>
            </div>

            <!-- 7. PONTOS DE ACOMPANHAMENTO -->
            <div class="executive-card executive-risks-card">
              <div class="executive-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Pontos de Acompanhamento
              </div>
              <div class="executive-risks-content">
                ${risks.length > 0 ? risks.map(r => `
                  <div class="executive-risk-item risk-${r.level.toLowerCase()}">
                    <span class="executive-risk-badge ${r.level.toLowerCase()}" aria-label="Indicador visual do item"></span>
                    <div class="executive-risk-body">
                      <span class="executive-risk-title" title="${sanitizeTitle(r.title)}">${sanitize(r.key)} — ${sanitize(r.title)}</span>
                      <span class="executive-risk-meta">${sanitize(r.reason)} • Resp: ${sanitize(r.assignee)}</span>
                    </div>
                  </div>
                `).join('') : '<div class="executive-list-empty success">Nenhum item de acompanhamento pendente</div>'}
              </div>
            </div>
          </div>
        </div>

        </div>

      </div>
    </div>
  `;
}
