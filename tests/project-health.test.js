import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDaysBetween, calculateCardImpact, calculateConfidence, calculateProjectHealth, classifyProjectHealth } from '../src/data/project-health.js';

const baseCard = (overrides = {}) => ({
  assigneeId: 'user-1', status: 'Em andamento', priority: 'high', dueDate: '2099-01-01',
  humanCommentCount: 1, automationCommentCount: 0, commentCount: 1, ...overrides,
});

test('calcula score ponderado e dimensoes para projeto saudavel', () => {
  const result = calculateProjectHealth([baseCard(), baseCard({ status: 'Done' })]);
  assert.ok(result.score >= 95);
  assert.equal(result.classification.key, 'healthy');
  assert.equal(result.dimensions.length, 6);
});

test('reduz a nota por atraso e bloqueio e identifica impacto', () => {
  const result = calculateProjectHealth([
    baseCard({ status: 'Bloqueado', dueDate: '2000-01-01', humanCommentCount: 0, commentCount: 0 }),
  ]);
  assert.ok(result.score < 70);
  assert.ok(['Prazo', 'Bloqueio'].includes(result.impacts[0].label));
  assert.equal(classifyProjectHealth(55).key, 'risk');
});

test('nao classifica projeto sem cards como score zero', () => {
  const result = calculateProjectHealth([]);
  assert.equal(result.score, null);
  assert.equal(result.classification.key, 'unknown');
});

test('calcula impacto do card por sinais independentes e explica os fatores', () => {
  const result = calculateCardImpact(baseCard({
    status: 'Bloqueado', dueDate: '2000-01-01', assigneeId: 'unassigned',
    humanCommentCount: 0, commentCount: 0, rawPriority: false,
  }));
  assert.equal(result.risk, 100);
  assert.deepEqual(result.reasons, ['Prazo', 'Bloqueios', 'Governanca']);
});

test('aplica os pesos revisados e caps para risco critico', () => {
  const result = calculateProjectHealth([baseCard({ priority: 'highest', dueDate: '2000-01-01' })], { now: '2026-09-02T12:00:00-03:00' });
  assert.deepEqual(result.dimensions.map(item => item.weight), [30, 20, 15, 15, 10, 10]);
  assert.ok(result.hardCap <= 69);
  assert.equal(result.score, result.hardCap);
});

test('nao soma sinais sobrepostos e preserva card concluido sem risco corrente', () => {
  const overdue = calculateCardImpact(baseCard({ dueDate: '2000-01-01', priority: 'highest' }));
  const done = calculateCardImpact(baseCard({ status: 'Done', dueDate: '2000-01-01', assigneeId: 'unassigned' }));
  assert.equal(overdue.risk, 100);
  assert.equal(done.risk, 0);
  assert.equal(done.health, 100);
});

test('confidence score fica separado do score e sinaliza frescor', () => {
  const result = calculateConfidence(
    [baseCard({ changelogCount: 1 })],
    { lastSyncedAt: '2026-01-01T11:00:00.000Z' },
    { now: '2026-01-02T11:00:00.000Z' },
  );
  assert.ok(result.score >= 80);
  assert.equal(result.stale, false);
  assert.equal(classifyProjectHealth(95, true, 75).key, 'attention');
});

test('dias uteis nao contam fim de semana para aging', () => {
  assert.equal(businessDaysBetween('2026-08-28T12:00:00-03:00', '2026-08-31T12:00:00-03:00'), 1);
});

test('respeita status customizado para concluido e bloqueado', () => {
  const config = { statusMap: { entregue: 'done', impedimento: 'blocked' }, metadata: { lastSyncedAt: new Date().toISOString() }, now: '2026-09-02T12:00:00-03:00' };
  const result = calculateProjectHealth([
    baseCard({ status: 'Entregue', dueDate: '2000-01-01' }),
    baseCard({ status: 'Impedimento', updatedAt: '2026-08-25T12:00:00-03:00' }),
  ], config);
  assert.equal(result.dimensions.find(item => item.key === 'bloqueios').risk, 100);
  assert.equal(result.score <= 69, true);
});
