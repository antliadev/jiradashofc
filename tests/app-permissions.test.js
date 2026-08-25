import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPermission, permissionForJiraRequest } from '../lib/appPermissions.js';

test('perfil full administra acessos e qualquer permissao funcional', () => {
  const user = { role: 'full', status: 'active', permissions: [] };
  assert.equal(canAccessPermission(user, 'access.manage'), true);
  assert.equal(canAccessPermission(user, 'dashboard'), true);
});

test('perfil visualizacao depende de permissoes efetivas', () => {
  const user = { role: 'visualizacao', status: 'active', permissions: ['dashboard'] };
  assert.equal(canAccessPermission(user, 'dashboard'), true);
  assert.equal(canAccessPermission(user, 'data'), false);
});

test('mapeia rotas Jira sensiveis para permissao de dados', () => {
  assert.equal(permissionForJiraRequest({ path: '/sync/start', method: 'POST' }), 'data');
  assert.equal(permissionForJiraRequest({ path: '/config', method: 'POST' }), 'data');
  assert.equal(permissionForJiraRequest({ path: '/dashboard', method: 'GET' }), 'dashboard');
});
