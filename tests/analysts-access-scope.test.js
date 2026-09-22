import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardData } from '../lib/jiraService.js';
import { scopeDashboardForUser } from '../server/routes/jira.js';
import { canAccessPermission, permissionForJiraRequest } from '../lib/appPermissions.js';
import { DataService } from '../src/data/data-service.js';

const issues = [
  { id: 'own', issue_key: 'P1-1', assignee_id: '712020:fef15930-802e-4d55-a2d4-13fc0d09cefc', assignee_name: 'Pedro Oliveira Fernandes', assignee_email: 'pedro.fernandes@antlia.com.br', project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
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

test('dev qa é vinculado ao próprio analista por nome inferido do email corporativo', () => {
  const data = buildDashboardData([
    { id: 'raphael', issue_key: 'P1-10', assignee_id: '712020:09dc0185-dbe2-4d21-96c6-32470855b4f4', assignee_name: 'Raphael Yokokura', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
    { id: 'talles', issue_key: 'P1-11', assignee_id: '712020:d152e415-e622-4389-b15e-2c4263442ffc', assignee_name: 'Talles Caverni', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
    { id: 'matheus', issue_key: 'P1-12', assignee_id: '712020:9d0e7923-183f-40bb-a18c-ecb7ae7c2fb0', assignee_name: 'Matheus Manoel Santos', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
    { id: 'other', issue_key: 'P1-13', assignee_id: 'other-id', assignee_name: 'Outra Pessoa', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
  ]);

  for (const [email, expectedId] of [
    ['raphael.yokokura@antlia.com.br', '712020:09dc0185-dbe2-4d21-96c6-32470855b4f4'],
    ['talles.caverni@antlia.com.br', '712020:d152e415-e622-4389-b15e-2c4263442ffc'],
    ['matheus.santos@antlia.com.br', '712020:9d0e7923-183f-40bb-a18c-ecb7ae7c2fb0'],
  ]) {
    const result = scopeDashboardForUser(data, { session: { user: { role: 'dev_qa', status: 'active', email } } }, 'analysts.general');
    assert.deepEqual(result.analysts.map(analyst => analyst.id), [expectedId]);
    assert.deepEqual(result.issues.map(issue => issue.assignee_id), [expectedId]);
  }
});

test('conta administrativa sem nome pessoal não ganha vínculo inferido de analista', () => {
  const data = buildDashboardData([
    { id: 'ti', issue_key: 'P1-20', assignee_id: 'tiago-id', assignee_name: 'Tiago Contas', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
  ]);
  const result = scopeDashboardForUser(data, { session: { user: { role: 'dev_qa', status: 'active', email: 'contas.ti@antlia.com.br' } } }, 'analysts.evolution');
  assert.equal(result.analysts.length, 0);
  assert.equal(result.issues.length, 0);
});

test('dev qa é vinculado por primeiro nome quando o analista Jira é único e não expõe homônimos', () => {
  const hectorData = buildDashboardData([
    { id: 'hector', issue_key: 'DEVOPS-260', assignee_id: '70121:659b3d3b-7500-4cb5-ab42-1f077b0e551c', assignee_name: 'Hector nelson', assignee_email: null, project_key: 'DEVOPS', project_id: 'devops', status_name: 'Em andamento' },
    { id: 'other', issue_key: 'DEVOPS-261', assignee_id: 'other-id', assignee_name: 'Outra Pessoa', assignee_email: null, project_key: 'DEVOPS', project_id: 'devops', status_name: 'Concluído' },
  ]);
  const hector = scopeDashboardForUser(hectorData, { session: { user: { role: 'dev_qa', status: 'active', email: 'hector.troncoso@antlia.com.br', displayName: 'Hector' } } }, 'analysts.general');
  assert.deepEqual(hector.analysts.map(analyst => analyst.id), ['70121:659b3d3b-7500-4cb5-ab42-1f077b0e551c']);
  assert.deepEqual(hector.issues.map(issue => issue.assignee_id), ['70121:659b3d3b-7500-4cb5-ab42-1f077b0e551c']);

  const ambiguousData = buildDashboardData([
    { id: 'homonimo-a', issue_key: 'P1-30', assignee_id: 'homonimo-a', assignee_name: 'Alex Silva', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
    { id: 'homonimo-b', issue_key: 'P1-31', assignee_id: 'homonimo-b', assignee_name: 'Alex Santos', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
  ]);
  const ambiguous = scopeDashboardForUser(ambiguousData, { session: { user: { role: 'dev_qa', status: 'active', email: 'alex.outro@antlia.com.br', displayName: 'Alex' } } }, 'analysts.general');
  assert.equal(ambiguous.analysts.length, 0);
  assert.equal(ambiguous.issues.length, 0);
});

test('emails cadastrados aguardando primeiro login usam relação explícita com o accountId do Jira', () => {
  const data = buildDashboardData([
    { id: 'alan-card', issue_key: 'BSO-1', assignee_id: '712020:b06531c7-5c21-483c-938b-69c7009e1fbb', assignee_name: 'Alan Mazotti', assignee_email: null, project_key: 'BSO', project_id: 'bso', status_name: 'EM PROGRESSO' },
    { id: 'lucas-card', issue_key: 'MAR-1', assignee_id: '70121:f8babedd-436a-4083-bda0-62d8b0e06692', assignee_name: 'Lucas Vitoretti', assignee_email: null, project_key: 'MAR', project_id: 'mar', status_name: 'EM PROGRESSO' },
    { id: 'silva-card', issue_key: 'P1-40', assignee_id: '6414b8e0407493675d465f54', assignee_name: 'Carlos Alexandre Silva de Jesus', assignee_email: null, project_key: 'P1', project_id: 'p1', status_name: 'EM PROGRESSO' },
  ]);

  const alan = scopeDashboardForUser(data, { session: { user: { role: 'dev_qa', status: 'active', email: 'alan.silva@antlia.com.br' } } }, 'analysts.general');
  assert.deepEqual(alan.analysts.map(analyst => analyst.id), ['712020:b06531c7-5c21-483c-938b-69c7009e1fbb']);
  assert.deepEqual(alan.issues.map(issue => issue.assignee_id), ['712020:b06531c7-5c21-483c-938b-69c7009e1fbb']);

  const lucas = scopeDashboardForUser(data, { session: { user: { role: 'dev_qa', status: 'active', email: 'lucas.vitoretti@antlia.com.br' } } }, 'analysts.evolution');
  assert.deepEqual(lucas.analysts.map(analyst => analyst.id), ['70121:f8babedd-436a-4083-bda0-62d8b0e06692']);
  assert.deepEqual(lucas.issues.map(issue => issue.assignee_id), ['70121:f8babedd-436a-4083-bda0-62d8b0e06692']);
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
  assert.deepEqual(service.getUsers().map(user => user.id), ['712020:fef15930-802e-4d55-a2d4-13fc0d09cefc']);
  await assert.rejects(service.loadAnalystData('unknown'));
});
