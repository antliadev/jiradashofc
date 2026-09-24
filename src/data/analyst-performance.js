import { resolveStatusCategory, StatusCategory } from './models.js';

export const DEFAULT_PERFORMANCE_CONFIG = Object.freeze({
  staleBusinessDays: 3,
  lateReplanBusinessDays: 2,
  minimumSample: 5,
  weights: {
    completedCards: 15,
    originalDeadline: 20,
    deliveryDelays: 20,
    blockedDeliveries: 10,
    commentCoverage: 20,
    staleCards: 5,
    replanning: 10,
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

function isStatusField(item) {
  const name = `${item.field} ${item.fieldId}`.toLowerCase();
  return name.includes('status');
}

function dateKey(value) {
  const date = dayOnly(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function statusEvents(card) {
  return rawChangelogItems(card)
    .filter(isStatusField)
    .filter(item => item.at)
    .sort((a, b) => toDate(a.at) - toDate(b.at));
}

function statusAt(card, at) {
  const target = toDate(at);
  if (!target) return card.status || '';
  let status = card.status || '';
  const events = statusEvents(card);
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const changedAt = toDate(event.at);
    if (!changedAt) continue;
    if (changedAt > target) {
      status = event.from || status;
      continue;
    }
    return event.to || status;
  }
  return events[0]?.from || status;
}

function isDelayEligibleStatus(status) {
  const category = resolveStatusCategory(status || '');
  return category === StatusCategory.TODO || category === StatusCategory.IN_PROGRESS;
}

function isStaleEligibleStatus(status) {
  const category = resolveStatusCategory(status || '');
  return category !== StatusCategory.DONE && category !== StatusCategory.TODO;
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

export function dueDateHistory(card) {
  const dates = [];
  const seen = new Set();
  const add = value => {
    const key = dateKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    dates.push(value);
  };

  dueDateChanges(card).forEach(change => {
    add(change.previousDate);
    add(change.newDate);
  });
  add(card.dueDate || card.plannedEndDate);
  return dates;
}

export function deliveryDelayEvents(cards, { now = new Date() } = {}) {
  const today = dayOnly(now);
  if (!today) return [];

  return cards.flatMap(card => dueDateHistory(card)
    .filter(dueDate => {
      const due = dayOnly(dueDate);
      if (!due || due >= today) return false;
      const resolved = dayOnly(card.resolvedAt);
      return !resolved || resolved > due;
    })
    .map(dueDate => {
      const statusAtDueDate = statusAt(card, dueDate);
      return {
        card,
        dueDate,
        statusAtDueDate,
      };
    })
    .filter(event => isDelayEligibleStatus(event.statusAtDueDate)));
}

export function historicalBlockedEvents(cards) {
  return cards.flatMap(card => statusEvents(card)
    .filter(event => resolveStatusCategory(event.to || '') === StatusCategory.BLOCKED)
    .map(event => ({ card, event })));
}

export function reopenedEvents(card) {
  const statusItems = rawChangelogItems(card).filter(isStatusField);
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
  const originalOnTime = doneWithOriginalDue.filter(card => !dueDateChanges(card).length && deliveredOnOrBefore(card, originalDueDate(card)));
  const stale = cards.filter(card => isStaleEligibleStatus(card.status) && card.updatedAt && businessDaysBetween(card.updatedAt, new Date()) > config.staleBusinessDays);
  const commentsEligible = cards.filter(card => typeof card.humanCommentCount === 'number');
  const commented = commentsEligible.filter(card => Number(card.humanCommentCount || 0) > 0);
  const replans = cards.flatMap(card => dueDateChanges(card).map(change => ({ card, change })));
  const lateReplans = replans.filter(item => item.change.classification === 'late' || item.change.classification === 'after_due');
  const deliveryDelays = deliveryDelayEvents(cards);
  const blockedEvents = historicalBlockedEvents(cards);
  const reopened = cards.flatMap(card => reopenedEvents(card).map(event => ({ card, event })));
  const avgOriginalDeviation = average(doneWithOriginalDue.map(card => businessDaysBetween(originalDueDate(card), card.resolvedAt)));

  const indicators = [
    {
      key: 'completedCards',
      category: 'Entrega',
      label: 'Cards concluídos',
      score: cards.length ? rateScore(done.length, cards.length) : null,
      result: `${done.length} de ${cards.length}`,
      weight: config.weights.completedCards,
      cards: done,
      formula: 'Cards concluídos / cards sob responsabilidade no período',
    },
    {
      key: 'originalDeadline',
      category: 'Entrega',
      label: 'Entregas no primeiro prazo',
      score: rateScore(originalOnTime.length, doneWithOriginalDue.length),
      result: `${originalOnTime.length} de ${doneWithOriginalDue.length}`,
      weight: config.weights.originalDeadline,
      cards: originalOnTime,
      formula: 'Cards concluídos até a primeira Data Limite e sem postergação / cards concluídos com prazo original',
    },
    {
      key: 'deliveryDelays',
      category: 'Entrega',
      label: 'Quantidade de atrasos nas entregas',
      score: cards.length ? clampScore(100 - (new Set(deliveryDelays.map(item => item.card.id)).size / cards.length) * 100) : null,
      result: `${deliveryDelays.length} atraso(s) em ${new Set(deliveryDelays.map(item => item.card.id)).size} cards`,
      weight: config.weights.deliveryDelays,
      cards: deliveryDelays.map(item => item.card),
      events: deliveryDelays,
      formula: '100 - taxa de cards com prazo vencido em Itens pendentes ou Em andamento, mantendo histórico após alteração ou conclusão',
    },
    {
      key: 'replanning',
      category: 'Previsibilidade',
      label: 'Quantidade de alteração no prazo',
      score: cards.length ? clampScore(100 - (new Set(replans.map(item => item.card.id)).size / cards.length) * 100) : null,
      result: `${replans.length} alterações em ${new Set(replans.map(item => item.card.id)).size} cards`,
      weight: config.weights.replanning,
      cards: replans.map(item => item.card),
      events: replans,
      formula: '100 - taxa de cards com alteração de Data Limite',
    },
    {
      key: 'blockedDeliveries',
      category: 'Gestão dos Cards',
      label: 'Quantidade de bloqueios nas entregas',
      score: cards.length ? clampScore(100 - (new Set(blockedEvents.map(item => item.card.id)).size / cards.length) * 100) : null,
      result: `${blockedEvents.length} bloqueio(s) em ${new Set(blockedEvents.map(item => item.card.id)).size} cards`,
      weight: config.weights.blockedDeliveries,
      cards: blockedEvents.map(item => item.card),
      events: blockedEvents,
      formula: 'Conta entradas em status Bloqueado, mantendo histórico após desbloqueio',
    },
    {
      key: 'lateReplanning',
      category: 'Previsibilidade',
      label: 'Replanejamentos tardios/após vencimento',
      score: replans.length ? clampScore(100 - (lateReplans.length / replans.length) * 100) : null,
      result: `${lateReplans.length} de ${replans.length}`,
      weight: 0,
      cards: lateReplans.map(item => item.card),
      events: lateReplans,
      formula: 'Indicador auditável sem peso próprio; o impacto entra em Quantidade de alteração no prazo',
    },
    {
      key: 'reopened',
      category: 'Qualidade',
      label: 'Cards reabertos',
      score: done.length || reopened.length ? clampScore(100 - (new Set(reopened.map(item => item.card.id)).size / Math.max(1, done.length + reopened.length)) * 100) : null,
      result: `${reopened.length} eventos em ${new Set(reopened.map(item => item.card.id)).size} cards`,
      weight: 0,
      cards: reopened.map(item => item.card),
      events: reopened,
      formula: 'Indicador auditável sem peso na composição definida para a nota atual',
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
      formula: `100 - taxa de cards em andamento/bloqueados sem atualização há mais de ${config.staleBusinessDays} dias úteis; concluídos e itens pendentes não entram`,
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
    deliveryDelays,
    blockedEvents,
    reopened,
    originalOnTimeCards: originalOnTime,
    currentOnTimeCards: currentOnTime,
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
