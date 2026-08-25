import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignedSession, verifySignedSession } from '../lib/authSession.js';

test('sessao assinada pode ser validada sem estado em memoria', () => {
  const original = process.env.AUTH_SESSION_SECRET;
  process.env.AUTH_SESSION_SECRET = 'teste-seguro-com-mais-de-trinta-e-dois-caracteres';
  try {
    const token = createSignedSession('admin@example.com');
    const payload = verifySignedSession(token);
    assert.equal(payload.email, 'admin@example.com');
    assert.ok(payload.exp > Date.now());
    assert.equal(verifySignedSession(`${token}alterado`), null);
  } finally {
    if (original == null) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = original;
  }
});
