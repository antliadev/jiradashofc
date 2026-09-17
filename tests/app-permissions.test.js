import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_PROFILES, canAccessPermission, hasPartialSelfScope, normalizeAccessProfile, permissionForJiraRequest, permissionsForProfile } from '../lib/appPermissions.js';
import { scopeDashboardForUser, scopeIssuesForUser } from '../server/routes/jira.js';

test('perfis oficiais de acesso ficam limitados a Diretoria, Gestão e Dev/QA', () => {
  assert.deepEqual(ACCESS_PROFILES.map(profile => profile.name), ['Dev/QA', 'Gestão', 'Diretoria']);
  assert.equal(normalizeAccessProfile('full'), 'diretoria');
  assert.equal(normalizeAccessProfile('master'), 'gestao');
  assert.equal(normalizeAccessProfile('visualizacao'), 'dev_qa');
  assert.equal(normalizeAccessProfile('personalizado'), 'dev_qa');
  assert.equal(normalizeAccessProfile('desenvolvedor_ba'), 'dev_qa');
});

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

test('perfil dev qa tem analistas parcial e nao acessa comparativo', () => {
  const user = { role: 'dev_qa', status: 'active', permissions: [] };
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

test('perfil dev qa nao perde dados operacionais por regra parcial de analistas', () => {
  const req = { session: { user: { role: 'dev_qa', email: 'contas.ti@antlia.com.br' } } };
  const data = {
    issues: [
      { id: 'P1-1', assignee_id: 'a1', assignee_email: 'alan.silva@antlia.com.br', status: 'Em andamento', project: 'P1' },
      { id: 'P1-2', assignee_id: 'a2', assignee_email: 'matheus.santos@antlia.com.br', status: 'Bloqueado', project: 'P1' },
    ],
    analysts: [
      { id: 'a1', email: 'alan.silva@antlia.com.br', displayName: 'Alan Silva' },
      { id: 'a2', email: 'matheus.santos@antlia.com.br', displayName: 'Matheus Santos' },
    ],
    projects: [{ id: 'P1', name: 'Projetos Antlia' }],
    statuses: ['Em andamento', 'Bloqueado'],
    metrics: { total: 2 },
    board: { columns: [] },
    totalIssues: 2,
    lastSyncedAt: '2026-09-17T10:00:00.000Z',
  };

  assert.equal(scopeDashboardForUser(data, req, 'dashboard').issues.length, 2);
  assert.equal(scopeIssuesForUser(data.issues, req, 'projects.kanban').length, 2);
  assert.equal(scopeDashboardForUser(data, req, 'analysts.general').issues.length, 0);
  assert.equal(scopeIssuesForUser(data.issues, req, 'analysts.general').length, 0);
});
