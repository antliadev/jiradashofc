import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanAIContext, synthesizeSprintPlan, validatePlanAISynthesis } from '../lib/sprintPlanAI.js';

const plan = {
  targetSprint: { id: 5, name: 'Sprint 5', startDate: '2026-08-16', endDate: '2026-08-30' },
  previousSprint: { id: 4, name: 'Sprint 4' },
  metrics: { planned: 1 },
  items: [{ issueKey: 'DEV-1', displayName: 'DEV-1 — Validar contrato', primaryOrigin: 'carry_over', evidenceIds: ['e1'] }],
  previousPending: [],
  evidence: [{ id: 'e1', issueKey: 'DEV-1', source: 'jira_comment', window: 'closure', text: 'Bloqueado aguardando aprovacao do contrato.' }],
};

test('contexto NVIDIA do Plan preserva codigo e nome e nao envia metricas editaveis', () => {
  const context = buildPlanAIContext(plan);
  assert.equal(context.items[0].displayName, 'DEV-1 — Validar contrato');
  assert.equal('metrics' in context, false);
});

test('validacao rejeita card e evidencia inventados', () => {
  const context = buildPlanAIContext(plan);
  const result = validatePlanAISynthesis({ priorities: [
    { issueKey: 'DEV-9', category: 'risk', text: 'Inventado', evidenceIds: ['e1'] },
    { issueKey: 'DEV-1', category: 'risk', text: 'Sem fonte', evidenceIds: ['fabricada'] },
    { issueKey: 'DEV-1', category: 'carry_over', text: 'Priorizar a aprovacao do contrato.', evidenceIds: ['e1'] },
  ] }, context);
  assert.deepEqual(result.priorities.map(item => item.issueKey), ['DEV-1']);
  assert.equal(result.priorities[0].displayName, 'DEV-1 — Validar contrato');
});

test('falha, limite e chave ausente preservam o planejamento deterministico', async () => {
  assert.equal((await synthesizeSprintPlan(plan, { apiKey: '' })).status, 'unconfigured');
  assert.equal((await synthesizeSprintPlan(plan, { apiKey: 'fixture', fetchImpl: async () => new Response('{}', { status: 429 }) })).status, 'rate_limited');
  assert.equal((await synthesizeSprintPlan(plan, { apiKey: 'fixture', fetchImpl: async () => { throw new Error('offline'); } })).status, 'unavailable');
  assert.equal(plan.metrics.planned, 1);
});

test('resposta NVIDIA valida vira prioridade sem persistir raciocinio interno', async () => {
  const result = await synthesizeSprintPlan(plan, { apiKey: 'fixture', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages.some(message => /metricas/.test(message.content)), true);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ priorities: [{ issueKey: 'DEV-1', category: 'carry_over', text: 'Priorizar desbloqueio do contrato.', evidenceIds: ['e1'] }], reasoning: 'nao persistir' }) } }] }));
  } });
  assert.equal(result.status, 'generated');
  assert.equal(result.priorities.length, 1);
  assert.equal('reasoning' in result, false);
});
