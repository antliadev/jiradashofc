import assert from 'node:assert/strict';
import test from 'node:test';
import { applyIssueViewFilters } from '../src/pages/board.js';

const cards = [
  { key: 'DOCW-12', projectId: 'docw', assigneeId: 'pedro', status: 'Bloqueado', priority: 'medium', type: 'task', description: 'Validar payload', blockReason: 'Dependencia externa', labels: [] },
  { key: 'P1-10', projectId: 'p1', assigneeId: 'ana', status: 'Em andamento', priority: 'high', type: 'story', description: 'Outra entrega', labels: [] }
];
const lookups = {
  getProject: id => ({ key: id.toUpperCase(), name: id === 'docw' ? 'Docwise' : 'Projetos Antlia' }),
  getUser: id => ({ displayName: id === 'pedro' ? 'Pedro Oliveira' : 'Ana' })
};
const base = { projectId: '', analystId: '', status: '', priority: '', type: '', dueDate: '', search: '', showBlocked: false, showOverdue: false, showNoDate: false, showNoAnalyst: false };

test('filtros combinam analista, bloqueio e busca em descricao/motivo', () => {
  assert.deepEqual(applyIssueViewFilters(cards, { ...base, analystId: 'pedro', showBlocked: true }, lookups).map(card => card.key), ['DOCW-12']);
  assert.deepEqual(applyIssueViewFilters(cards, { ...base, search: 'dependencia externa' }, lookups).map(card => card.key), ['DOCW-12']);
  assert.deepEqual(applyIssueViewFilters(cards, { ...base, search: 'Pedro Oliveira' }, lookups).map(card => card.key), ['DOCW-12']);
});
