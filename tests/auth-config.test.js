import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

const originalDomain = process.env.AUTH_ALLOWED_DOMAIN;
const originalExceptions = process.env.AUTH_ADMIN_EXCEPTION_EMAILS;

afterEach(() => {
  if (originalDomain == null) delete process.env.AUTH_ALLOWED_DOMAIN;
  else process.env.AUTH_ALLOWED_DOMAIN = originalDomain;
  if (originalExceptions == null) delete process.env.AUTH_ADMIN_EXCEPTION_EMAILS;
  else process.env.AUTH_ADMIN_EXCEPTION_EMAILS = originalExceptions;
});

test('regras de dominio aceitam Antlia e bloqueiam dominio externo', async () => {
  process.env.AUTH_ALLOWED_DOMAIN = 'antlia.com.br';
  process.env.AUTH_ADMIN_EXCEPTION_EMAILS = '';
  const module = await import(`../lib/authConfig.js?case=${Date.now()}`);

  assert.equal(module.isAllowedEmail('pessoa@antlia.com.br'), true);
  assert.equal(module.isAllowedEmail('pessoa@example.com'), false);
});

test('excecao administrativa permite email documentado fora do dominio', async () => {
  process.env.AUTH_ALLOWED_DOMAIN = 'antlia.com.br';
  process.env.AUTH_ADMIN_EXCEPTION_EMAILS = 'admin@example.com';
  const module = await import(`../lib/authConfig.js?case=${Date.now()}`);

  assert.equal(module.isAllowedEmail('admin@example.com'), true);
});
