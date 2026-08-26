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

