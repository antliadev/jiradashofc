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

test('login direciona perfil desenvolvedor ba para Home e respeita bloqueios da matriz', () => {
  const user = {
    role: 'desenvolvedor_ba',
    status: 'active',
    permissions: [],
  };
  assert.equal(firstAllowedRoute(user), '/home');
  assert.equal(canAccessRoute('/monitoring/blocked', user), true);
  assert.equal(canAccessRoute('/contracts/crawford', user), false);
  assert.equal(canAccessRoute('/analysts/general', user), true);
  assert.equal(canAccessRoute('/analysts/comparative', user), false);
});

test('somente perfil diretoria ativo acessa a gestao de acessos', () => {
  const diretoria = { role: 'diretoria', status: 'active', permissions: [] };
  const gestao = { role: 'gestao', status: 'active', permissions: [] };
  assert.equal(canAccessRoute('/access', diretoria), true);
  assert.equal(canAccessRoute('/access', gestao), false);
});
