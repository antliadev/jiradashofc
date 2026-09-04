import assert from 'node:assert/strict';
import test from 'node:test';

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

Object.assign(process.env, {
  NODE_ENV: 'production',
  VERCEL: '1',
  VERCEL_GIT_COMMIT_REF: 'develop',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_SECRET_KEY: '',
});

const { default: app } = await import('../server/index.js');
const { executeAutoSync } = await import('../lib/syncJobService.js');

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('develop sem Supabase entrega dados de validacao pelo backend', async () => {
  await withServer(async baseUrl => {
    const login = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin', password: 'admin' }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);

    const headers = { 'x-session-id': loginBody.sessionId };
    const sync = await fetch(`${baseUrl}/api/jira/sync/start`, { method: 'POST', headers });
    const syncBody = await sync.json();
    assert.equal(sync.status, 202);
    assert.equal(syncBody.validationMode, true);
    assert.equal(syncBody.job.status, 'success');
    assert.ok(syncBody.job.totalIssues > 0);

    const dashboard = await fetch(`${baseUrl}/api/jira/dashboard`, { headers });
    const dashboardBody = await dashboard.json();
    assert.equal(dashboard.status, 200);
    assert.equal(dashboardBody.validationMode, true);
    assert.equal(dashboardBody.dataSource, 'validation-fixture');
    assert.ok(dashboardBody.totalIssues > 0);
    assert.ok(dashboardBody.totalProjects > 0);
    assert.ok(dashboardBody.totalAnalysts > 0);

    const issues = await fetch(`${baseUrl}/api/jira/issues?limit=10`, { headers });
    const issuesBody = await issues.json();
    assert.equal(issues.status, 200);
    assert.equal(issuesBody.validationMode, true);
    assert.ok(issuesBody.total > 0);
    assert.ok(issuesBody.issues.length > 0);
  });
});

test('agendador automatico reconhece dados de validacao sem falhar por Supabase', async () => {
  const result = await executeAutoSync('test', { forceScheduleCheck: true });
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.validationMode, true);
  assert.equal(result.status, 'success');
  assert.ok(result.totalIssues > 0);
});
