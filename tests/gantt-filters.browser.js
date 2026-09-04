// Execute com o Vite em 127.0.0.1:5173. Dados sinteticos, sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/gantt-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content"></main></body></html>' }));
  await page.goto('http://127.0.0.1:5173/gantt-fixture');
  await page.evaluate(async () => {
    const { dataService } = await import('/src/data/data-service.js');
    const cards = [
      { id: '1', key: 'A-1', projectId: 'p1', title: 'Entrega A', assigneeId: 'u1', status: 'Em andamento', priority: 'medium', startDate: '2026-09-01', dueDate: '2026-09-10' },
      { id: '2', key: 'B-1', projectId: 'p2', title: 'Entrega B', assigneeId: 'u2', status: 'Em andamento', priority: 'medium', startDate: '2026-09-01', dueDate: '2026-09-10' },
    ];
    dataService.getProjects = () => [{ id: 'p1', key: 'A', name: 'Projeto A' }, { id: 'p2', key: 'B', name: 'Projeto B' }];
    dataService.getUsers = () => [{ id: 'u1', displayName: 'Ana' }, { id: 'u2', displayName: 'Bruno' }];
    dataService.getCards = () => cards;
    dataService.getCardById = id => cards.find(card => card.id === id);
    dataService.getProjectById = id => dataService.getProjects().find(project => project.id === id);
    dataService.getUserById = id => dataService.getUsers().find(user => user.id === id);
    (await import('/src/pages/gantt.js')).renderGantt();
  });
  assert.deepEqual(await page.locator('#gantt-assignee option').allTextContents(), ['Todos', 'Ana', 'Bruno']);
  await page.selectOption('#gantt-project', 'p1');
  assert.deepEqual(await page.locator('#gantt-assignee option').allTextContents(), ['Todos', 'Ana']);
  await page.selectOption('#gantt-assignee', 'u1');
  assert.match(await page.locator('.gantt-active-filters').innerText(), /2 filtro/);
  assert.equal(await page.locator('.gantt-toolbar').evaluate(el => Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector('.gantt-summary-bar')).zIndex || 0)), true);
  await page.screenshot({ path: '/tmp/gantt-filters.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: filtro dependente, combinacao e camada da toolbar acima dos KPIs.');
} finally { await browser.close(); }
