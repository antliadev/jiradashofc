import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectHoursDashboard,
  buildCrawfordHoursDashboard,
  capacityStatus,
  competenceFromStarted,
  validateCompetence
} from '../lib/hoursDashboardService.js';
import {
  fetchCrawfordWorklogsFromJira,
  fetchProjectWorklogsFromJira,
  resolveTrackedWorklogProjectKey
} from '../lib/jiraWorklogService.js';

test('competencia respeita America/Sao_Paulo na virada UTC', () => {
  assert.equal(competenceFromStarted('2026-09-01T01:30:00.000Z'), '2026-08');
});

test('faixas de consumo distinguem 80, 90, 100 e excedido', () => {
  const capacity = 100 * 3600;
  assert.equal(capacityStatus(79 * 3600, capacity).level, 'normal');
  assert.equal(capacityStatus(80 * 3600, capacity).level, 'attention');
  assert.equal(capacityStatus(90 * 3600, capacity).level, 'critical');
  assert.equal(capacityStatus(100 * 3600, capacity).level, 'exhausted');
  assert.equal(capacityStatus(101 * 3600, capacity).level, 'exceeded');
  assert.equal(capacityStatus(101 * 3600, capacity).availableSeconds, 0);
  assert.equal(capacityStatus(101 * 3600, capacity).overageSeconds, 3600);
});

test('dashboard agrupa por competencia e epic/aplicacao sem solicitante', () => {
  const issues = [
    { issue_key: 'CRAWFORD-10', title: 'Integracao API' },
    { issue_key: 'CRAWFORD-11', title: 'Validar payload', parent_key: 'CRAWFORD-10', jira_url: 'https://example.test/browse/CRAWFORD-11' },
    { issue_key: 'CRAWFORD-12', title: 'Sem apontamento', status_name: 'Tarefas pendentes', assignee_name: 'Nelson' }
  ];
  const worklogs = [
    { worklog_id: '1', issue_key: 'CRAWFORD-11', author_name: 'Dev', description: 'Validacao', started_at: '2026-08-18T12:00:00.000Z', time_spent_seconds: 5400 },
    { worklog_id: '2', issue_key: 'CRAWFORD-11', author_name: 'Dev', description: '', started_at: '2026-09-18T12:00:00.000Z', time_spent_seconds: 3600 }
  ];
  const result = buildCrawfordHoursDashboard(worklogs, issues, '2026-08');
  assert.equal(result.capacity.usedHours, 1.5);
  assert.equal(result.capacity.availableHours, 198.5);
  assert.deepEqual(result.hoursByApplication, [{ application: 'Integracao API', name: 'Integracao API', seconds: 5400, hours: 1.5 }]);
  assert.equal(result.details[0].activityDescription, 'Validacao');
  assert.equal(result.monthlyConsumption.length, 2);
  assert.equal('hoursByRequester' in result, false);
  assert.equal('ticketsByRequester' in result, false);
  assert.equal(result.usedHours, 1.5);
  assert.equal(result.byApplication[0].name, 'Integracao API');
  assert.equal(result.monthlyHistory[0].usedHours, 1.5);
  assert.equal(result.entries[0].description, 'Validacao');
  assert.equal(result.entries[0].timeSeconds, 5400);
  assert.equal(result.totalProjectCards, 3);
  assert.equal(result.cardsWithWorklog, 1);
  assert.equal(result.cardsWithoutWorklog.length, 2);
  assert.equal(result.cardsWithoutWorklog.some(card => card.ticket === 'CRAWFORD-12' && card.assignee === 'Nelson'), true);
});

test('valida competencia da API', () => {
  assert.equal(validateCompetence('2026-08'), '2026-08');
  assert.throws(() => validateCompetence('08/2026'), /YYYY-MM/);
});

test('dashboard Docwise usa somente worklogs DOCW e identifica o cliente', () => {
  const result = buildProjectHoursDashboard([
    { worklog_id: 'docw-1', issue_key: 'DOCW-12', author_name: 'Pedro', started_at: '2026-08-20T14:00:00.000Z', time_spent_seconds: 28 * 3600 }
  ], [{ issue_key: 'DOCW-12', title: 'Validar payload Docwise' }], '2026-08', 'DOCW');
  assert.equal(result.projectKey, 'DOCW');
  assert.equal(result.project.name, 'Docwise');
  assert.equal(result.billingMode, 'cumulative');
  assert.equal(result.allowanceHours, 1440);
  assert.equal(result.usedHours, 28);
  assert.equal(result.entries[0].ticket, 'DOCW-12');
});

test('dashboard Docwise considera worklogs P1 sem inflar a contagem de cards DOCW', () => {
  const issues = [
    { issue_key: 'DOCW-12', project_key: 'DOCW', title: 'Validar payload Docwise' },
    { issue_key: 'DOCW-13', project_key: 'DOCW', title: 'Sem apontamento' },
    {
      issue_key: 'P1-1808',
      project_key: 'P1',
      title: 'Docwise_WorkspaceCreator_Windows_Service',
      parent_title: 'Docwise - Workspace Creator'
    }
  ];
  const result = buildProjectHoursDashboard([
    { worklog_id: 'docw-1', issue_key: 'DOCW-12', author_name: 'Pedro', started_at: '2026-08-20T14:00:00.000Z', time_spent_seconds: 6 * 3600 },
    { worklog_id: 'p1-1', issue_key: 'P1-1808', author_name: 'Nelson', started_at: '2026-08-04T14:00:00.000Z', time_spent_seconds: 6 * 3600 }
  ], issues, '2026-08', 'DOCW');

  assert.equal(result.usedHours, 12);
  assert.equal(result.totalProjectCards, 2);
  assert.equal(result.cardsWithWorklog, 2);
  assert.equal(result.cardsWithoutWorklog.length, 1);
  assert.deepEqual(result.entries.map(entry => entry.ticket).sort(), ['DOCW-12', 'P1-1808']);
});

test('Docwise acumula consumo entre competencias e Crawford reinicia mensalmente', () => {
  const issues = [
    { issue_key: 'DOCW-10', title: 'Docwise' },
    { issue_key: 'CRAWFORD-10', title: 'Crawford' }
  ];
  const docwiseWorklogs = [
    { worklog_id: 'd1', issue_key: 'DOCW-10', started_at: '2026-07-10T12:00:00.000Z', time_spent_seconds: 10 * 3600 },
    { worklog_id: 'd2', issue_key: 'DOCW-10', started_at: '2026-08-10T12:00:00.000Z', time_spent_seconds: 5 * 3600 }
  ];
  const crawfordWorklogs = docwiseWorklogs.map((row, index) => ({ ...row, worklog_id: `c${index}`, issue_key: 'CRAWFORD-10' }));

  const docwiseAugust = buildProjectHoursDashboard(docwiseWorklogs, issues, '2026-08', 'DOCW');
  const docwiseJuly = buildProjectHoursDashboard(docwiseWorklogs, issues, '2026-07', 'DOCW');
  const crawfordAugust = buildProjectHoursDashboard(crawfordWorklogs, issues, '2026-08', 'CRAWFORD');

  assert.equal(docwiseAugust.usedHours, 15);
  assert.equal(docwiseAugust.periodUsedHours, 5);
  assert.equal(docwiseAugust.availableHours, 1425);
  assert.equal(docwiseJuly.usedHours, 10);
  assert.equal(crawfordAugust.billingMode, 'monthly');
  assert.equal(crawfordAugust.usedHours, 5);
  assert.equal(crawfordAugust.availableHours, 195);
});

test('fallback consulta apenas worklogs Crawford e normaliza tickets do banco', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = async url => {
    requested.push(String(url));
    return new Response(JSON.stringify({
      total: 1,
      worklogs: [{ id: '99', started: '2026-08-19T12:00:00.000Z', timeSpentSeconds: 1800, author: { displayName: 'Pedro' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const rows = await fetchCrawfordWorklogsFromJira([
      { issue_id: '10', issue_key: 'CRAWFORD-10' },
      { issue_id: '20', issue_key: 'P1-20' }
    ], { baseUrl: 'https://example.atlassian.net', email: 'dev@example.com', token: 'secret' });
    assert.equal(requested.length, 1);
    assert.match(requested[0], /CRAWFORD-10/);
    assert.equal(rows[0].issue_key, 'CRAWFORD-10');
    assert.equal(rows[0].time_spent_seconds, 1800);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fallback Docwise busca cards P1 classificados por pai Docwise', async () => {
  assert.equal(resolveTrackedWorklogProjectKey({
    issue_key: 'P1-1808',
    project_key: 'P1',
    parent_title: 'Docwise - Workspace Creator'
  }), 'DOCW');

  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = async url => {
    requested.push(String(url));
    return new Response(JSON.stringify({
      total: 1,
      worklogs: [{ id: '17754', started: '2026-08-04T05:21:00.000Z', timeSpentSeconds: 21600, author: { displayName: 'Nelson' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const rows = await fetchProjectWorklogsFromJira([
      { issue_id: '10', issue_key: 'DOCW-10', project_key: 'DOCW' },
      { issue_id: '20', issue_key: 'P1-1808', project_key: 'P1', parent_title: 'Docwise - Workspace Creator' },
      { issue_id: '30', issue_key: 'P1-20', project_key: 'P1', parent_title: 'Outro produto' }
    ], { baseUrl: 'https://example.atlassian.net', email: 'dev@example.com', token: 'secret' }, 'DOCW');
    assert.equal(requested.length, 2);
    assert.equal(requested.some(url => /P1-1808/.test(url)), true);
    assert.equal(requested.some(url => /P1-20/.test(url)), false);
    assert.equal(rows.some(row => row.issue_key === 'P1-1808' && row.project_key === 'DOCW'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
