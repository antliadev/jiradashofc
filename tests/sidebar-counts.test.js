import assert from 'node:assert/strict';
import test from 'node:test';
import { getAttentionCounts } from '../src/components/sidebar.js';

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
