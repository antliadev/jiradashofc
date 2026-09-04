import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterGanttItems,
  getEligibleGanttAssignees,
  normalizeGanttAssignee,
} from '../src/pages/gantt-filters.js';

const items = [
  { card: { id: 'p1-a', projectId: 'p1', assigneeId: 'u1' } },
  { card: { id: 'p1-b', projectId: 'p1', assigneeId: 'u2' } },
  { card: { id: 'p1-none', projectId: 'p1', assigneeId: 'unassigned' } },
  { card: { id: 'p2-a', projectId: 'p2', assigneeId: 'u2' } },
  { card: { id: 'p2-b', projectId: 'p2', assigneeId: 'u3' } },
];

const users = [
  { id: 'u1', displayName: 'Ana' },
  { id: 'u2', displayName: 'Bruno' },
  { id: 'u3', displayName: 'Carla' },
  { id: 'u4', displayName: 'Davi' },
  { id: 'unassigned', displayName: 'Não Atribuído' },
];

test('lista somente responsáveis que possuem cards no projeto selecionado', () => {
  assert.deepEqual(
    getEligibleGanttAssignees(items, users, 'p1').map(user => user.id),
    ['u1', 'u2'],
  );
});

test('lista responsáveis de todos os projetos quando Projeto está em Todos', () => {
  assert.deepEqual(
    getEligibleGanttAssignees(items, users, '').map(user => user.id),
    ['u1', 'u2', 'u3'],
  );
});

test('reseta o responsável para Todos quando ele não é elegível após trocar projeto', () => {
  assert.equal(normalizeGanttAssignee('u1', getEligibleGanttAssignees(items, users, 'p2')), '');
  assert.equal(normalizeGanttAssignee('u2', getEligibleGanttAssignees(items, users, 'p2')), 'u2');
});

test('combina filtros de projeto e responsável nos cards elegíveis', () => {
  assert.deepEqual(
    filterGanttItems(items, { projectId: 'p2', assigneeId: 'u2' }).map(item => item.card.id),
    ['p2-a'],
  );
});
