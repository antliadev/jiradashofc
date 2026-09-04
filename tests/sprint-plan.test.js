import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSprintPlan, resolvePreviousSprint, validatePlanProfile } from '../src/data/sprint-plan.js';
import { buildSuggestedPlanProfile } from '../lib/sprintProfileDefaults.js';

const previous = { id: 4, state: 'closed', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-14T10:00:00Z', completeDate: '2026-08-15T10:00:00Z' };
const target = { id: 5, state: 'active', startDate: '2026-08-16T10:00:00Z', endDate: '2026-08-30T10:00:00Z' };
const profile = { version: '1', timezone: 'America/Sao_Paulo', sprintField: 'customfield_1', eligibleTypes: ['100'], statusMap: { '1': 'pending', '2': 'done', '3': 'cancelled' }, executiveDateField: 'duedate', requireDate: true, requireAssignee: true, grouping: 'card', automation: {} };
const history = (created, items) => ({ id: created, created, items });
const issue = (key, sprintIds, overrides = {}) => ({
  id: key, key, historyComplete: true, fields: { summary: key, created: '2026-07-01T10:00:00Z', issuetype: { id: '100' }, status: { id: '1' }, customfield_1: sprintIds.map(id => ({ id })), duedate: '2026-08-20', assignee: { accountId: 'a' }, ...overrides.fields }, changelog: { histories: overrides.histories || [], total: (overrides.histories || []).length }, comments: overrides.comments || []
});

test('resolve sprint anterior pelo mesmo board e timestamps, nunca pelo nome', () => {
  assert.equal(resolvePreviousSprint([target, { ...previous, name: 'Sprint igual' }], 5).id, 4);
  assert.equal(resolvePreviousSprint([target], 5), null);
});

test('Sprint Plan aceita perfil sugerido para validacao inicial com aviso auditavel', () => {
  const suggested = buildSuggestedPlanProfile({
    types: [{ id: '100', statuses: [
      { id: '1', name: 'Não Iniciado', statusCategory: { key: 'new' } },
      { id: '2', name: 'Concluído', statusCategory: { key: 'done' } },
    ] }],
    fields: [{ id: 'duedate', name: 'Data limite' }, { id: 'customfield_1', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }],
  });
  const plan = buildSprintPlan({ projectKey: 'DEV', boardId: '1', targetSprint: target, previousSprint: previous, profile: suggested, issues: [issue('DEV-1', [5])], scopeComplete: true, fetchedAt: target.startDate });
  assert.equal(plan.metrics.planned, 1);
  assert.equal(plan.preflight.warnings.some(item => item.code === 'profile_suggested'), true);
  assert.equal(plan.preflight.errors.length, 0);
});

test('classifica origens exclusivas, pendencia nao absorvida e evidencia por janela', () => {
  const carry = issue('DEV-1', [4, 5], { comments: [
    { id: 'c1', created: '2026-08-15T09:00:00Z', body: 'Bloqueado pela API', author: { accountId: 'u', displayName: 'Ana' } },
    { id: 'c2', created: '2026-08-16T09:00:00Z', body: 'Proximo passo validar contrato', author: { accountId: 'u', displayName: 'Ana' } },
    { id: 'c3', created: '2026-08-17T09:00:00Z', body: 'Tarde demais', author: { accountId: 'u', displayName: 'Ana' } },
  ] });
  const replanned = issue('DEV-2', [5], { histories: [history('2026-08-14T09:00:00Z', [{ fieldId: 'customfield_1', field: 'Sprint', from: '4', to: '5' }])] });
  const fresh = issue('DEV-3', [5], { fields: { created: '2026-08-15T12:00:00Z' } });
  const orphan = issue('DEV-4', [4]);
  const plan = buildSprintPlan({ projectKey: 'DEV', boardId: '1', targetSprint: target, previousSprint: previous, profile, issues: [carry, replanned, fresh, orphan], scopeComplete: true, fetchedAt: '2026-08-17T10:00:00Z' });
  assert.deepEqual(plan.items.map(item => item.primaryOrigin), ['carry_over', 'replanned_before_close', 'new_planned']);
  assert.equal(new Set(plan.items.map(item => item.issueKey)).size, plan.metrics.planned);
  assert.equal(plan.previousPending[0].issueKey, 'DEV-4');
  assert.deepEqual(plan.evidence.map(item => item.window), ['closure', 'planning']);
});

test('baseline preserva atributos e visao atual produz deltas sem reescrever origem', () => {
  const baseline = buildSprintPlan({ projectKey: 'DEV', boardId: '1', targetSprint: target, previousSprint: previous, profile, issues: [issue('DEV-1', [4, 5])], scopeComplete: true, fetchedAt: target.startDate });
  const changed = issue('DEV-1', [4, 5], { fields: { status: { id: '2' }, assignee: { accountId: 'b' }, duedate: '2026-08-25' } });
  const current = buildSprintPlan({ projectKey: 'DEV', boardId: '1', targetSprint: target, previousSprint: previous, profile, issues: [changed, issue('DEV-2', [5])], baselineSnapshot: baseline, scopeComplete: true, fetchedAt: '2026-08-20T10:00:00Z', mode: 'current' });
  assert.equal(current.items[0].baselineStatus, 'pending');
  assert.equal(current.items[0].primaryOrigin, 'carry_over');
  assert.deepEqual(current.deltas.map(delta => delta.type).sort(), ['added', 'assignee_changed', 'date_changed', 'status_changed']);
});

test('prontidao e preflight sao deterministas e bloqueiam perfil/denominador invalidos', () => {
  assert.throws(() => validatePlanProfile({ ...profile, executiveDateField: '' }), /data executiva/i);
  const bad = issue('DEV-1', [5], { fields: { duedate: null, assignee: null, status: { id: '999' } } });
  const plan = buildSprintPlan({ projectKey: 'DEV', boardId: '1', targetSprint: target, previousSprint: previous, profile, issues: [bad], scopeComplete: true, fetchedAt: target.startDate });
  assert.ok(plan.preflight.errors.some(item => item.code === 'unmapped_status'));
  assert.ok(plan.preflight.warnings.some(item => item.code === 'missing_assignee'));
  assert.ok(plan.readiness.score < 85);
  assert.equal(plan.metrics.planned, 1);
});
