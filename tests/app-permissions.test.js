import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPermission, hasPartialSelfScope, permissionForJiraRequest, permissionsForProfile } from '../lib/appPermissions.js';

test('perfil diretoria administra acessos e qualquer permissao funcional', () => {
  const user = { role: 'diretoria', status: 'active', permissions: [] };
  assert.equal(canAccessPermission(user, 'access.manage'), true);
  assert.equal(canAccessPermission(user, 'dashboard'), true);
  assert.equal(canAccessPermission(user, 'data'), true);
});

test('perfil gestao acessa modulos gerenciais mas nao administra acessos', () => {
  const user = { role: 'gestao', status: 'active', permissions: [] };
  assert.equal(canAccessPermission(user, 'projects.resource-allocation'), true);
  assert.equal(canAccessPermission(user, 'access.manage'), false);
  assert.equal(canAccessPermission(user, 'data'), false);
});

test('perfil desenvolvedor ba tem analistas parcial e nao acessa comparativo', () => {
  const user = { role: 'desenvolvedor_ba', status: 'active', permissions: [] };
  assert.equal(canAccessPermission(user, 'analysts.general'), true);
  assert.equal(canAccessPermission(user, 'analysts.evolution'), true);
  assert.equal(canAccessPermission(user, 'analysts.comparative'), false);
  assert.equal(hasPartialSelfScope(user.role, 'analysts.general'), true);
  assert.equal(permissionsForProfile(user.role).includes('contracts.crawford'), false);
});

test('mapeia rotas Jira sensiveis para permissao de dados', () => {
  assert.equal(permissionForJiraRequest({ path: '/sync/start', method: 'POST' }), 'data');
  assert.equal(permissionForJiraRequest({ path: '/config', method: 'POST' }), 'data');
  assert.equal(permissionForJiraRequest({ path: '/dashboard', method: 'GET' }), 'dashboard');
});
