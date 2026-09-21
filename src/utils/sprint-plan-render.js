import { sanitize } from './helpers.js';

const esc = value => sanitize(String(value ?? ''));
export const SPRINT_PLAN_TEMPLATE_VERSION = 'antlia-sprint-plan-16x9-v1';
export const SPRINT_PLAN_STITCH_PROVENANCE = Object.freeze({ projectId: '12038302626029116856', screenId: '0399b1de9f944bebac027729e13dac07', usage: 'design_time_reference' });
const label = item => item.displayName || `${item.issueKey || item.key} — ${item.title || 'Sem título'}`;

export function sprintPlanPages(plan) {
  const items = plan?.items || [], pages = [];
  for (let index = 0; index < Math.max(1, items.length); index += 10) pages.push({ items: items.slice(index, index + 10) });
  return pages;
}

export function renderSprintPlanSlides(plan) {
  const pages = sprintPlanPages(plan);
  return pages.map((page, index) => {
    const continuities = page.items.filter(item => item.primaryOrigin !== 'new_planned');
    const risks = (plan.ai?.priorities || []).filter(entry => entry.category === 'risk').slice(index * 3, index * 3 + 3);
    return `<div class="sp-slide-shell"><article class="sp-slide" data-plan-slide="${index}" aria-label="Sprint Plan, página ${index + 1} de ${pages.length}"><header><span>ANTLIA DELIVERABLE SYSTEM</span><strong>STATUS EXECUTIVO · ${esc(plan.projectKey)} · ${esc(plan.targetSprint?.name || 'SPRINT ATUAL')}</strong></header><main><section class="sp-slide-lead"><small>PLANEJAMENTO DA SPRINT ATUAL</small><h2>${esc(plan.targetSprint?.name || 'Sprint')}</h2><p>${esc(plan.metrics?.planned ?? 0)} compromisso(s) inicial(is)</p><p>${esc(plan.metrics?.currentScope ?? page.items.length)} item(ns) no escopo atual</p><p>${esc(plan.metrics?.additionalScope ?? 0)} escopo(s) adicional(is)</p>${risks.length ? `<h3>RISCOS VALIDADOS</h3>${risks.map(risk => `<p>${esc(risk.displayName)}: ${esc(risk.text)}</p>`).join('')}` : ''}</section><div class="sp-slide-grid"><section><h3>CONTINUIDADES</h3>${continuities.map(item => `<article><span>${esc(label(item))}</span></article>`).join('') || '<p>Sem continuidades nesta página.</p>'}</section><section><h3>ESCOPO DA SPRINT</h3>${page.items.map(item => `<article><span>${esc(label(item))}</span><small>${item.addedAfterBaseline ? 'Escopo adicional' : item.primaryOrigin === 'carry_over' ? 'Carry-over' : item.primaryOrigin === 'replanned_before_close' ? 'Compromisso replanejado' : 'Compromisso da sprint'}</small></article>`).join('') || '<p>Nenhum item disponível.</p>'}</section></div></main><footer><strong>FOCO: CARRY-OVER → COMPROMISSOS → NOVO ESCOPO</strong><span>${esc(plan.readiness?.score ?? 0)}% de prontidão · Página ${index + 1}/${pages.length}</span></footer></article></div>`;
  }).join('');
}

export async function exportSprintPlanSlides(plan) {
  const { default: html2canvas } = await import('html2canvas');
  const container = document.createElement('div');
  container.className = 'sp-export'; container.innerHTML = renderSprintPlanSlides(plan); document.body.append(container);
  try {
    await document.fonts.ready;
    const nodes = [...container.querySelectorAll('.sp-slide')];
    for (const node of nodes) if ([node, ...node.querySelectorAll('*')].some(element => element.clientWidth && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2))) throw new Error('A arte excede o espaço disponível. Revise os textos antes de exportar.');
    for (const [index, node] of nodes.entries()) {
      const canvas = await html2canvas(node, { scale: 1.5, width: 1600, height: 900, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('O navegador não conseguiu gerar a imagem.');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `Sprint_Plan_${plan.projectKey}_${plan.targetSprint?.id}_${index + 1}.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } finally { container.remove(); }
}
