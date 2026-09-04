import assert from 'node:assert/strict';
import test from 'node:test';
import { handleLogin } from '../server/auth.js';

test('endpoint de producao recusa senha antes de consultar credenciais', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF };
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', VERCEL_GIT_COMMIT_REF: 'main' });
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  try {
    await handleLogin({ body: { email: 'teste@antlia.com.br', password: 'nao-transmitida' } }, res);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'AUTH_PASSWORD_DISABLED');
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
