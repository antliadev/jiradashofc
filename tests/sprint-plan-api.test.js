import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlanJiraClient } from '../lib/sprintPlanJira.js';

const response = body => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });

test('adapter lista futuras e ativas e resolve anterior no mesmo board', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push([url, options]);
    if (url.includes('/board?')) return response({ values: [{ id: 10 }], isLast: true });
    if (url.includes('/board/10/sprint')) return response({ values: [
      { id: 4, state: 'closed', completeDate: '2026-08-15T10:00:00Z' },
      { id: 5, state: 'active', startDate: '2026-08-16T10:00:00Z', endDate: '2026-08-30T10:00:00Z' },
      { id: 6, state: 'future', startDate: '2026-08-31T10:00:00Z', endDate: '2026-09-14T10:00:00Z' },
    ], isLast: true });
    throw new Error(`unexpected ${url}`);
  };
  const client = await createPlanJiraClient({ connection: { baseUrl: 'https://jira.example', email: 'a@b.c', token: 'x' }, fetchImpl });
  const context = await client.context('DEV', 10, 5);
  assert.deepEqual(context.sprints.map(item => item.id), [5, 6]);
  assert.equal(context.previousSprint.id, 4);
  assert.ok(calls.some(([url]) => url.includes('state=active%2Cclosed%2Cfuture') || url.includes('state=active,closed,future')));
});

test('rotas e migration Sprint Plan preservam autenticacao e append-only', () => {
  const routes = fs.readFileSync(new URL('../server/routes/sprint-plan.js', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../sql/migration-sprint-plan.sql', import.meta.url), 'utf8');
  for (const route of ['/projects', '/boards', '/context', '/profile', '/analyze', '/recalculate', '/snapshots']) assert.match(routes, new RegExp(route.replace('/', '\\/')));
  assert.match(routes, /requireAppAuth/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /service_role/i);
  assert.match(migration, /BEFORE UPDATE OR DELETE/i);
});
