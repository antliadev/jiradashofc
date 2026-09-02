import { isCardOverdue, resolveStatusCategory, StatusCategory } from './models.js';

export const HEALTH_DIMENSIONS = Object.freeze([
  { key: 'prazo', label: 'Prazo', weight: 25 },
  { key: 'fluxo', label: 'Fluxo', weight: 20 },
  { key: 'bloqueio', label: 'Bloqueio', weight: 20 },
  { key: 'qualidade', label: 'Qualidade', weight: 15 },
  { key: 'escopo', label: 'Escopo', weight: 10 },
  { key: 'governanca', label: 'Governanca', weight: 10 },
]);

const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
const ratio = (count, total) => total ? count / total : 0;

function dimensionScore(cards, key) {
  const total = cards.length;
  if (!total) return 100;
  const done = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE).length;
  const blocked = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.BLOCKED).length;
  const overdue = cards.filter(isCardOverdue).length;
  const missingOwner = cards.filter(card => !card.assigneeId || card.assigneeId === 'unassigned').length;
  const missingDueDate = cards.filter(card => !card.dueDate && !card.plannedEndDate).length;
  const missingPriority = cards.filter(card => !card.priority || card.priority === 'medium' && !card.rawPriority).length;
  const automationOnly = cards.filter(card => card.humanCommentCount === 0 && card.automationCommentCount > 0).length;
  const noComment = cards.filter(card => card.humanCommentCount === 0 && card.commentCount === 0).length;

  switch (key) {
    case 'prazo': return clamp(100 - ratio(overdue, total) * 75 - ratio(missingDueDate, total) * 25);
    case 'fluxo': return clamp(100 - ratio(blocked, total) * 60 - ratio(total - done - blocked, total) * 15);
    case 'bloqueio': return clamp(100 - ratio(blocked, total) * 100);
    case 'qualidade': return clamp(100 - ratio(automationOnly, total) * 60 - ratio(noComment, total) * 40);
    case 'escopo': return clamp(100 - ratio(missingDueDate, total) * 50 - ratio(total - done, total) * 25);
    case 'governanca': return clamp(100 - ratio(missingOwner, total) * 60 - ratio(missingPriority, total) * 40);
    default: return 100;
  }
}

export function classifyProjectHealth(score, hasCards = true) {
  if (!hasCards) return { key: 'unknown', label: 'Sem dados suficientes' };
  if (score >= 85) return { key: 'healthy', label: 'Saudavel' };
  if (score >= 70) return { key: 'attention', label: 'Atencao' };
  if (score >= 50) return { key: 'risk', label: 'Em risco' };
  return { key: 'critical', label: 'Critico' };
}

export function calculateProjectHealth(cards = []) {
  const dimensionScores = HEALTH_DIMENSIONS.map(({ key, label, weight }) => ({
    key,
    label,
    weight,
    score: dimensionScore(cards, key),
  }));
  const score = cards.length
    ? clamp(dimensionScores.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / 100)
    : null;
  const classification = classifyProjectHealth(score || 0, cards.length > 0);
  const impacts = dimensionScores
    .map(dimension => ({ ...dimension, impact: Math.round((100 - dimension.score) * dimension.weight / 100) }))
    .filter(dimension => dimension.impact > 0)
    .sort((a, b) => b.impact - a.impact);
  const reasons = impacts.slice(0, 3).map(item => `${item.label}: ${item.score}/100`);
  const dimensions = dimensionScores.map(dimension => ({
    ...dimension,
    impact: impacts.find(item => item.key === dimension.key)?.impact || 0,
  }));
  return { score, dimensions, classification, impacts, reasons };
}

export function calculateCardImpact(card = {}) {
  const reasons = [];
  let impact = 0;
  if (isCardOverdue(card)) { impact += 25; reasons.push('atrasado'); }
  if (resolveStatusCategory(card.status) === StatusCategory.BLOCKED) { impact += 25; reasons.push('bloqueado'); }
  if (!card.dueDate && !card.plannedEndDate) { impact += 15; reasons.push('sem prazo'); }
  if (!card.assigneeId || card.assigneeId === 'unassigned') { impact += 15; reasons.push('sem responsavel'); }
  if (card.humanCommentCount === 0) { impact += 10; reasons.push('sem comentario humano'); }
  if (!card.priority || card.priority === 'medium' && !card.rawPriority) { impact += 10; reasons.push('sem prioridade'); }
  return { impact, reasons };
}
