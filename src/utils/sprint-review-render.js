import { sanitize } from './helpers.js';

const esc = value => sanitize(String(value ?? ''));
const labels = { done: 'Concluido', partial: 'Parcial', removed: 'Removido', blocked: 'Bloqueado', continuity: 'Continuidade' };
function chunks(text, size) {
  const chars = Array.from(String(text));
  const parts = [];
  for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(''));
  return parts.length ? parts : [''];
}
export function sprintSlidePages(review) {
  const rows = review.deliveries.flatMap(d => chunks(d.title, 120).map((title, index) => ({ title: `${index ? '(continuacao) ' : ''}${title}`, scope: d.planned ? 'Planejado' : 'Adicional', result: labels[d.result], keys: d.keys.join(', ') })));
  const pages = [];
  for (let i = 0; i < rows.length; i += 4) pages.push({ type: 'deliveries', rows: rows.slice(i, i + 4) });
  const statements = review.statements.flatMap(s => chunks(s.text, 300).map(text => ({ text, key: s.issueKey })));
  for (let i = 0; i < statements.length; i += 3) pages.push({ type: 'statements', rows: statements.slice(i, i + 3) });
  return pages;
}
export function renderSprintSlides({ review, approved = false }) {
  const pages = sprintSlidePages(review);
  const goal = review.goalAssessment?.confirmed ? { achieved: 'Atingido', partial: 'Parcialmente atingido', not_achieved: 'Nao atingido', insufficient: 'Evidencia insuficiente' }[review.goalAssessment.result] : '';
  const logo = { antlia: '/antlia-logo.png', crawford: '/crawford-logo.png', docwise: '/docwise-logo.png' }[review.profile.logo || 'antlia'];
  return pages.map((page, index) => `<div class="sr-slide-shell"><article class="sr-slide" data-slide="${index}">
    <header><div><span>RADAR JIRA ANTLIA</span><h1>STATUS EXECUTIVO · ${esc(review.projectKey)}</h1><h2 style="${review.sprint.name.length > 80 ? 'font-size:16px' : ''}">${esc(review.sprint.name)} · RESULTADO X PLANEJADO</h2></div>
    <aside>${logo ? `<img class="sr-slide-logo" src="${logo}" alt="Identidade visual">` : ''}<b>${review.mode === 'current' ? 'DADOS ATUAIS · REPROCESSADA' : approved ? 'REVIEW APROVADA' : 'PREVIA · NAO APROVADA'}</b>${goal ? `<small>Goal: ${goal}</small>` : ''}</aside></header>
    <section class="sr-slide-score"><strong>${review.metrics.achievement}%</strong><div><h2>${esc(review.classification)}</h2><p>${review.metrics.completed} de ${review.metrics.planned} entregas principais concluidas</p></div></section>
    <main>${page.type === 'deliveries' ? '<div class="sr-slide-columns"><strong>PLANEJADO / ESCOPO</strong><strong>RESULTADO NO FECHAMENTO</strong></div>' : '<h2>CONTEXTO E PROXIMOS PASSOS</h2>'}
    ${page.rows.map(row => page.type === 'deliveries' ? `<section class="sr-slide-row"><div><small>${esc(row.scope)}</small><p>${esc(row.title)}</p></div><div><strong>${esc(row.result)}</strong></div></section>` : `<section class="sr-slide-statement"><strong>${esc(row.key)}</strong><p>${esc(row.text)}</p></section>`).join('')}</main>
    <footer><p>Adicionais: ${review.metrics.additional} · Carry-over: ${review.metrics.carryOver} cards · Confianca documental: ${review.confidence}%</p><small>Corte: ${esc(review.sprint.completeDate)} · ${esc(review.profile.timezone)} · Pagina ${index + 1}/${pages.length}</small></footer>
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
    for (const [index, node] of [...container.querySelectorAll('.sr-slide')].entries()) {
      const overflowing = [node, ...node.querySelectorAll('header, main, footer, p, h1, h2, .sr-slide-row, .sr-slide-statement')].some(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
      if (overflowing) throw new Error('A arte excede o espaco disponivel. Revise o texto antes de exportar.');
      const canvas = await html2canvas(node, { scale: 1.5, width: 1600, height: 900, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('O navegador nao conseguiu gerar a imagem.');
      if (persist) await persist(blob, index + 1);
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `Sprint_Review_${review.projectKey}_${review.sprint.id}_${snapshotId}_${index + 1}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } finally { container.remove(); }
}
