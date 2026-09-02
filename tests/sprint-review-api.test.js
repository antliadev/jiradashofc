import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewJiraClient, positiveId, projectKey } from '../lib/sprintReviewJira.js';
import { validateReviewProfile, prepareReviewSnapshot } from '../lib/sprintReviewValidation.js';
import { permissionForJiraRequest, canAccessPermission } from '../lib/appPermissions.js';

const connection = { baseUrl: 'https://jira.example.test', email: 'test@example.test', token: 'synthetic-fixture' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('review adapter paginates, retries 429 and detects non-progressing Jira pages', async () => {
  let count = 0;
  const client = await createReviewJiraClient({ connection, delay: async () => {}, fetchImpl: async () => {
    count++;
    if (count === 1) return response({}, 429);
    return response({ values: [{ id: count }], total: 2 });
  } });
  assert.deepEqual((await client.pages('/test')).map(v => v.id), [2, 3]);
  assert.equal(count, 3);
  const broken = await createReviewJiraClient({ connection, fetchImpl: async () => response({ values: [{ id: 1 }], total: 10 }) });
  await assert.rejects(() => broken.pages('/test'), /repetida/);
});
test('board context cannot be substituted and ID/JQL inputs are validated', async () => {
  const client = await createReviewJiraClient({ connection, fetchImpl: async () => response({ values: [{ id: 1 }], isLast: true }) });
  await assert.rejects(() => client.sprints('TEST', 2), /Board nao pertence/);
  assert.throws(() => positiveId('../1'), /invalido/);
  assert.throws(() => projectKey('TEST" OR project is not EMPTY'), /invalido/);
});
test('profile validates mappings, bounded automation lists and ordered thresholds', () => {
  const profile = { timezone: 'America/Sao_Paulo', sprintField: 'customfield_10020', eligibleTypes: ['1'], statusMap: { '1': 'done' }, grouping: 'card' };
  assert.equal(validateReviewProfile(profile).timezone, profile.timezone);
  for (const override of [{ statusMap: { '1': 'fantasy' } }, { timezone: 'invalid' }, { thresholds: [50, 80, 90] }, { automation: { patterns: [''] } }]) assert.throws(() => validateReviewProfile({ ...profile, ...override }));
});
test('server recomputes facts and blocks snapshot with missing history and approval', () => {
  const source = { projectKey: 'TEST', boardId: 1, sprint: { id: 1, state: 'closed', startDate: '2026-08-01T00:00:00Z', completeDate: '2026-08-15T00:00:00Z' }, profile: { version: 1, timezone: 'UTC', sprintField: 'customfield_1', eligibleTypes: ['1'], statusMap: { '1': 'done' }, grouping: 'card' }, issues: [], scopeComplete: true };
  assert.throws(() => prepareReviewSnapshot(source, { metrics: { achievement: 100 }, choices: { confirmGrouping: true } }), /Preflight/);
});
test('Sprint Review has an explicit permission for all operations', () => {
  assert.equal(permissionForJiraRequest({ path: '/sprint-review/snapshots', method: 'POST' }), 'projects.sprint-review');
  assert.equal(canAccessPermission({ status: 'active', role: 'custom', permissions: ['projects.health'] }, 'projects.sprint-review'), false);
});
