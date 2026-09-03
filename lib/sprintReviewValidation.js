import { REVIEW_STATES, buildSprintReview } from '../src/data/sprint-review.js';
import { SPRINT_TEMPLATE_VERSION } from '../src/utils/sprint-review-render.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function validateReviewProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Perfil invalido.');
  const p = structuredClone(input || {});
  if (p.logo && !['antlia', 'crawford', 'docwise'].includes(p.logo)) fail('Identidade visual invalida.');
  if (p.causeTaxonomy && (!Array.isArray(p.causeTaxonomy) || p.causeTaxonomy.length > 30 || p.causeTaxonomy.some(c => typeof c !== 'string' || !c.trim() || c.length > 100))) fail('Taxonomia de causas invalida.');
  if (p.criticalPriorityIds && (!Array.isArray(p.criticalPriorityIds) || p.criticalPriorityIds.some(id => !/^\d+$/.test(id)))) fail('Prioridades criticas invalidas.');
  if (p.confidenceThresholds && (!Array.isArray(p.confidenceThresholds) || p.confidenceThresholds.length !== 2 || p.confidenceThresholds.some(n => !Number.isFinite(n) || n < 0 || n > 100) || p.confidenceThresholds[0] <= p.confidenceThresholds[1])) fail('Faixas de confianca invalidas.');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: p.timezone || '' }).format(0); } catch { fail('Timezone invalido.'); }
  if (!p.statusMap || typeof p.statusMap !== 'object' || Array.isArray(p.statusMap) || !Object.keys(p.statusMap).length || Object.entries(p.statusMap).some(([id, state]) => !/^\d+$/.test(id) || !Object.hasOwn(REVIEW_STATES, state))) fail('Mapeie os IDs dos status para estados canonicos.');
  if (!Array.isArray(p.eligibleTypes) || !p.eligibleTypes.length || p.eligibleTypes.some(id => !/^\d+$/.test(id))) fail('Selecione os tipos de card elegiveis.');
  for (const key of ['sprintField', 'startField', 'checklistField', 'groupField']) if (p[key] && !/^(customfield_\d+|labels)$/.test(p[key])) fail('Campo Jira invalido.');
  if (!p.sprintField || !['card', 'parent', 'hybrid', 'field', 'manual'].includes(p.grouping)) fail('Configure campo Sprint e agrupamento.');
  if (p.grouping === 'field' && !p.groupField) fail('Informe o campo de agrupamento.');
  if (p.allowParentChildAsDistinct && !['card', 'manual'].includes(p.grouping)) fail('Entregas distintas entre pai e filhos exigem agrupamento por card ou manual.');
  p.thresholds ||= [90, 70, 50];
  if (!Array.isArray(p.thresholds) || p.thresholds.length !== 3 || p.thresholds.some(n => !Number.isFinite(n) || n < 0 || n > 100) || !(p.thresholds[0] > p.thresholds[1] && p.thresholds[1] > p.thresholds[2])) fail('Faixas de resultado invalidas.');
  p.automation ||= {};
  if (typeof p.automation !== 'object' || Array.isArray(p.automation)) fail('Regras de automacao invalidas.');
  for (const key of ['accountIds', 'allowAccountIds', 'names', 'patterns']) {
    const list = p.automation[key] || [];
    if (!Array.isArray(list) || list.length > 100 || list.some(v => typeof v !== 'string' || !v.trim() || v.length > 200)) fail('Regra de automacao invalida.');
  }
  return p;
}
export function validateReviewChoices(source, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Agrupamento invalido.');
  const choices = structuredClone(input);
  const keys = new Set(source.issues.map(issue => issue.key));
  if (choices.groups != null && (typeof choices.groups !== 'object' || Array.isArray(choices.groups))) fail('Agrupamento invalido.');
  if (Object.entries(choices.groups || {}).some(([key, value]) => !keys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 100)) fail('Agrupamento invalido.');
  if (!Array.isArray(choices.optionalKeys || []) || (choices.optionalKeys || []).some(key => !keys.has(key))) fail('Card opcional invalido.');
  if (choices.confirmGrouping != null && typeof choices.confirmGrouping !== 'boolean') fail('Confirmacao de agrupamento invalida.');
  return choices;
}
export function prepareReviewSnapshot(source, input = {}) {
  const choices = validateReviewChoices(source, input.choices || {});
  const review = buildSprintReview({ ...source, choices });
  const errors = review.preflight.filter(p => p.severity === 'error');
  if (errors.length) fail(`Preflight bloqueou a review: ${errors.map(e => e.message).slice(0, 3).join(' ')}`);
  if (!choices.confirmGrouping) fail('Confirme explicitamente o agrupamento.');
  const acceptedWarnings = input.acceptedWarnings || [];
  if (!Array.isArray(acceptedWarnings) || acceptedWarnings.some(id => typeof id !== 'string')) fail('Confirmacoes invalidas.');
  if (review.preflight.some(p => p.severity === 'warning' && !acceptedWarnings.includes(p.id))) fail('Confirme todos os avisos do Preflight.');
  const edits = input.edits || {}, executiveEdits = input.executiveEdits || {};
  if (typeof edits !== 'object' || Array.isArray(edits) || typeof executiveEdits !== 'object' || Array.isArray(executiveEdits)) fail('Edicoes invalidas.');
  if (Object.entries(edits).some(([id, value]) => !review.statements.some(s => s.id === id) || typeof value !== 'string' || !value.trim() || value.length > 350)) fail('Texto de revisao invalido ou muito longo.');
  if (Object.entries(executiveEdits).some(([key, value]) => !Object.hasOwn(review.executive || {}, key) || typeof value !== 'string' || !value.trim() || value.length > 600)) fail('Texto executivo invalido ou muito longo.');
  const changed = Object.entries(edits).some(([id, text]) => review.statements.find(s => s.id === id).text !== text)
    || Object.entries(executiveEdits).some(([key, text]) => review.executive[key].text !== text);
  if (changed && input.confirmTextEdits !== true) fail('Revise e confirme os textos editados e suas evidencias.');
  const edit = (statement, text) => text === statement.text ? statement : {
    ...statement, originalText: statement.text, text, editedByHuman: true,
    kind: 'human_edit', support: 'human_reviewed', verifiedByAI: false,
  };
  review.statements = review.statements.map(s => Object.hasOwn(edits, s.id) ? edit(s, edits[s.id]) : s);
  review.executive = Object.fromEntries(Object.entries(review.executive || {}).map(([key, block]) => [key, Object.hasOwn(executiveEdits, key) ? edit(block, executiveEdits[key]) : block]));
  const goal = input.goal || null;
  if (goal && (!source.sprint.goal || goal.confirmed !== true || !['achieved', 'partial', 'not_achieved', 'insufficient'].includes(goal.result) || !Array.isArray(goal.evidenceIds) || (goal.result !== 'insufficient' && !goal.evidenceIds.length) || goal.evidenceIds.some(id => !review.evidence.some(e => e.id === id && e.provenance !== 'current_only')))) fail('A avaliacao do Goal exige confirmacao e evidencias validas.');
  review.goalAssessment = goal;
  return { review, acceptedWarnings, goal, textEditsConfirmed: changed && input.confirmTextEdits === true, templateVersion: SPRINT_TEMPLATE_VERSION, jiraBaseUrl: source.jiraBaseUrl, fetchedAt: source.fetchedAt };
}
