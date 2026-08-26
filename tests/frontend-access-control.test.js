import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPermission,
  canAccessRoute,
  firstAllowedRoute,
} from '../src/utils/access-control.js';

test('estado sem usuario nao libera menus nem rotas protegidas', () => {
  assert.equal(canAccessPermission('dashboard', null), false);
  assert.equal(canAccessRoute('/', null), false);
  assert.equal(firstAllowedRoute(null), '/login');
});

test('usuario inativo nao libera menus mesmo que possua permissoes', () => {
  const user = { role: 'personalizado', status: 'inactive', permissions: ['dashboard'] };
  assert.equal(canAccessPermission('dashboard', user), false);
  assert.equal(firstAllowedRoute(user), '/login');
});

test('login direciona perfil personalizado para seu primeiro menu permitido', () => {
  const user = {
    role: 'personalizado',
    status: 'active',
    permissions: ['monitoring.blocked', 'data'],
  };
  assert.equal(firstAllowedRoute(user), '/monitoring/blocked');
  assert.equal(canAccessRoute('/monitoring/blocked', user), true);
  assert.equal(canAccessRoute('/home', user), false);
});

test('somente perfil full ativo acessa a gestao de acessos', () => {
  const full = { role: 'full', status: 'active', permissions: [] };
  const master = { role: 'master', status: 'active', permissions: [] };
  assert.equal(canAccessRoute('/access', full), true);
  assert.equal(canAccessRoute('/access', master), false);
});
