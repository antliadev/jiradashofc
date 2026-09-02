import assert from 'node:assert/strict';
import test from 'node:test';
import { getAttentionCounts } from '../src/components/sidebar.js';
import { dataService } from '../src/data/data-service.js';
import { isCardOverdue } from '../src/data/models.js';
import { applyIssueViewFilters } from '../src/pages/board.js';

test('contador lateral nao exibe zero falso antes dos dados carregarem', () => {
  const service = {
    isLoaded: false,
    getCards() {
      throw new Error('Nao deve consultar cards sem carga concluida');
    },
  };

  assert.deepEqual(getAttentionCounts(service), {
    overdue: null,
    blocked: null,
    total: null,
  });
});

test('contador lateral soma cards atrasados e bloqueados com dados carregados', () => {
  const service = {
    isLoaded: true,
    getCards(filters = {}) {
      if (filters.overdue) return ['P1-1', 'P1-2'];
      if (filters.statusCategory === 'blocked') return ['P1-3'];
      return [];
    },
  };

  assert.deepEqual(getAttentionCounts(service), {
    overdue: 2,
    blocked: 1,
    total: 3,
  });
});

test('contador, filtro e totais usam a regra real de atraso independentemente da posicao dos cards', () => {
  const service = new dataService.constructor();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const projects = [{ id: 'APP', key: 'APP', name: 'Projeto teste' }];
  const cards = [
    { id: '1', key: 'APP-1', dueDate: '2000-01-01', status: 'Open' },
    { id: '2', key: 'APP-2', dueDate: '2000-01-02', status: 'Blocked' },
    { id: '3', key: 'APP-3', dueDate: today, status: 'Open' },
    { id: '4', key: 'APP-4', dueDate: '2000-01-01', status: 'Done' },
    { id: '5', key: 'APP-5', dueDate: null, status: 'Open' },
    { id: '6', key: 'APP-6', dueDate: '2999-01-01', status: 'Open' },
  ].map(card => ({ ...card, projectId: 'APP', assigneeId: 'user', title: card.key, priority: 'medium' }));

  for (const ordering of [cards, [...cards].reverse()]) {
    service.importData(projects, ordering, []);
    service._hasLoaded = true;
    const listed = service.getCards().filter(card => isCardOverdue(card));
    assert.equal(listed.length, 2);
    assert.deepEqual(getAttentionCounts(service), { overdue: 2, blocked: 1, total: 3 });
    assert.deepEqual(service.getCards({ overdue: true }).map(card => card.key).sort(), ['APP-1', 'APP-2']);
    assert.equal(applyIssueViewFilters(service.getCards(), { showOverdue: true }).length, 2);
    assert.equal(service.getProjectStats('APP').overdue, 2);
    assert.equal(service.getUserStats('user').overdue, 2);
  }
  service.importData(projects, cards.map(card => ({ ...card, status: 'Done' })), []);
  assert.deepEqual(getAttentionCounts(service), { overdue: 0, blocked: 0, total: 0 });
  assert.equal(service.getProjectStats('APP').overdue, 0);
});
