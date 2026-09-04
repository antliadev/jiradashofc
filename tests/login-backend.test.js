import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCheckSession, handleLogin } from '../server/auth.js';

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

test('develop autentica admin local sem Supabase', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', VERCEL_GIT_COMMIT_REF: 'develop', SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  try {
    await handleLogin({ body: { email: 'admin', password: 'admin' } }, res);
    assert.equal(result.status, undefined);
    assert.equal(result.body.success, true);
    assert.equal(result.body.user.id, 'develop-admin');
    assert.equal(result.body.user.role, 'full');
    assert.equal(result.body.user.testOnly, true);
    assert.match(result.body.sessionId, /^sessv1_/);
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('develop valida sessao local admin sem cookie Supabase', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', VERCEL_GIT_COMMIT_REF: 'develop', SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });
  const loginResult = {};
  const checkResult = {};
  const loginRes = { status(code) { loginResult.status = code; return this; }, json(body) { loginResult.body = body; return this; } };
  const checkRes = { status(code) { checkResult.status = code; return this; }, json(body) { checkResult.body = body; return this; } };
  try {
    await handleLogin({ body: { email: 'admin', password: 'admin' } }, loginRes);
    await handleCheckSession({ headers: { 'x-session-id': loginResult.body.sessionId }, cookies: {} }, checkRes);
    assert.equal(checkResult.status, undefined);
    assert.equal(checkResult.body.authenticated, true);
    assert.equal(checkResult.body.user.id, 'develop-admin');
    assert.equal(checkResult.body.user.testOnly, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
