import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardData } from '../lib/jiraService.js';
import { scopeDashboardForUser } from '../server/routes/jira.js';
import { canAccessPermission, permissionForJiraRequest } from '../lib/appPermissions.js';
import { DataService } from '../src/data/data-service.js';

const issues = [
  { id: 'own', issue_key: 'P1-1', assignee_id: 'pedro', assignee_name: 'Pedro Oliveira Fernandes', assignee_email: 'pedro.fernandes@antlia.com.br', project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
  { id: 'other', issue_key: 'P1-2', assignee_id: 'other', assignee_name: 'Outro colaborador', assignee_email: 'other@antlia.com.br', project_key: 'P2', project_id: 'p2', status_name: 'CONCLUÍDO' },
];

test('Analistas Geral e Evolução isolam cada sessão mesmo com parâmetros de outra pessoa', () => {
  const data = buildDashboardData(issues);
  for (const mode of ['general', 'evolution']) {
    for (const own of issues) {
      const req = {
        session: { user: { role: 'dev_qa', status: 'active', email: own.assignee_email.toUpperCase() } },
        query: { userId: 'other', email: 'other@antlia.com.br', scope: 'all' },
        body: { role: 'diretoria', user_id: 'other' },
        headers: { 'x-user-id': 'other', 'x-role': 'diretoria' },
      };
      const scoped = scopeDashboardForUser(data, req, `analysts.${mode}`);
      assert.deepEqual(scoped.issues.map(issue => issue.assignee_id), [own.assignee_id]);
      assert.deepEqual(scoped.analysts.map(analyst => analyst.id), [own.assignee_id]);
      assert.equal(scoped.totalIssues, 1);
      assert.equal(scoped.projects.length, 1);
      assert.equal(data.issues.length, 2, 'não pode contaminar o cache compartilhado');
    }
  }
});

test('identidade ausente ou sem vínculo não recebe dados de outros analistas', () => {
  const data = buildDashboardData(issues);
  for (const email of [undefined, 'contas.ti@antlia.com.br']) {
    const result = scopeDashboardForUser(data, { session: { user: { role: 'dev_qa', email } }, query: { email: issues[0].assignee_email } }, 'analysts.general');
    assert.equal(result.issues.length, 0);
    assert.equal(result.analysts.length, 0);
  }
});

test('Dashboard mantém cards operacionais sem expor agregados comparativos ao Desenvolvedor / QA', () => {
  const data = buildDashboardData(issues);
  const originalByAnalyst = structuredClone(data.metrics.byAnalyst);
  const scoped = scopeDashboardForUser(data, {
    session: { user: { role: 'dev_qa', email: 'pedro.fernandes@antlia.com.br' } },
  }, 'dashboard');
  assert.equal(scoped.issues.length, 2);
  assert.deepEqual(scoped.metrics.byAnalyst, {});
  assert.deepEqual(scoped.metrics.distributionByAnalyst, {});
  assert.deepEqual(data.metrics.byAnalyst, originalByAnalyst, 'não pode modificar o resultado compartilhado');
});

test('permissões de rotas de analistas são independentes e caminhos desconhecidos negados', () => {
  const user = { role: 'dev_qa', status: 'active' };
  for (const mode of ['general', 'evolution', 'comparative']) {
    const permission = permissionForJiraRequest({ path: `/analysts/${mode}`, method: 'GET' });
    assert.equal(permission, `analysts.${mode}`);
    assert.equal(canAccessPermission(user, permission), mode !== 'comparative');
  }
  assert.equal(canAccessPermission(user, permissionForJiraRequest({ path: '/unknown' })), false);
  for (const role of ['gestao', 'diretoria']) {
    const data = buildDashboardData(issues);
    assert.equal(scopeDashboardForUser(data, { session: { user: { role } } }, 'analysts.general').issues.length, 2);
  }
});

test('serviço de Analistas usa endpoint próprio sem reutilizar Dashboard nem enviar identidade', async () => {
  const service = new DataService();
  service._getHeaders = () => ({});
  service._fetchWithTimeout = async url => {
    assert.equal(url, '/api/jira/analysts/evolution');
    return { ok: true, json: async () => buildDashboardData([issues[0]]) };
  };
  await service.loadAnalystData('evolution');
  assert.deepEqual(service.getUsers().map(user => user.id), ['pedro']);
  await assert.rejects(service.loadAnalystData('unknown'));
});
