import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAnalystPerformance,
  deliveryDelayEvents,
  dueDateChanges,
  historicalBlockedEvents,
  validatePerformanceWeights,
} from '../src/data/analyst-performance.js';

const base = {
  id: '1',
  key: 'P1-1',
  status: 'Concluído',
  resolvedAt: '2026-09-10T12:00:00Z',
  dueDate: '2026-09-10',
  plannedEndDate: '2026-09-10',
  humanCommentCount: 1,
  updatedAt: '2026-09-09T12:00:00Z',
  rawChangelog: { histories: [] },
};

test('analyst performance uses normalized weighted scores instead of absolute penalties', () => {
  const cards = [
    base,
    { ...base, id: '2', key: 'P1-2', dueDate: '2026-09-08', plannedEndDate: '2026-09-08', resolvedAt: '2026-09-10T12:00:00Z', humanCommentCount: 0 },
  ];
  const result = calculateAnalystPerformance(cards);
  assert.equal(result.currentOnTimeRate, 50);
  assert.equal(result.originalOnTimeRate, 50);
  assert.equal(result.originalOnTimeCards.length, 1);
  assert.equal(result.score >= 0 && result.score <= 100, true);
  assert.ok(result.indicators.every(indicator => indicator.formula));
});

test('performance note follows analyst score weights from Bruno notes', () => {
  const result = calculateAnalystPerformance([base]);
  const weights = Object.fromEntries(result.indicators.map(indicator => [indicator.key, indicator.weight]));
  assert.equal(weights.completedCards, 15);
  assert.equal(weights.originalDeadline, 20);
  assert.equal(weights.deliveryDelays, 20);
  assert.equal(weights.blockedDeliveries, 10);
  assert.equal(weights.commentCoverage, 20);
  assert.equal(weights.staleCards, 5);
  assert.equal(weights.replanning, 10);
  assert.equal(validatePerformanceWeights().valid, true);
});

test('postponed due date never counts as delivered on first deadline', () => {
  const card = {
    ...base,
    dueDate: '2026-09-26',
    plannedEndDate: '2026-09-26',
    resolvedAt: '2026-09-25T12:00:00Z',
    rawChangelog: {
      histories: [
        { id: 'd1', created: '2026-09-24T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'duedate', fromString: '2026-09-25', toString: '2026-09-26' }] },
      ],
    },
  };

  const result = calculateAnalystPerformance([card]);
  assert.equal(result.originalOnTimeRate, 0);
  assert.equal(result.originalOnTimeCards.length, 0);
});

test('stale cards ignore done and pending statuses', () => {
  const staleDate = '2026-09-01T12:00:00Z';
  const cards = [
    { ...base, id: 'pending', key: 'P1-2', status: 'Itens pendentes', updatedAt: staleDate, resolvedAt: null },
    { ...base, id: 'progress', key: 'P1-3', status: 'Em andamento', updatedAt: staleDate, resolvedAt: null },
    { ...base, id: 'done', key: 'P1-4', status: 'Concluído', updatedAt: staleDate },
  ];

  const result = calculateAnalystPerformance(cards);
  const staleIndicator = result.indicators.find(indicator => indicator.key === 'staleCards');
  assert.equal(staleIndicator.cards.length, 1);
  assert.equal(staleIndicator.cards[0].id, 'progress');
});

test('due date changes classify late and after-due replanning with author and audit trail', () => {
  const card = {
    ...base,
    rawChangelog: {
      histories: [
        { id: 'h1', created: '2026-09-09T12:00:00Z', author: { displayName: 'Gestor' }, items: [{ field: 'duedate', fromString: '2026-09-10', toString: '2026-09-15' }] },
        { id: 'h2', created: '2026-09-16T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'Data Limite', fromString: '2026-09-15', toString: '2026-09-20' }] },
      ],
    },
  };
  const changes = dueDateChanges(card);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].classification, 'late');
  assert.equal(changes[1].classification, 'after_due');
  assert.equal(changes[0].author, 'Gestor');
});

test('delivery delays stay counted after replanning when status at due date was pending or in progress', () => {
  const card = {
    ...base,
    status: 'Concluído',
    dueDate: '2026-09-20',
    plannedEndDate: '2026-09-20',
    resolvedAt: '2026-09-20T12:00:00Z',
    rawChangelog: {
      histories: [
        { id: 's1', created: '2026-09-08T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'status', fromString: 'Tarefas pendentes', toString: 'Em andamento' }] },
        { id: 'd1', created: '2026-09-12T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'duedate', fromString: '2026-09-10', toString: '2026-09-20' }] },
      ],
    },
  };

  const delays = deliveryDelayEvents([card], { now: '2026-09-24T12:00:00Z' });
  assert.equal(delays.length, 1);
  assert.equal(delays[0].dueDate, '2026-09-10');
  assert.equal(delays[0].statusAtDueDate, 'Em andamento');
});

test('delivery delays ignore cards that were blocked at due date', () => {
  const card = {
    ...base,
    status: 'Em andamento',
    dueDate: '2026-09-20',
    plannedEndDate: '2026-09-20',
    rawChangelog: {
      histories: [
        { id: 's1', created: '2026-09-08T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'status', fromString: 'Em andamento', toString: 'Bloqueado' }] },
        { id: 'd1', created: '2026-09-12T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'duedate', fromString: '2026-09-10', toString: '2026-09-20' }] },
      ],
    },
  };

  assert.equal(deliveryDelayEvents([card], { now: '2026-09-24T12:00:00Z' }).length, 0);
});

test('historical blocked events count block occurrences even after unblock', () => {
  const card = {
    ...base,
    status: 'Em andamento',
    rawChangelog: {
      histories: [
        { id: 's1', created: '2026-09-08T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'status', fromString: 'Em andamento', toString: 'Bloqueado' }] },
        { id: 's2', created: '2026-09-09T12:00:00Z', author: { displayName: 'Analista' }, items: [{ field: 'status', fromString: 'Bloqueado', toString: 'Em andamento' }] },
      ],
    },
  };

  const blocked = historicalBlockedEvents([card]);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].event.to, 'Bloqueado');
});

test('performance weight validation requires total 100', () => {
  assert.equal(validatePerformanceWeights().valid, true);
  assert.equal(validatePerformanceWeights({ a: 50, b: 40 }).valid, false);
});
