import assert from 'node:assert/strict';
import test from 'node:test';
import { getMonitoringFilterOptions } from '../src/pages/cards.js';

const rows = [
  { projectId: 'p1', projectName: 'Projeto Um', assigneeId: 'ana', assigneeName: 'Ana', status: 'Em andamento', statusCategory: 'in_progress', pendingWith: 'Cliente' },
  { projectId: 'p1', projectName: 'Projeto Um', assigneeId: 'ana', assigneeName: 'Ana', status: 'Em andamento', statusCategory: 'in_progress', pendingWith: 'Cliente' },
  { projectId: 'p2', projectName: 'Projeto Dois', assigneeId: 'bruno', assigneeName: 'Bruno', status: 'Bloqueado', statusCategory: 'blocked', pendingWith: 'Antlia' },
  { projectId: '', projectName: 'Sem projeto', assigneeId: '', assigneeName: 'Nao atribuido', status: 'Concluido', statusCategory: 'done', pendingWith: '' },
];

test('opcoes do monitoramento usam apenas linhas com ocorrencia e mostram contagem por projeto', () => {
  const options = getMonitoringFilterOptions(rows, 'blocked');

  assert.deepEqual(options.projects.map(option => option.label), ['Projeto Um (2)', 'Projeto Dois (1)']);
  assert.deepEqual(options.assignees.map(option => option.label), ['Ana (2)', 'Bruno (1)']);
  assert.deepEqual(options.statuses.map(option => option.label), ['Em andamento (2)', 'Bloqueado (1)', 'Concluido (1)']);
  assert.deepEqual(options.pendingWith.map(option => option.label), ['Cliente', 'Antlia']);
});

test('opcoes de status dos atrasados tambem ficam disponiveis', () => {
  const options = getMonitoringFilterOptions(rows, 'overdue');

  assert.deepEqual(options.statuses.map(option => option.label), ['Em andamento (2)', 'Bloqueado (1)', 'Concluido (1)']);
});
