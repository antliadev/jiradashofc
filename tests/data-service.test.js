import assert from 'node:assert/strict';
import test from 'node:test';
import { dataService } from '../src/data/data-service.js';

test('opcoes de status podem ser filtradas por projeto', () => {
  dataService.importData(
    [
      { id: 'p1', key: 'P1', name: 'Projeto 1' },
      { id: 'p2', key: 'P2', name: 'Projeto 2' },
    ],
    [
      { id: 'c1', key: 'P1-1', projectId: 'p1', title: 'A', status: 'Em andamento' },
      { id: 'c2', key: 'P1-2', projectId: 'p1', title: 'B', status: 'Bloqueado' },
      { id: 'c3', key: 'P2-1', projectId: 'p2', title: 'C', status: 'Aguardando validacao PR' },
    ],
    []
  );

  assert.deepEqual(dataService.getStatusOptions('p1'), ['Bloqueado', 'Em andamento']);
  assert.deepEqual(dataService.getStatusOptions('p2'), ['Aguardando validacao PR']);
  assert.deepEqual(dataService.getStatusOptions(), ['Aguardando validacao PR', 'Bloqueado', 'Em andamento']);
});

test('usuarios para listas seguem exclusao global e ordem alfabetica', () => {
  dataService.importData(
    [{ id: 'p1', key: 'P1', name: 'Projeto 1' }],
    [],
    [
      { id: 'u3', displayName: 'Carlos Silva', email: 'carlos@example.test' },
      { id: 'u1', displayName: 'Álvaro Costa', email: 'alvaro@example.test' },
      { id: 'u-hidden', displayName: 'Rafael Ribeiro', email: 'rafael.ribeiro@antlia.com.br' },
      { id: 'u2', displayName: 'Bruno Alves', email: 'bruno@example.test' },
    ]
  );

  assert.deepEqual(dataService.getUsersForSelection().map(user => user.displayName), [
    'Álvaro Costa',
    'Bruno Alves',
    'Carlos Silva',
  ]);
});
