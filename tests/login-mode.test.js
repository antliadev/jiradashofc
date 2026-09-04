import assert from 'node:assert/strict';
import test from 'node:test';
import { loginMethodsForBranch } from '../src/utils/login-mode.js';
import { passwordLoginAllowed } from '../lib/loginMode.js';

test('develop oferece somente login por email e senha para homologacao', () => {
  assert.deepEqual(loginMethodsForBranch('develop'), { password: true, google: false });
  assert.equal(passwordLoginAllowed({ VERCEL_GIT_COMMIT_REF: 'develop', NODE_ENV: 'production' }), true);
});

test('main preserva Google-only e backend recusa senha', () => {
  assert.deepEqual(loginMethodsForBranch('main'), { password: false, google: true });
  assert.equal(passwordLoginAllowed({ VERCEL_GIT_COMMIT_REF: 'main', NODE_ENV: 'production' }), false);
});

test('preview de outra branch nao habilita senha por acidente', () => {
  assert.deepEqual(loginMethodsForBranch('feature/teste'), { password: false, google: true });
  assert.equal(passwordLoginAllowed({ VERCEL_GIT_COMMIT_REF: 'feature/teste', NODE_ENV: 'production' }), false);
});

test('servidor local permite senha para validar sem Vercel', () => {
  assert.equal(passwordLoginAllowed({ NODE_ENV: 'development' }), true);
});
