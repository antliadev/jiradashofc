import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScopedJql } from '../lib/syncJobService.js';

test('buildScopedJql combina filtros ativos da tela sem remover o JQL base', () => {
  const jql = buildScopedJql({
    projectKeys: ['MKT'],
    assigneeIds: ['abc-123'],
    statuses: ['Em andamento'],
    priorities: ['high'],
    types: ['task'],
    dueDateTo: '2026-08-31',
    search: 'pricing'
  }, 'project is not EMPTY ORDER BY updated DESC');

  assert.match(jql, /^\(project is not EMPTY\) AND/);
  assert.match(jql, /project in \("MKT"\)/);
  assert.match(jql, /assignee in \("abc-123"\)/);
  assert.match(jql, /status in \("Em andamento"\)/);
  assert.match(jql, /priority in \("High","Alta"\)/);
  assert.match(jql, /issuetype in \("Task","Tarefa"\)/);
  assert.match(jql, /duedate <= "2026-08-31"/);
  assert.match(jql, /text ~ "pricing"/);
  assert.match(jql, /ORDER BY updated DESC$/);
});

test('buildScopedJql sem filtro ativo preserva sync global', () => {
  assert.equal(
    buildScopedJql({}, 'project is not EMPTY ORDER BY updated DESC'),
    'project is not EMPTY ORDER BY updated DESC'
  );
});

test('buildScopedJql escapa valores livres', () => {
  const jql = buildScopedJql({ projectKeys: ['ABC"DEF'], search: 'x" y\\z' }, 'project is not EMPTY');
  assert.match(jql, /project in \("ABC\\"DEF"\)/);
  assert.match(jql, /summary ~ "x y z"/);
});

test('buildScopedJql filtra sincronizacao de horas Crawford sem atualizar todos os projetos', () => {
  const jql = buildScopedJql({ hoursProjectKey: 'CRAWFORD' }, 'project is not EMPTY ORDER BY updated DESC');

  assert.match(jql, /^\(project is not EMPTY\) AND/);
  assert.match(jql, /\(project = "CRAWFORD"\)/);
  assert.match(jql, /ORDER BY updated DESC$/);
});

test('buildScopedJql filtra sincronizacao de horas Docwise incluindo DOCW e P1 relacionado', () => {
  const jql = buildScopedJql({ hoursProjectKey: 'DOCW' }, 'project is not EMPTY ORDER BY updated DESC');

  assert.match(jql, /\(project = "DOCW" OR \(project = "P1" AND text ~ "Docwise"\)\)/);
  assert.match(jql, /ORDER BY updated DESC$/);
});

test('buildScopedJql inclui cards ja exibidos ao atualizar monitoramento de atrasados', () => {
  const jql = buildScopedJql({
    overdue: true,
    issueKeys: ['P1-1826', 'P1-100']
  }, 'project is not EMPTY');

  assert.match(jql, /\(\(duedate < now\(\) AND statusCategory != "Done"\) OR issuekey in \("P1-1826","P1-100"\)\)/);
  assert.doesNotMatch(jql, /AND \(issuekey in/);
});

test('buildScopedJql inclui cards ja exibidos ao atualizar monitoramento de bloqueados', () => {
  const jql = buildScopedJql({
    blocked: true,
    issueKeys: ['P1-200']
  }, 'project is not EMPTY');

  assert.match(jql, /\(\(statusCategory = "In Progress" AND status in \("Bloqueado","Blocked"\)\) OR issuekey in \("P1-200"\)\)/);
});
