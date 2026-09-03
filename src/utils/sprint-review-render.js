import { sanitize } from './helpers.js';

const esc = value => sanitize(String(value ?? ''));
export const SPRINT_TEMPLATE_VERSION = 'antlia-sprint-16x9-v2';
export const executiveLabels = { highlight: 'Destaque positivo', attention: 'Ponto de atenção', justification: 'Justificativa', achievement: 'Principal conquista', nextStep: 'Próximo passo' };
const labels = { done: 'Concluído', partial: 'Parcial', removed: 'Removido', blocked: 'Bloqueado', continuity: 'Continuidade' };

export function executiveBlocks(review) {
  const done = (review.deliveries || []).find(d => d.planned && d.result === 'done');
  const pending = (review.deliveries || []).find(d => d.planned && d.result !== 'done');
  const statement = (review.statements || []).find(s => pending?.keys?.includes(s.issueKey));
  const defaults = {
    highlight: { text: done ? `${done.title}: concluído no fechamento.` : 'Nenhuma conquista confirmada nos dados disponíveis.', evidenceIds: done?.evidenceIds || [] },
    attention: { text: pending ? `${pending.title}: ${labels[pending.result] || 'resultado não informado'} no fechamento.` : 'Nenhuma pendência identificada nas entregas disponíveis.', evidenceIds: pending?.evidenceIds || [] },
    justification: { text: statement?.text || `${review.metrics.completed} de ${review.metrics.planned} entregas planejadas concluídas. ${pending ? 'Causa não registrada; revise as evidências.' : 'Resultado conforme os fatos do fechamento.'}`, evidenceIds: statement?.evidenceIds || [] },
    achievement: { text: `${review.metrics.completed} de ${review.metrics.planned} entregas principais concluídas (${review.metrics.achievement}%).`, evidenceIds: done?.evidenceIds || [] },
    nextStep: { text: 'Próximo passo não documentado.', evidenceIds: [] },
  };
  return Object.fromEntries(Object.keys(executiveLabels).map(key => [key, { id: `executive:${key}`, kind: key, ...defaults[key], ...(review.executive?.[key] || {}) }]));
}

export function formatReviewDate(value, timezone = 'America/Sao_Paulo') {
  if (!value) return 'Não informado';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(value)); }
  catch { return 'Não informado'; }
}
export function deliveryDates(review, delivery, closing = false) {
  const dates = delivery[closing ? 'closingDates' : 'plannedDates'];
  const values = dates ?? (review.items || []).filter(i => delivery.keys?.includes(i.key)).map(i => i[closing ? 'closing' : 'baseline']?.duedate).filter(Boolean);
  return [...new Set(values)].map(value => formatReviewDate(value, review.profile.timezone)).join(' · ') || 'Não informado';
}

// Keep complete deliveries and executive blocks together; oversized content is rejected before export.
export function sprintSlidePages(review) {
  const pages = [{ type: 'executive', rows: [], blocks: [] }];
  let page = pages[0], used = 0;
  for (const d of review.deliveries || []) {
    const row = { ...d, plannedDate: deliveryDates(review, d, false), closingDate: deliveryDates(review, d, true) };
    const cost = Math.max(1, Math.ceil(String(d.title).length / 58), Math.ceil(Math.max(row.plannedDate.length, row.closingDate.length) / 45));
    if (used + cost > 6 && page.rows.length) { page = { type: 'deliveries', rows: [], blocks: [] }; pages.push(page); used = 0; }
    page.rows.push(row); used += cost;
  }
  const blocks = Object.entries(executiveBlocks(review)).map(([key, block]) => ({ ...block, key }));
  const summaries = {
    highlight: `${review.metrics.completed} entregas planejadas concluídas no fechamento.`,
    attention: `${(review.deliveries || []).filter(d => d.planned && d.result !== 'done').length} entregas planejadas não concluídas no fechamento.`,
    justification: `${review.metrics.completed} de ${review.metrics.planned} entregas planejadas concluídas (${review.metrics.achievement}%). Adicionais: ${review.metrics.additional ?? 0}, separados do baseline.`,
    achievement: `${review.classification}: ${review.metrics.completed} de ${review.metrics.planned} entregas concluídas.`,
    nextStep: 'Próximo passo não documentado.',
  };
  const continuation = [];
  pages[0].blocks = blocks.map(b => {
    // Engine detail lists repeat the rows and totals already present on this slide.
    const repeatedFacts = !b.editedByHuman && b.details?.length && b.details.every(d => d.kind !== 'interpretation' && (d.id.endsWith(':detail') || ['executive:baseline-result', 'achievement:classification', 'highlight:none', 'attention:none', 'next-step:unknown'].includes(d.id)));
    if (b.text.length <= (['achievement', 'nextStep'].includes(b.key) ? 150 : 155)) return b;
    if (!repeatedFacts) {
      if (b.overflow && b.details?.length && !b.editedByHuman) continuation.push(...b.details.map(detail => ({ ...b, text: detail.text, evidenceIds: detail.evidenceIds, detailId: detail.id })));
      else continuation.push(b);
    }
    return { ...b, text: `${summaries[b.key]}${repeatedFacts ? '' : ' Texto completo na continuação.'}`, summary: true };
  });
  for (let i = 0; i < continuation.length; i += 2) pages.push({ type: 'context', rows: [], blocks: continuation.slice(i, i + 2) });
  return pages;
}

export function renderSprintSlides({ review, approved = false }) {
  const pages = sprintSlidePages(review), timezone = review.profile.timezone;
  const normalized = String(review.classification || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const severity = normalized.includes('nao atingida') ? 'danger' : normalized.includes('abaixo') ? 'warning' : normalized.includes('parcial') ? 'partial' : normalized.includes('atingida') ? 'success' : 'neutral';
  const goal = review.goalAssessment?.confirmed ? { achieved: 'Atingido', partial: 'Parcialmente atingido', not_achieved: 'Não atingido', insufficient: 'Evidência insuficiente' }[review.goalAssessment.result] : '';
  const logo = { antlia: '/antlia-logo.png', crawford: '/crawford-logo.png', docwise: '/docwise-logo.png' }[review.profile.logo || 'antlia'];
  const block = b => `<section class="sr-executive-block sr-block-${b.key}"><h3>${executiveLabels[b.key]}</h3><p>${esc(b.text)}</p></section>`;
  return pages.map((page, index) => `<div class="sr-slide-shell"><article class="sr-slide sr-slide-${page.type} sr-severity-${severity}" data-classification="${esc(review.classification)}" data-slide="${index}" aria-label="Sprint Review, página ${index + 1} de ${pages.length}">
    <header><div>${logo ? `<img class="sr-slide-logo" src="${logo}" alt="${esc(review.profile.logo || 'Antlia')}">` : ''}</div><div class="sr-slide-heading"><span>RADAR JIRA ANTLIA</span><h1>STATUS EXECUTIVO · ${esc(review.projectKey)}</h1><h2>${esc(review.sprint.name)} · RESULTADO X PLANEJADO</h2><small>Início: ${esc(formatReviewDate(review.sprint.startDate, timezone))} · Fim previsto: ${esc(formatReviewDate(review.sprint.endDate, timezone))}</small></div><aside>${review.mode === 'current' ? 'DADOS ATUAIS · REPROCESSADA' : approved ? 'REVIEW APROVADA' : 'PRÉVIA · NÃO APROVADA'}</aside></header>
    <section class="sr-slide-score"><strong>${esc(review.metrics.achievement)}%</strong><div><h2>${esc(review.classification)}</h2><p>${esc(review.metrics.completed)} de ${esc(review.metrics.planned)} entregas principais concluídas</p></div></section>
    <main>${page.type === 'context' ? '<h2>CONTEXTO EXECUTIVO · CONTINUAÇÃO</h2>' : `<div class="sr-slide-columns"><h3>PLANEJADO / ESCOPO</h3><h3>RESULTADO NO FECHAMENTO</h3></div>${page.rows.map(row => `<section class="sr-slide-row"><div><small>${row.planned ? 'Baseline' : 'Escopo adicional'} · ${esc(row.plannedDate)}</small><p>${esc(row.title)}</p></div><div><strong>${esc(labels[row.result] || 'Não informado')}</strong><small>Data no corte: ${esc(row.closingDate)}</small></div></section>`).join('') || '<p>Nenhuma entrega disponível.</p>'}`}</main>
    <div class="sr-slide-callouts">${page.blocks.filter(b => page.type === 'context' || !['achievement', 'nextStep'].includes(b.key)).map(block).join('')}</div>
    <footer><div class="sr-slide-outcome">${page.blocks.filter(b => page.type !== 'context' && ['achievement', 'nextStep'].includes(b.key)).map(block).join('')}</div><small>${goal ? `Goal confirmado: ${esc(goal)} · ` : ''}${review.metrics.carryOverUnknown ? `${esc(review.metrics.carryOverUnknown)} destinos não confirmados · ` : ''}Adicionais: ${esc(review.metrics.additional)} · Confiança documental: ${esc(review.confidence)}% · Corte: ${esc(formatReviewDate(review.sprint.completeDate, timezone))} · ${esc(timezone)} · Página ${index + 1}/${pages.length}</small></footer>
    </article></div>`).join('');
}

export async function exportSprintSlides(review, snapshotId, { persist } = {}) {
  const { default: html2canvas } = await import('html2canvas');
  const container = document.createElement('div');
  container.className = 'sr-export';
  container.innerHTML = renderSprintSlides({ review, approved: true });
  document.body.append(container);
  try {
    await document.fonts.ready;
    await Promise.all([...container.querySelectorAll('img')].map(img => img.decode()));
    const nodes = [...container.querySelectorAll('.sr-slide')];
    for (const node of nodes) {
      const overflowing = [node, ...node.querySelectorAll('*')].some(el => el.clientWidth && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2));
      if (overflowing) throw new Error('A arte excede o espaço disponível. Revise os textos antes de exportar.');
    }
    const blobs = [];
    for (const node of nodes) {
      const canvas = await html2canvas(node, { scale: 1.5, width: 1600, height: 900, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('O navegador não conseguiu gerar a imagem.');
      blobs.push(blob);
    }
    for (const [index, blob] of blobs.entries()) if (persist) await persist(blob, index + 1);
    for (const [index, blob] of blobs.entries()) {
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `Sprint_Review_${review.projectKey}_${review.sprint.id}_${snapshotId}_${index + 1}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } finally { container.remove(); }
}
