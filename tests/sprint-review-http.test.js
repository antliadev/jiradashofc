import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

test('all review HTTP operations reject anonymous access before Jira or storage calls', async () => {
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.AUTH_PROVIDER = 'supabase';
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.SUPABASE_SECRET_KEY = '';
  const { default: router } = await import('../server/routes/sprint-review.js');
  const app = express();
  app.use(express.json());
  app.use('/review', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    for (const [method, path] of [['GET', '/projects'], ['GET', '/boards'], ['GET', '/context'], ['POST', '/profile'], ['POST', '/analyze'], ['POST', '/recalculate'], ['POST', '/synthesize'], ['POST', '/snapshots'], ['GET', '/snapshots'], ['GET', '/snapshots/example'], ['GET', '/snapshots/example/art'], ['POST', '/snapshots/example/art/1']]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/review${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.match((await response.json()).error, /Supabase/);
    }
    const malformedCookie = await fetch(`http://127.0.0.1:${server.address().port}/review/projects`, { headers: { cookie: 'rja_access_token=%ZZ' } });
    assert.equal(malformedCookie.status, 401);
    assert.match((await malformedCookie.json()).error, /Supabase/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
