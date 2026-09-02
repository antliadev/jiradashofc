import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCardImpact, calculateProjectHealth, classifyProjectHealth } from '../src/data/project-health.js';

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
  assert.equal(result.impact, 75);
  assert.deepEqual(result.reasons, ['atrasado', 'bloqueado', 'sem responsavel', 'sem comentario humano']);
});
