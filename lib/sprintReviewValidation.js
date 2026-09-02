import { REVIEW_STATES, buildSprintReview } from '../src/data/sprint-review.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function validateReviewProfile(input) {
  const p = structuredClone(input || {});
  if (p.logo && !['antlia', 'crawford', 'docwise'].includes(p.logo)) fail('Identidade visual invalida.');
  if (p.causeTaxonomy && (!Array.isArray(p.causeTaxonomy) || p.causeTaxonomy.length > 30 || p.causeTaxonomy.some(c => typeof c !== 'string' || !c.trim() || c.length > 100))) fail('Taxonomia de causas invalida.');
  if (p.criticalPriorityIds && (!Array.isArray(p.criticalPriorityIds) || p.criticalPriorityIds.some(id => !/^\d+$/.test(id)))) fail('Prioridades criticas invalidas.');
  if (p.confidenceThresholds && (!Array.isArray(p.confidenceThresholds) || p.confidenceThresholds.length !== 2 || p.confidenceThresholds.some(n => !Number.isFinite(n) || n < 0 || n > 100) || p.confidenceThresholds[0] <= p.confidenceThresholds[1])) fail('Faixas de confianca invalidas.');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: p.timezone || '' }).format(0); } catch { fail('Timezone invalido.'); }
  if (!p.statusMap || !Object.keys(p.statusMap).length || Object.entries(p.statusMap).some(([id, state]) => !/^\d+$/.test(id) || !Object.hasOwn(REVIEW_STATES, state))) fail('Mapeie os IDs dos status para estados canonicos.');
  if (!p.eligibleTypes?.length || p.eligibleTypes.some(id => !/^\d+$/.test(id))) fail('Selecione os tipos de card elegiveis.');
  for (const key of ['sprintField', 'startField', 'checklistField', 'groupField']) if (p[key] && !/^(customfield_\d+|labels)$/.test(p[key])) fail('Campo Jira invalido.');
  if (!p.sprintField || !['card', 'parent', 'hybrid', 'field', 'manual'].includes(p.grouping)) fail('Configure campo Sprint e agrupamento.');
  if (p.grouping === 'field' && !p.groupField) fail('Informe o campo de agrupamento.');
  if (p.allowParentChildAsDistinct && !['card', 'manual'].includes(p.grouping)) fail('Entregas distintas entre pai e filhos exigem agrupamento por card ou manual.');
  p.thresholds ||= [90, 70, 50];
  if (p.thresholds.length !== 3 || p.thresholds.some(n => !Number.isFinite(n) || n < 0 || n > 100) || !(p.thresholds[0] > p.thresholds[1] && p.thresholds[1] > p.thresholds[2])) fail('Faixas de resultado invalidas.');
  p.automation ||= {};
  for (const key of ['accountIds', 'allowAccountIds', 'names', 'patterns']) {
    const list = p.automation[key] || [];
    if (!Array.isArray(list) || list.length > 100 || list.some(v => typeof v !== 'string' || !v.trim() || v.length > 200)) fail('Regra de automacao invalida.');
  }
  return p;
}
export function prepareReviewSnapshot(source, input = {}) {
  const choices = input.choices || {};
  const keys = new Set(source.issues.map(issue => issue.key));
  if (Object.entries(choices.groups || {}).some(([key, value]) => !keys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 100)) fail('Agrupamento invalido.');
  if (!Array.isArray(choices.optionalKeys || []) || (choices.optionalKeys || []).some(key => !keys.has(key))) fail('Card opcional invalido.');
  const review = buildSprintReview({ ...source, choices });
  const errors = review.preflight.filter(p => p.severity === 'error');
  if (errors.length) fail(`Preflight bloqueou a review: ${errors.map(e => e.message).slice(0, 3).join(' ')}`);
  if (!choices.confirmGrouping) fail('Confirme explicitamente o agrupamento.');
  const acceptedWarnings = input.acceptedWarnings || [];
  if (review.preflight.some(p => p.severity === 'warning' && !acceptedWarnings.includes(p.id))) fail('Confirme todos os avisos do Preflight.');
  const edits = input.edits || {};
  if (Object.entries(edits).some(([id, value]) => !review.statements.some(s => s.id === id) || typeof value !== 'string' || value.length > 350)) fail('Texto de revisao invalido ou muito longo.');
  review.statements = review.statements.map(s => Object.hasOwn(edits, s.id) ? { ...s, originalText: s.text, text: edits[s.id], editedByHuman: true } : s);
  const goal = input.goal || null;
  if (goal && (!source.sprint.goal || !goal.confirmed || !['achieved', 'partial', 'not_achieved', 'insufficient'].includes(goal.result) || !Array.isArray(goal.evidenceIds) || (goal.result !== 'insufficient' && !goal.evidenceIds.length) || goal.evidenceIds.some(id => !review.evidence.some(e => e.id === id)))) fail('A avaliacao do Goal exige confirmacao e evidencias validas.');
  review.goalAssessment = goal;
  return { review, acceptedWarnings, goal, templateVersion: 'antlia-sprint-16x9-v1', jiraBaseUrl: source.jiraBaseUrl, fetchedAt: source.fetchedAt };
}
