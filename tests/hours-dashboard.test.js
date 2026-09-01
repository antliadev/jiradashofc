import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectHoursDashboard,
  buildCrawfordHoursDashboard,
  capacityStatus,
  competenceFromStarted,
  parseDocwiseAdjustmentIssue,
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
  assert.equal(result.capacity.availableHours, 98.5);
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
  assert.equal(result.entries.length, 1);
  assert.equal(result.allEntries.length, 2);
  assert.deepEqual(result.allEntries.map(entry => entry.monthYear), ['2026-09', '2026-08']);
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
  assert.equal(crawfordAugust.availableHours, 95);
});

test('Crawford aplica capacidade contratual por competencia em agosto e setembro de 2026', () => {
  const worklogs = [
    { worklog_id: 'c1', issue_key: 'CRAWFORD-10', started_at: '2026-08-18T14:00:00.000Z', time_spent_seconds: 30 * 60 },
    { worklog_id: 'c2', issue_key: 'CRAWFORD-10', started_at: '2026-08-20T16:21:00.000Z', time_spent_seconds: 4 * 3600 },
    { worklog_id: 'c3', issue_key: 'CRAWFORD-12', started_at: '2026-08-24T13:00:00.000Z', time_spent_seconds: 6 * 3600 },
    { worklog_id: 'c4', issue_key: 'CRAWFORD-12', started_at: '2026-08-25T07:49:00.000Z', time_spent_seconds: 6 * 3600 },
    { worklog_id: 'c5', issue_key: 'CRAWFORD-12', started_at: '2026-08-27T12:43:47.276Z', time_spent_seconds: 4 * 3600 },
    { worklog_id: 'c6', issue_key: 'CRAWFORD-13', started_at: '2026-08-31T15:21:52.787Z', time_spent_seconds: 4 * 3600 }
  ];
  const issues = [
    { issue_key: 'CRAWFORD-10', project_key: 'CRAWFORD', title: 'Entendimento tecnico' },
    { issue_key: 'CRAWFORD-12', project_key: 'CRAWFORD', title: 'Recepcao e indexacao' },
    { issue_key: 'CRAWFORD-13', project_key: 'CRAWFORD', title: 'Ajustes setembro' }
  ];

  const august = buildProjectHoursDashboard(worklogs, issues, '2026-08', 'CRAWFORD');
  const september = buildProjectHoursDashboard(worklogs, issues, '2026-09', 'CRAWFORD');

  assert.equal(august.allowanceHours, 100);
  assert.equal(august.usedHours, 24.5);
  assert.equal(august.availableHours, 75.5);
  assert.equal(september.allowanceHours, 200);
  assert.equal(september.periodUsedHours, 0);
  assert.equal(september.usedHours, 0);
  assert.equal(september.accountableUsedHours, 24.5);
  assert.equal(september.availableHours, 175.5);
  assert.equal(september.utilizationPercent, 0);
  assert.equal(september.monthlyHistory.some(item => item.competence === '2026-09' && item.allowanceHours === 200), true);
});

test('Docwise separa horas do mesmo card pela data do apontamento', () => {
  const issues = [
    {
      issue_key: 'P1-1828',
      project_key: 'P1',
      title: 'DocWise — Ajustes solicitados',
      parent_title: 'Docwise - Workspace Creator'
    }
  ];
  const worklogs = [
    { worklog_id: 'aug-1', issue_key: 'P1-1828', author_name: 'Nelson', started_at: '2026-08-27T13:36:56.268Z', time_spent_seconds: 4 * 3600 },
    { worklog_id: 'aug-2', issue_key: 'P1-1828', author_name: 'Nelson', started_at: '2026-08-31T15:22:23.080Z', time_spent_seconds: 4 * 3600 },
    { worklog_id: 'sep-1', issue_key: 'P1-1828', author_name: 'Nelson', started_at: '2026-09-01T14:30:00.000Z', time_spent_seconds: 5 * 3600 }
  ];

  const august = buildProjectHoursDashboard(worklogs, issues, '2026-08', 'DOCW');
  const september = buildProjectHoursDashboard(worklogs, issues, '2026-09', 'DOCW');

  assert.equal(august.periodUsedHours, 8);
  assert.equal(august.usedHours, 8);
  assert.deepEqual(august.entries.map(entry => entry.monthYear), ['2026-08', '2026-08']);
  assert.equal(september.periodUsedHours, 5);
  assert.equal(september.usedHours, 13);
  assert.deepEqual(september.entries.map(entry => entry.monthYear), ['2026-09']);
  assert.equal(september.allEntries.length, 3);
});

test('Docwise reconcilia ajustes historicos sem duplicar worklogs legados', () => {
  const issues = [
    {
      issue_key: 'P1-802',
      project_key: 'P1',
      title: 'Docwise_WorkspaceCreator_Container_RF-013',
      parent_title: 'Docwise - Workspace Creator',
      jira_url: 'https://example.test/browse/P1-802'
    },
    {
      issue_key: 'P1-805',
      project_key: 'P1',
      title: 'Docwise_WorkspaceCreator_Desenvolvimento_RF-013',
      parent_key: 'P1-802',
      parent_title: 'Docwise_WorkspaceCreator_Container_RF-013'
    },
    {
      issue_key: 'P1-1808',
      project_key: 'P1',
      title: 'Docwise_WorkspaceCreator_Windows_Service',
      parent_title: 'Docwise - Workspace Creator'
    },
    {
      issue_key: 'DOCW-33',
      project_key: 'DOCW',
      status_name: 'Concluído',
      title: '[AJUSTE DOCWISE +] P1-802 2024-09 20h00m00s - Docwise_WorkspaceCreator_Container_RF-013'
    },
    {
      issue_key: 'DOCW-26',
      project_key: 'DOCW',
      status_name: 'Tarefas pendentes',
      title: '[DUPLICADO-IGNORAR] [AJUSTE DOCWISE +] P1-802 2024-09 20h00m00s - Docwise_WorkspaceCreator_Container_RF-013'
    },
    {
      issue_key: 'DOCW-61',
      project_key: 'DOCW',
      status_name: 'Concluído',
      title: '[AJUSTE DOCWISE -] P1-1808 2026-08 -6h00m00s - Docwise_WorkspaceCreator_Windows_Service'
    }
  ];
  const worklogs = [
    { worklog_id: '10091', issue_key: 'P1-805', started_at: '2024-09-16T13:00:00.000Z', time_spent_seconds: 20 * 3600 },
    { worklog_id: 'keep-1', issue_key: 'P1-1808', started_at: '2026-08-04T14:00:00.000Z', time_spent_seconds: 6 * 3600 }
  ];

  const september2024 = buildProjectHoursDashboard(worklogs, issues, '2024-09', 'DOCW');
  const august2026 = buildProjectHoursDashboard(worklogs, issues, '2026-08', 'DOCW');

  assert.equal(parseDocwiseAdjustmentIssue(issues[3]).time_spent_seconds, 20 * 3600);
  assert.equal(parseDocwiseAdjustmentIssue(issues[4]), null);
  assert.equal(parseDocwiseAdjustmentIssue(issues[5]), null);
  assert.equal(september2024.periodUsedHours, 20);
  assert.equal(september2024.entries.length, 1);
  assert.equal(september2024.entries[0].ticket, 'P1-802');
  assert.equal(september2024.entries[0].reconciliation.adjustmentIssueKey, 'DOCW-33');
  assert.equal(august2026.periodUsedHours, 6);
  assert.equal(august2026.usedHours, 26);
  assert.equal(august2026.entries[0].ticket, 'P1-1808');
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
