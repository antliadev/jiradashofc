// Execute com o Vite em 127.0.0.1:5173. Dados sinteticos, sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const dialogs = [];
  const projectId = '11111111-1111-4111-8111-111111111111';
  const allocations = [];
  const history = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await page.route('**/ra-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content"></main></body></html>' }));
  await page.route('**/api/jira/resource-allocation/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) return route.fulfill({ json: { projects: [{ id: projectId, name: 'Radar Jira Antlia', client: 'RJA', startDate: '2026-09-01', endDate: '2026-12-31', status: 'Em andamento', note: '' }], allocations, history } });
    if (path.endsWith('/allocations')) {
      const body = route.request().postDataJSON();
      allocations.push(body.allocation);
      history.unshift({ id: crypto.randomUUID(), action: 'allocation.created', at: new Date().toISOString(), after: body.allocation });
      return route.fulfill({ json: { allocation: body.allocation } });
    }
    return route.fulfill({ status: 404, json: { error: 'unexpected route' } });
  });
  await page.goto('http://127.0.0.1:5173/ra-fixture');
  await page.evaluate(async () => {
    localStorage.removeItem('rja.resourceAllocation.v1');
    localStorage.removeItem('rja.resourceAllocation.ui.v1');
    const { dataService } = await import('/src/data/data-service.js');
    dataService.getUsersRanked = () => [{ id: 'u1', displayName: 'Ana', email: 'ana@example.test' }, { id: 'u2', displayName: 'Bruno', email: 'bruno@example.test' }];
    await (await import('/src/pages/resource-allocation.js')).renderResourceAllocation();
  });
  assert.match(await page.locator('#page-header').innerText(), /Alocação de Recursos/);
  assert.equal(await page.locator('.ra-row').count(), 2);
  await page.selectOption('#ra-allocation-form select[name="userId"]', 'u1');
  await page.selectOption('#ra-allocation-form select[name="projectId"]', projectId);
  await page.fill('#ra-allocation-form input[name="startDate"]', '2020-01-01');
  await page.fill('#ra-allocation-form input[name="endDate"]', '2030-01-01');
  await page.fill('#ra-allocation-form input[name="percent"]', '60');
  await page.fill('#ra-allocation-form input[name="role"]', 'Frontend');
  await page.click('#ra-allocation-form button[type="submit"]');
  assert.match(await page.locator('.ra-row[data-user-id="u1"]').innerText(), /60%/);
  await page.selectOption('#ra-allocation-form select[name="userId"]', 'u1');
  await page.selectOption('#ra-allocation-form select[name="projectId"]', projectId);
  await page.fill('#ra-allocation-form input[name="startDate"]', '2020-01-01');
  await page.fill('#ra-allocation-form input[name="endDate"]', '2030-01-01');
  await page.fill('#ra-allocation-form input[name="percent"]', '60');
  await page.click('#ra-allocation-form button[type="submit"]');
  assert.match(dialogs.join('\n'), /Sobrealocação identificada/);
  await page.selectOption('#ra-availability-filter', 'overallocated');
  await page.waitForFunction(() => document.querySelectorAll('.ra-row').length === 1);
  assert.equal(await page.locator('.ra-row').count(), 1);
  await page.click('[data-tab="project"]');
  assert.match(await page.locator('.ra-project').innerText(), /Radar Jira Antlia/);
  await page.screenshot({ path: '/tmp/resource-allocation.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: resource allocation opens, saves allocation, confirms overcapacity, filters and project tab.');
} finally {
  await browser.close();
}
