import assert from 'node:assert/strict';
import test from 'node:test';
import { isCardOverdue, toLocalDateOnly } from '../src/data/models.js';

const referenceToday = new Date(2026, 8, 2, 10, 0, 0);

function cardWithDueDate(dueDate, status = 'Em andamento') {
  return { dueDate, status };
}

test('card com data limite igual ao dia atual nao entra como atrasado', () => {
  assert.equal(isCardOverdue(cardWithDueDate('2026-09-02'), referenceToday), false);
});

test('card com data limite anterior ao dia atual entra como atrasado', () => {
  assert.equal(isCardOverdue(cardWithDueDate('2026-09-01'), referenceToday), true);
});

test('card concluido com data limite anterior nao entra como atrasado', () => {
  assert.equal(isCardOverdue(cardWithDueDate('2026-09-01', 'Concluido'), referenceToday), false);
});

test('data do Jira no formato YYYY-MM-DD preserva o dia local de negocio', () => {
  const date = toLocalDateOnly('2026-09-02');

  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 2);
});
