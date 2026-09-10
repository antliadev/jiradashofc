import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAnalystPerformance, dueDateChanges, validatePerformanceWeights } from '../src/data/analyst-performance.js';

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
  assert.equal(result.score >= 0 && result.score <= 100, true);
  assert.ok(result.indicators.every(indicator => indicator.formula));
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

test('performance weight validation requires total 100', () => {
  assert.equal(validatePerformanceWeights().valid, true);
  assert.equal(validatePerformanceWeights({ a: 50, b: 40 }).valid, false);
});
