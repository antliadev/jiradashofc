// Execute com o Vite em 127.0.0.1:5173. Valida dashboard executivo sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/dashboard-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><header id="page-header"></header><main id="page-content" class="page-content"></main></body></html>',
  }));
  await page.goto('http://127.0.0.1:5173/dashboard-fixture#/');
  await page.evaluate(async () => {
    localStorage.setItem('rja.currentUser', JSON.stringify({ role: 'full', status: 'active' }));
    const { dataService } = await import('/src/data/data-service.js');
    dataService._config = { baseUrl: 'https://antliaprojetos.atlassian.net' };
    dataService.transformJiraData({
      projects: [{ id: 'p1', key: 'BNP', name: 'BNP - Devops' }],
      analysts: [{ id: 'u1', name: 'Bruno Santos', email: 'bruno.santos@antlia.com.br' }],
      issues: [
        { issue_id: '1', issue_key: 'P1-1', project_key: 'BNP', title: 'Card concluido', assignee_id: 'u1', status_name: 'Done', priority_name: 'High', type_name: 'Task', due_date: '2026-09-20', jira_created_at: '2026-09-01', jira_updated_at: '2026-09-10', jira_resolved_at: '2026-09-10' },
        { issue_id: '2', issue_key: 'P1-2', project_key: 'BNP', title: 'Card em andamento', assignee_id: 'u1', status_name: 'In Progress', priority_name: 'High', type_name: 'Task', due_date: '2026-09-22', jira_created_at: '2026-09-01', jira_updated_at: '2026-09-11' },
        { issue_id: '3', issue_key: 'P1-3', project_key: 'BNP', title: 'Card atrasado', assignee_id: 'u1', status_name: 'To Do', priority_name: 'Medium', type_name: 'Task', due_date: '2026-09-01', jira_created_at: '2026-09-01', jira_updated_at: '2026-09-12' },
        { issue_id: '4', issue_key: 'P1-4', project_key: 'BNP', title: 'Card sem data', assignee_id: 'u1', status_name: 'To Do', priority_name: 'Low', type_name: 'Task', jira_created_at: '2026-09-01', jira_updated_at: '2026-09-13' },
      ],
    });
    const { renderDashboard } = await import('/src/pages/dashboard.js');
    renderDashboard();
  });

  await assert.doesNotReject(() => page.locator('.dashboard-status-percentages').waitFor({ state: 'visible' }));
  assert.match(await page.locator('.dashboard-status-percentages').innerText(), /Concluídos\s+25%/);
  assert.match(await page.locator('.dashboard-status-percentages').innerText(), /Não concluídos\s+75%/);
  await assert.doesNotReject(() => page.locator('.dashboard-insight-card').waitFor({ state: 'visible' }));
  const insightText = await page.locator('.dashboard-insight-card').innerText();
  assert.match(insightText, /Leitura executiva/);
  assert.match(insightText, /CONCLUÍDO\s+25%/);
  assert.match(insightText, /EM ABERTO\s+75%/);
  assert.match(insightText, /ATRASO\s+25%/);
  assert.match(insightText, /SAÚDE DE DADOS\s+25%/);
  assert.match(insightText, /Tratar cards atrasados/);
  assert.match(insightText, /Corrigir saúde dos dados/);

  await page.locator('[data-dashboard-kpi="totalCards"]').click();
  await assert.doesNotReject(() => page.locator('.dashboard-kpi-modal').waitFor({ state: 'visible' }));
  assert.match(await page.locator('.dashboard-kpi-modal').innerText(), /4 card\(s\) encontrado\(s\)/);
  assert.equal(await page.locator('.dashboard-kpi-modal .issue-link').first().getAttribute('href'), 'https://antliaprojetos.atlassian.net/browse/P1-4');

  await page.locator('[data-close-modal]').click();
  await page.locator('[data-dashboard-kpi="overdue"]').click();
  assert.match(await page.locator('.dashboard-kpi-modal').innerText(), /P1-3/);
  assert.doesNotMatch(await page.locator('.dashboard-kpi-modal').innerText(), /P1-1/);

  assert.deepEqual(errors, []);
  console.log('Browser passed: dashboard KPIs abrem modal, links Jira, percentuais do grafico e leitura executiva.');
} finally {
  await browser.close();
}
