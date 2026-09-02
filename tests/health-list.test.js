import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHealthRows, syncHealthProject } from '../src/utils/health-list.js';

const rows = [
  { card: { key: 'APP-10', title: 'Revisao', assigneeId: 'u1', status: 'Blocked' }, impact: { risk: 85 }, assigneeName: 'Joao' },
  { card: { key: 'APP-2', title: 'Revisão', assigneeId: 'u2', status: 'Open' }, impact: { risk: 60 }, assigneeName: 'Maria' },
  { card: { key: 'APP-3', title: 'Entrega', assigneeId: 'u1', status: 'Open' }, impact: { risk: 59 }, assigneeName: 'Joao' },
];

test('filtros combinam responsavel, busca sem acento, status e limites do risco sem alterar entrada', () => {
  assert.deepEqual(filterHealthRows(rows, { search: 'revisao', status: 'Open', assignee: 'u2', risk: 'high' }).map(row => row.card.key), ['APP-2']);
  assert.equal(filterHealthRows(rows, { risk: 'critical' }).length, 1);
  assert.equal(filterHealthRows(rows, { risk: 'attention' }).length, 1);
  assert.deepEqual(filterHealthRows(rows, { sort: 'key', direction: 'asc' }).map(row => row.card.key), ['APP-2', 'APP-3', 'APP-10']);
  assert.equal(rows[0].card.key, 'APP-10');
  assert.equal(filterHealthRows(rows, { search: 'ausente' }).length, 0);
});

test('atualizacao espera job de outra tela e solicita o escopo correto antes de recarregar', async () => {
  const scopes = [];
  let loaded = 0;
  const service = {
    startScopedJiraSync: async scope => { scopes.push(scope); return { jobId: String(scopes.length), alreadyRunning: scopes.length === 1 }; },
    getSyncStatus: async () => ({ status: 'success' }),
    ensureLoaded: async options => { assert.deepEqual(options, { force: true }); loaded++; },
  };
  await syncHealthProject(service, 'DEVOPS');
  assert.deepEqual(scopes, [{ projectKeys: ['DEVOPS'] }, { projectKeys: ['DEVOPS'] }]);
  assert.equal(loaded, 1);
});

test('atualizacao nao apresenta sucesso quando job falta, falha ou expira', async () => {
  let loaded = false;
  const service = { startScopedJiraSync: async () => ({}), ensureLoaded: async () => { loaded = true; } };
  await assert.rejects(syncHealthProject(service, ''), /projeto valido/);
  await assert.rejects(syncHealthProject(service, 'APP'), /nao confirmou/);
  service.startScopedJiraSync = async () => ({ jobId: '1' });
  service.getSyncStatus = async () => ({ status: 'error', error: 'Erro controlado' });
  await assert.rejects(syncHealthProject(service, 'APP'), /Erro controlado/);
  service.getSyncStatus = async () => ({ status: 'running' });
  await assert.rejects(syncHealthProject(service, 'APP', { attempts: 1, delay: async () => {} }), /continua em andamento/);
  assert.equal(loaded, false);
});
