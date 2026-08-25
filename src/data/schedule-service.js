import {
  resolveStatusCategory,
  StatusCategory,
  isCardOverdue,
} from './models.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function toISODate(value) {
  const date = toDate(value);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function signedDaysBetween(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

export function inclusiveDaysBetween(start, end) {
  const diff = signedDaysBetween(start, end);
  if (diff === null) return null;
  return Math.max(1, diff + 1);
}

export function isDone(cardOrStatus) {
  const status = typeof cardOrStatus === 'string' ? cardOrStatus : cardOrStatus?.status;
  return resolveStatusCategory(status || '') === StatusCategory.DONE
    || String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('concluido')
    || String(status || '').toLowerCase().includes('done');
}

export function isBlocked(card) {
  const category = resolveStatusCategory(card?.status || '');
  const status = String(card?.status || '').toLowerCase();
  return category === StatusCategory.BLOCKED || status.includes('block') || status.includes('bloq');
}

export function getCardStartDate(card) {
  return toISODate(card?.plannedStartDate || card?.startDate);
}

export function getCardEndDate(card) {
  return toISODate(card?.plannedEndDate || card?.dueDate);
}

export function getProjectEffectiveStartDate(cards) {
  const planned = cards
    .map(card => toDate(card.plannedStartDate || card.startDate))
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (planned.length) {
    return { date: toISODate(planned[0]), source: 'planned_start' };
  }

  return { date: null, source: 'missing' };
}

export function getProjectEffectiveEndDate(cards) {
  const ends = cards
    .map(card => toDate(card.plannedEndDate || card.dueDate))
    .filter(Boolean)
    .sort((a, b) => b - a);

  return { date: ends.length ? toISODate(ends[0]) : null, source: ends.length ? 'planned_end' : 'missing' };
}

export function calculateStartGap(plannedStart, effectiveStart) {
  return signedDaysBetween(plannedStart, effectiveStart);
}

export function calculateProjectBuffer(plannedEnd, effectiveEnd) {
  return signedDaysBetween(effectiveEnd, plannedEnd);
}

export function classifyProjectBuffer(bufferDays) {
  if (bufferDays === null || bufferDays === undefined) return 'missing';
  if (bufferDays > 0) return 'positive';
  if (bufferDays === 0) return 'zero';
  return 'negative';
}

export function calculateElapsedTimePercentage(startDate, endDate, currentDate = new Date()) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  const current = toDate(currentDate);
  if (!start || !end || !current) return null;

  const total = inclusiveDaysBetween(start, end);
  if (!total || total <= 0) return null;
  if (current < start) return 0;
  if (current > end) return 100;

  const elapsed = inclusiveDaysBetween(start, current);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export function calculateCompletionPercentage(cards) {
  if (!cards?.length) return 0;
  const done = cards.filter(isDone).length;
  return Math.round((done / cards.length) * 100);
}

export function calculateScheduleVariance(elapsedPercentage, completionPercentage) {
  if (elapsedPercentage === null || elapsedPercentage === undefined) return null;
  return Math.round((completionPercentage - elapsedPercentage) * 10) / 10;
}

export function resolveDeliverableCandidate(card) {
  const parentKey = card?.parentKey || card?.epicKey || card?.parent?.key || null;
  const parentTitle = card?.parentTitle || card?.parent?.title || null;

  if (parentKey) {
    return {
      id: `parent:${parentKey}`,
      name: parentTitle || parentKey,
      description: parentTitle && parentTitle !== parentKey ? parentKey : 'Epico ou parent do Jira',
      source: 'parent',
    };
  }

  if (card?.type === 'epic') {
    return {
      id: `epic:${card.key}`,
      name: card.title || card.key,
      description: card.key,
      source: 'epic',
    };
  }

  const version = Array.isArray(card?.fixVersions) ? card.fixVersions[0] : null;
  if (version?.name) {
    return {
      id: `version:${version.id || version.name}`,
      name: version.name,
      description: 'Versao Jira',
      source: 'version',
    };
  }

  const component = Array.isArray(card?.components) ? card.components[0] : null;
  if (component?.name) {
    return {
      id: `component:${component.id || component.name}`,
      name: component.name,
      description: 'Componente Jira',
      source: 'component',
    };
  }

  return {
    id: 'unassigned',
    name: 'Sem entregavel',
    description: 'Tickets sem parent, epico, versao ou componente',
    source: 'none',
  };
}

export function buildDeliverables(cards) {
  const map = new Map();
  const today = toDate(new Date());

  for (const card of cards || []) {
    const candidate = resolveDeliverableCandidate(card);
    if (!map.has(candidate.id)) {
      map.set(candidate.id, {
        ...candidate,
        tickets: [],
        issueIds: [],
      });
    }

    const deliverable = map.get(candidate.id);
    deliverable.tickets.push(card);
    deliverable.issueIds.push(card.id);
  }

  return [...map.values()].map(deliverable => {
    const starts = deliverable.tickets
      .map(getCardStartDate)
      .map(toDate)
      .filter(Boolean)
      .sort((a, b) => a - b);
    const ends = deliverable.tickets
      .map(getCardEndDate)
      .map(toDate)
      .filter(Boolean)
      .sort((a, b) => b - a);
    const completionPercentage = calculateCompletionPercentage(deliverable.tickets);
    const blocked = deliverable.tickets.filter(isBlocked).length;
    const overdue = deliverable.tickets.filter(isCardOverdue).length;
    const end = ends[0] ? toISODate(ends[0]) : null;
    const isDelayed = !!(end && toDate(end) < today && completionPercentage < 100);

    let riskStatus = 'low';
    if (blocked > 0 || isDelayed || overdue > 0) riskStatus = 'high';
    else if (completionPercentage < 50) riskStatus = 'medium';

    return {
      ...deliverable,
      plannedStartDate: starts[0] ? toISODate(starts[0]) : null,
      plannedEndDate: end,
      completionPercentage,
      totalTickets: deliverable.tickets.length,
      doneTickets: deliverable.tickets.filter(isDone).length,
      blockedTickets: blocked,
      overdueTickets: overdue,
      isDelayed,
      riskStatus,
      status: completionPercentage === 100 ? 'done' : blocked ? 'blocked' : 'in_progress',
    };
  }).sort((a, b) => {
    if (a.id === 'unassigned') return 1;
    if (b.id === 'unassigned') return -1;
    const da = toDate(a.plannedStartDate);
    const db = toDate(b.plannedStartDate);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function getUndatedIssues(cards) {
  return (cards || []).filter(card => !getCardEndDate(card));
}

export function getDelayedDeliverables(deliverables) {
  return (deliverables || []).filter(deliverable => deliverable.isDelayed);
}

export function getIssuesOutsideDeliverablePeriod(cards, deliverables) {
  const byId = new Map((deliverables || []).map(d => [d.id, d]));
  return (cards || []).filter(card => {
    const candidate = resolveDeliverableCandidate(card);
    const deliverable = byId.get(candidate.id);
    if (!deliverable?.plannedStartDate || !deliverable?.plannedEndDate) return false;

    const start = toDate(getCardStartDate(card));
    const end = toDate(getCardEndDate(card));
    const dStart = toDate(deliverable.plannedStartDate);
    const dEnd = toDate(deliverable.plannedEndDate);
    if (!start || !end || !dStart || !dEnd) return false;
    return start < dStart || end > dEnd;
  });
}

export function classifyScheduleHealth({
  scheduleVariance,
  bufferDays,
  blockedIssues,
  undatedIssues,
  delayedDeliverables,
}) {
  if (bufferDays !== null && bufferDays < 0) return 'red';
  if (scheduleVariance !== null && scheduleVariance <= -15) return 'red';
  if (blockedIssues >= 3 || delayedDeliverables > 0) return 'red';
  if (bufferDays !== null && bufferDays <= 7) return 'yellow';
  if (scheduleVariance !== null && scheduleVariance < -5) return 'yellow';
  if (blockedIssues > 0 || undatedIssues > 0) return 'yellow';
  return 'green';
}

export function buildProjectScheduleSummary(project, cards, options = {}) {
  const currentDate = options.currentDate || new Date();
  const plannedStartDate = toISODate(project?.plannedStartDate);
  const plannedEndDate = toISODate(project?.plannedEndDate);
  const effectiveStart = getProjectEffectiveStartDate(cards);
  const effectiveEnd = getProjectEffectiveEndDate(cards);
  const effectiveStartDate = effectiveStart.date;
  const effectiveEndDate = effectiveEnd.date;
  const startGapDays = calculateStartGap(plannedStartDate, effectiveStartDate);
  const bufferDays = calculateProjectBuffer(plannedEndDate, effectiveEndDate);
  const bufferClass = classifyProjectBuffer(bufferDays);
  const contractualElapsedPercentage = calculateElapsedTimePercentage(plannedStartDate, plannedEndDate, currentDate);
  const operationalElapsedPercentage = calculateElapsedTimePercentage(effectiveStartDate, effectiveEndDate, currentDate);
  const elapsedPercentage = contractualElapsedPercentage ?? operationalElapsedPercentage;
  const completionPercentage = calculateCompletionPercentage(cards);
  const scheduleVariance = calculateScheduleVariance(elapsedPercentage, completionPercentage);
  const deliverables = buildDeliverables(cards);
  const undatedIssues = getUndatedIssues(cards);
  const delayedDeliverables = getDelayedDeliverables(deliverables);
  const outsideDeliverableIssues = getIssuesOutsideDeliverablePeriod(cards, deliverables);
  const blockedIssues = (cards || []).filter(isBlocked);
  const staleIssues = (cards || []).filter(card => {
    if (isDone(card) || !card.updatedAt) return false;
    const updated = toDate(card.updatedAt);
    if (!updated) return false;
    return signedDaysBetween(updated, currentDate) > 30;
  });

  const alerts = [];
  if (!plannedStartDate) alerts.push({ level: 'warning', code: 'missing_planned_start', label: 'Projeto sem inicio previsto em proposta.' });
  if (!plannedEndDate) alerts.push({ level: 'warning', code: 'missing_planned_end', label: 'Projeto sem fim previsto em proposta.' });
  if (!effectiveStartDate) alerts.push({ level: 'warning', code: 'missing_effective_start', label: 'Nao ha data efetiva de inicio nos tickets.' });
  if (!effectiveEndDate) alerts.push({ level: 'warning', code: 'missing_effective_end', label: 'Nao ha data efetiva final nos tickets.' });
  if (undatedIssues.length) alerts.push({ level: 'warning', code: 'undated_issues', label: `${undatedIssues.length} ticket(s) sem data de entrega.` });
  if (bufferDays !== null && bufferDays < 0) alerts.push({ level: 'critical', code: 'negative_buffer', label: `Fim efetivo ultrapassa prazo vendido em ${Math.abs(bufferDays)} dia(s).` });
  if (scheduleVariance !== null && scheduleVariance < -5) alerts.push({ level: scheduleVariance <= -15 ? 'critical' : 'warning', code: 'behind_schedule', label: `Conclusao ${Math.abs(scheduleVariance)} p.p. abaixo do prazo decorrido.` });
  if (delayedDeliverables.length) alerts.push({ level: 'critical', code: 'delayed_deliverables', label: `${delayedDeliverables.length} entregavel(is) atrasado(s).` });
  if (outsideDeliverableIssues.length) alerts.push({ level: 'warning', code: 'outside_deliverable', label: `${outsideDeliverableIssues.length} ticket(s) fora do periodo do entregavel.` });
  if (staleIssues.length) alerts.push({ level: 'warning', code: 'stale_issues', label: `${staleIssues.length} ticket(s) sem atualizacao ha mais de 30 dias.` });
  if (blockedIssues.length) alerts.push({ level: blockedIssues.length >= 3 ? 'critical' : 'warning', code: 'blocked_issues', label: `${blockedIssues.length} ticket(s) bloqueado(s) impactando prazo.` });
  if (!cards?.length) alerts.push({ level: 'warning', code: 'empty_project', label: 'Projeto sem tickets sincronizados.' });

  const healthStatus = classifyScheduleHealth({
    scheduleVariance,
    bufferDays,
    blockedIssues: blockedIssues.length,
    undatedIssues: undatedIssues.length,
    delayedDeliverables: delayedDeliverables.length,
  });

  return {
    plannedStartDate,
    plannedEndDate,
    effectiveStartDate,
    effectiveEndDate,
    effectiveStartSource: effectiveStart.source,
    effectiveEndSource: effectiveEnd.source,
    startGapDays,
    bufferDays,
    bufferClass,
    contractualElapsedPercentage,
    operationalElapsedPercentage,
    elapsedPercentage,
    completionPercentage,
    scheduleVariance,
    healthStatus,
    deliverables,
    alerts,
    undatedIssues,
    delayedDeliverables,
    outsideDeliverableIssues,
    blockedIssues,
    staleIssues,
  };
}
