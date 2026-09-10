import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateAllocation, summarizeResources, validateAllocation, validateAllocationProject } from '../src/data/resource-allocation.js';

test('resource allocation validates project and allocation date ranges', () => {
  assert.deepEqual(validateAllocationProject({ name: 'SDDS', startDate: '2026-09-10', endDate: '2026-09-01', status: 'Em andamento' }), ['Data final do projeto não pode ser anterior à inicial.']);
  assert.ok(validateAllocation({ userId: 'u1', projectId: 'p1', startDate: '2026-09-10', endDate: '2026-09-10', percent: 50 }).length === 0);
});

test('resource allocation permits overallocations but reports the conflict before saving', () => {
  const existing = [{ id: 'a1', userId: 'u1', projectId: 'p1', startDate: '2026-09-01', endDate: '2026-09-30', percent: 70 }];
  const result = simulateAllocation(existing, { userId: 'u1', projectId: 'p2', startDate: '2026-09-10', endDate: '2026-09-20', percent: 50 });
  assert.equal(result.conflict, true);
  assert.equal(result.peak, 120);
});

test('resource summary calculates covered until, no future allocation and executive totals', () => {
  const users = [{ id: 'u1', displayName: 'Gustavo' }, { id: 'u2', displayName: 'Danilo' }];
  const projects = [{ id: 'p1', name: 'SDDS' }];
  const allocations = [
    { id: 'a1', userId: 'u1', projectId: 'p1', startDate: '2026-09-01', endDate: '2026-10-31', percent: 100 },
    { id: 'a2', userId: 'u2', projectId: 'p1', startDate: '2026-09-01', endDate: '2026-09-18', percent: 100 },
  ];
  const summary = summarizeResources(users, projects, allocations, '2026-09-10', 30);
  assert.equal(summary.totals.professionals, 2);
  assert.equal(summary.totals.full, 2);
  assert.equal(summary.totals.noFuture, 2);
  assert.equal(summary.totals.availableSoon, 1);
  assert.equal(summary.rows.find(row => row.user.id === 'u2').nextAvailability.toISOString().slice(0, 10), '2026-09-19');
});
