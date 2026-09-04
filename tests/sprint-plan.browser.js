// Execute com o Vite em 127.0.0.1:5173. Todos os dados sao sinteticos.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const plan = {
  targetSprint: { id: 5, name: 'Sprint 5', state: 'active' },
  items: [
    { issueKey: 'DEV-1', title: 'Freeze de pagamentos', primaryOrigin: 'carry_over', assignee: 'Ana', displayDate: '2026-09-08', carryOverCount: 2, evidenceIds: ['e1'] },
    { issueKey: 'DEV-2', title: 'Template de integracao', primaryOrigin: 'new_planned', assignee: 'Bruno', displayDate: '2026-09-10', evidenceIds: [] },
  ],
  previousPending: [{ issueKey: 'DEV-3', title: 'Pendencia fora do plano', destination: 'future_sprint' }],
  activationDeltas: [{ issueKey: 'DEV-2', title: 'Incluido na ativacao', type: 'added' }],
  metrics: { planned: 2, continuities: 1, newPlanned: 1 }, readiness: { score: 88 },
  evidence: [{ id: 'e1', key: 'DEV-1', text: 'Dependencia resolvida; proximo passo validacao.' }],
  preflight: { errors: [], warnings: [], canApprove: true },
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], snapshots = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sp-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content"></main></body></html>' }));
  await page.route('**/api/jira/sprint-plan/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/sprint-plan')[1];
    let payload = {};
    if (path === '/projects') payload = { projects: [{ key: 'DEV', name: 'DevOps' }] };
    if (path === '/boards') payload = { boards: [{ id: 10, name: 'DevOps Board' }] };
    if (path === '/context') payload = { sprints: [plan.targetSprint], profile: { version: '1', timezone: 'UTC', sprintField: 'customfield_1', executiveDateField: 'duedate', grouping: 'card', eligibleTypes: ['100'], statusMap: { '1': 'pending' } }, types: [{ id: '100', name: 'Tarefa', statuses: [{ id: '1', name: 'Pendente' }] }], fields: [{ id: 'customfield_1', name: 'Sprint' }, { id: 'duedate', name: 'Data limite' }], canConfigure: true };
    if (path === '/analyze') payload = { sourceId: 'fixture', plan };
    if (path === '/snapshots') { if (route.request().method() === 'POST') snapshots.push(route.request().postDataJSON()); payload = { snapshots }; }
    await route.fulfill({ json: payload });
  });
  await page.goto('http://127.0.0.1:5173/sp-fixture');
  await page.evaluate(async () => (await import('/src/pages/sprint-plan.js')).renderSprintPlan());
  await page.selectOption('#sp-project', 'DEV');
  await page.selectOption('#sp-board', '10');
  await page.selectOption('#sp-sprint', '5');
  await page.click('#sp-analyze');
  await page.waitForSelector('.sp-kpis');
  assert.equal(await page.locator('.sp-kpis article').count(), 6);
  await page.click('[data-tab="items"]');
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.click('#sp-preview');
  assert.equal(await page.locator('.sp-slide').count(), 1);
  assert.equal(await page.locator('.sp-slide').evaluate(el => Math.abs(el.clientWidth / el.clientHeight - 16 / 9) < 0.03), true);
  assert.deepEqual(await page.locator('.sp-slide').evaluateAll(nodes => nodes.flatMap(node => [node, ...node.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2).map(el => el.tagName))), []);
  await page.screenshot({ path: '/tmp/sprint-plan-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/sprint-plan-mobile.png', fullPage: true });
  await page.click('#sp-save');
  await page.waitForFunction(() => document.querySelector('.sprint-plan').getAttribute('aria-busy') === 'false');
  assert.equal(snapshots.length, 1);
  assert.deepEqual(errors, []);
  console.log('Browser passed: selection, deterministic plan, tabs, preflight, snapshot, 16:9 preview and mobile.');
} finally { await browser.close(); }
