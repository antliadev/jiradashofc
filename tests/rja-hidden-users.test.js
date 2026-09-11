import assert from 'node:assert/strict';
import test from 'node:test';
import { isHiddenRjaUser, normalizeRjaUserLabel } from '../shared/rja-hidden-users.js';
import { buildDashboardData } from '../lib/jiraService.js';
import { dataService } from '../src/data/data-service.js';

test('normaliza usuarios ocultos do RJA por nome, acento, login e e-mail', () => {
  assert.equal(normalizeRjaUserLabel('Valéria Carvalho'), 'valeria carvalho');
  assert.equal(isHiddenRjaUser({ displayName: 'Valeria Carvalho' }), true);
  assert.equal(isHiddenRjaUser({ email: 'leandro.fuzishawa@antlia.com.br' }), true);
  assert.equal(isHiddenRjaUser({ name: 'Miguel Oliveira' }), true);
  assert.equal(isHiddenRjaUser({ displayName: 'Pessoa Permitida' }), false);
});

test('dashboard oculta pessoas removidas das listas de analistas sem apagar issues', () => {
  const data = buildDashboardData([
    {
      issue_id: '1',
      issue_key: 'RJA-1',
      title: 'Card historico',
      project_id: 'p1',
      project_key: 'RJA',
      project_name: 'Radar Jira',
      status_name: 'Em andamento',
      status_category: 'indeterminate',
      type_name: 'Task',
      assignee_id: 'hidden-1',
      assignee_name: 'Valéria Carvalho',
      assignee_email: 'valeria.carvalho@antlia.com.br',
    },
    {
      issue_id: '2',
      issue_key: 'RJA-2',
      title: 'Card ativo',
      project_id: 'p1',
      project_key: 'RJA',
      project_name: 'Radar Jira',
      status_name: 'Em andamento',
      status_category: 'indeterminate',
      type_name: 'Task',
      assignee_id: 'visible-1',
      assignee_name: 'Pessoa Permitida',
      assignee_email: 'permitida@antlia.com.br',
    },
  ]);

  assert.equal(data.issues.length, 2);
  assert.deepEqual(data.analysts.map(user => user.name), ['Pessoa Permitida']);
  assert.equal(data.projects[0].analystCount, 1);
  assert.deepEqual(Object.keys(data.metrics.byAnalyst), ['Pessoa Permitida']);
});

test('dataService remove pessoas ocultas das opcoes usadas pelos filtros', () => {
  dataService.importData(
    [{ id: 'p1', key: 'RJA', name: 'Radar Jira' }],
    [
      { id: 'c1', key: 'RJA-1', projectId: 'p1', title: 'Historico', status: 'Em andamento', assigneeId: 'hidden-1' },
      { id: 'c2', key: 'RJA-2', projectId: 'p1', title: 'Ativo', status: 'Em andamento', assigneeId: 'visible-1' },
    ],
    [
      { id: 'hidden-1', displayName: 'Rafael Ribeiro', email: 'rafael.ribeiro@antlia.com.br' },
      { id: 'visible-1', displayName: 'Pessoa Permitida', email: 'permitida@antlia.com.br' },
    ]
  );

  assert.deepEqual(dataService.getUsers().map(user => user.displayName), ['Pessoa Permitida']);
  assert.equal(dataService.getCards().length, 2);
});
