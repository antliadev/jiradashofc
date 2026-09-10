import { resolveStatusCategory, StatusCategory } from './models.js';

export const DEFAULT_PERFORMANCE_CONFIG = Object.freeze({
  staleBusinessDays: 3,
  lateReplanBusinessDays: 2,
  minimumSample: 5,
  weights: {
    originalDeadline: 30,
    currentDeadline: 20,
    replanning: 10,
    lateReplanning: 10,
    reopened: 10,
    commentCoverage: 10,
    staleCards: 10,
  },
  classifications: [
    { min: 90, label: 'Excelente' },
    { min: 80, label: 'Bom' },
    { min: 70, label: 'Adequado' },
    { min: 60, label: 'Atenção' },
    { min: 0, label: 'Crítico' },
  ],
});

function toDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayOnly(value) {
  const date = toDate(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function businessDaysBetween(startValue, endValue) {
  const start = dayOnly(startValue);
  const end = dayOnly(endValue);
  if (!start || !end) return 0;
  const direction = start <= end ? 1 : -1;
  let cursor = new Date(start);
  let days = 0;
  while ((direction > 0 && cursor < end) || (direction < 0 && cursor > end)) {
    cursor.setDate(cursor.getDate() + direction);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += direction;
  }
  return days;
}

function clampScore(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rateScore(good, total) {
  if (!total) return null;
  return clampScore((good / total) * 100);
}

function rawChangelogItems(card) {
  const histories = Array.isArray(card.rawChangelog?.histories) ? card.rawChangelog.histories : [];
  return histories.flatMap(history => (Array.isArray(history.items) ? history.items : []).map((item, index) => ({
    id: `${history.id || history.created || 'history'}:${index}`,
    at: history.created || null,
    author: history.author?.displayName || history.author?.name || 'Não informado',
    field: item.field || '',
    fieldId: item.fieldId || '',
    from: item.fromString || item.from || '',
    to: item.toString || item.to || '',
  })));
}

function isDueField(item) {
  const name = `${item.field} ${item.fieldId}`.toLowerCase();
  return name.includes('duedate') || name.includes('data limite') || name.includes('data de entrega');
}

export function dueDateChanges(card) {
  return rawChangelogItems(card)
    .filter(isDueField)
    .map(item => {
      const previous = dayOnly(item.from);
      const next = dayOnly(item.to);
      const changedAt = dayOnly(item.at);
      const daysBeforeDue = previous && changedAt ? businessDaysBetween(changedAt, previous) : null;
      const afterDue = previous && changedAt ? changedAt > previous : false;
      const late = daysBeforeDue !== null && daysBeforeDue >= 0 && daysBeforeDue <= DEFAULT_PERFORMANCE_CONFIG.lateReplanBusinessDays;
      return {
        ...item,
        previousDate: item.from || null,
        newDate: item.to || null,
        deltaBusinessDays: previous && next ? businessDaysBetween(previous, next) : null,
        classification: afterDue ? 'after_due' : late ? 'late' : 'planned',
      };
    });
}

export function reopenedEvents(card) {
  const statusItems = rawChangelogItems(card).filter(item => `${item.field} ${item.fieldId}`.toLowerCase().includes('status'));
  return statusItems.filter(item => {
    const fromDone = resolveStatusCategory(item.from || '') === StatusCategory.DONE;
    const toDone = resolveStatusCategory(item.to || '') === StatusCategory.DONE;
    return fromDone && !toDone;
  });
}

export function originalDueDate(card) {
  const changes = dueDateChanges(card);
  return changes.find(change => change.previousDate)?.previousDate || card.dueDate || card.plannedEndDate || null;
}

function deliveredOnOrBefore(card, deadline) {
  const resolved = dayOnly(card.resolvedAt);
  const due = dayOnly(deadline);
  if (!resolved || !due) return false;
  return resolved <= due;
}

function average(values) {
  const valid = values.filter(value => value !== null && value !== undefined && !Number.isNaN(value));
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

export function classifyPerformance(score, config = DEFAULT_PERFORMANCE_CONFIG) {
  if (score === null || score === undefined) return 'Não aplicável';
  return [...config.classifications].sort((a, b) => b.min - a.min).find(item => score >= item.min)?.label || 'Crítico';
}

export function calculateAnalystPerformance(cards, config = DEFAULT_PERFORMANCE_CONFIG) {
  const done = cards.filter(card => resolveStatusCategory(card.status) === StatusCategory.DONE);
  const doneWithCurrentDue = done.filter(card => card.dueDate || card.plannedEndDate);
  const doneWithOriginalDue = done.filter(card => originalDueDate(card));
  const currentOnTime = doneWithCurrentDue.filter(card => deliveredOnOrBefore(card, card.dueDate || card.plannedEndDate));
  const originalOnTime = doneWithOriginalDue.filter(card => deliveredOnOrBefore(card, originalDueDate(card)));
  const stale = cards.filter(card => resolveStatusCategory(card.status) !== StatusCategory.DONE && card.updatedAt && businessDaysBetween(card.updatedAt, new Date()) > config.staleBusinessDays);
  const commentsEligible = cards.filter(card => typeof card.humanCommentCount === 'number');
  const commented = commentsEligible.filter(card => Number(card.humanCommentCount || 0) > 0);
  const replans = cards.flatMap(card => dueDateChanges(card).map(change => ({ card, change })));
  const lateReplans = replans.filter(item => item.change.classification === 'late' || item.change.classification === 'after_due');
  const reopened = cards.flatMap(card => reopenedEvents(card).map(event => ({ card, event })));
  const avgOriginalDeviation = average(doneWithOriginalDue.map(card => businessDaysBetween(originalDueDate(card), card.resolvedAt)));

  const indicators = [
    {
      key: 'originalDeadline',
      category: 'Entrega',
      label: 'Prazo original',
      score: rateScore(originalOnTime.length, doneWithOriginalDue.length),
      result: `${originalOnTime.length} de ${doneWithOriginalDue.length}`,
      weight: config.weights.originalDeadline,
      cards: doneWithOriginalDue,
      formula: 'Cards entregues até a primeira data limite / cards concluídos com prazo original',
    },
    {
      key: 'currentDeadline',
      category: 'Entrega',
      label: 'Prazo atual',
      score: rateScore(currentOnTime.length, doneWithCurrentDue.length),
      result: `${currentOnTime.length} de ${doneWithCurrentDue.length}`,
      weight: config.weights.currentDeadline,
      cards: doneWithCurrentDue,
      formula: 'Cards entregues até a data limite vigente / cards concluídos com prazo',
    },
    {
      key: 'replanning',
      category: 'Previsibilidade',
      label: 'Replanejamentos',
      score: cards.length ? clampScore(100 - (new Set(replans.map(item => item.card.id)).size / cards.length) * 100) : null,
      result: `${replans.length} alterações em ${new Set(replans.map(item => item.card.id)).size} cards`,
      weight: config.weights.replanning,
      cards: replans.map(item => item.card),
      events: replans,
      formula: '100 - taxa de cards com alteração de Data Limite',
    },
    {
      key: 'lateReplanning',
      category: 'Previsibilidade',
      label: 'Replanejamentos tardios/após vencimento',
      score: replans.length ? clampScore(100 - (lateReplans.length / replans.length) * 100) : null,
      result: `${lateReplans.length} de ${replans.length}`,
      weight: config.weights.lateReplanning,
      cards: lateReplans.map(item => item.card),
      events: lateReplans,
      formula: '100 - taxa de replanejamentos tardios ou após vencimento',
    },
    {
      key: 'reopened',
      category: 'Qualidade',
      label: 'Cards reabertos',
      score: done.length || reopened.length ? clampScore(100 - (new Set(reopened.map(item => item.card.id)).size / Math.max(1, done.length + reopened.length)) * 100) : null,
      result: `${reopened.length} eventos em ${new Set(reopened.map(item => item.card.id)).size} cards`,
      weight: config.weights.reopened,
      cards: reopened.map(item => item.card),
      events: reopened,
      formula: '100 - taxa de cards que voltaram de concluído para execução',
    },
    {
      key: 'commentCoverage',
      category: 'Gestão dos Cards',
      label: 'Cobertura comentários',
      score: rateScore(commented.length, commentsEligible.length),
      result: `${commented.length} de ${commentsEligible.length}`,
      weight: config.weights.commentCoverage,
      cards: commentsEligible,
      formula: 'Cards com comentário humano / cards elegíveis',
    },
    {
      key: 'staleCards',
      category: 'Gestão dos Cards',
      label: 'Atualização recente',
      score: cards.length ? clampScore(100 - (stale.length / cards.length) * 100) : null,
      result: `${stale.length} sem atualização recente de ${cards.length}`,
      weight: config.weights.staleCards,
      cards: stale,
      formula: `100 - taxa de cards abertos sem atualização há mais de ${config.staleBusinessDays} dias úteis`,
    },
  ];

  const active = indicators.filter(item => item.score !== null && item.weight > 0);
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight ? Math.round(active.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight) : null;
  const categories = [...new Set(indicators.map(item => item.category))].map(category => {
    const rows = indicators.filter(item => item.category === category && item.score !== null);
    const weight = rows.reduce((sum, item) => sum + item.weight, 0);
    return {
      category,
      score: weight ? Math.round(rows.reduce((sum, item) => sum + item.score * item.weight, 0) / weight) : null,
    };
  });

  return {
    score,
    label: classifyPerformance(score, config),
    indicators,
    categories,
    replans,
    lateReplans,
    reopened,
    originalOnTimeRate: rateScore(originalOnTime.length, doneWithOriginalDue.length),
    currentOnTimeRate: rateScore(currentOnTime.length, doneWithCurrentDue.length),
    avgOriginalDeviation,
    audit: {
      cards: cards.length,
      done: done.length,
      doneWithCurrentDue: doneWithCurrentDue.length,
      doneWithOriginalDue: doneWithOriginalDue.length,
      changelogAvailable: cards.some(card => Number(card.changelogCount || 0) > 0 || rawChangelogItems(card).length > 0),
    },
  };
}

export function validatePerformanceWeights(weights = DEFAULT_PERFORMANCE_CONFIG.weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  return { valid: total === 100, total };
}
