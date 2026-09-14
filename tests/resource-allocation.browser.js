// Execute com o Vite em 127.0.0.1:5173. Dados sinteticos, sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const dialogs = [];
  const projectId = '11111111-1111-4111-8111-111111111111';
  const secondProjectId = '22222222-2222-4222-8222-222222222222';
  const avatarSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#6366f1"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="14">AM</text></svg>')}`;
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
    if (path.endsWith('/state')) return route.fulfill({ json: { projects: [
      { id: projectId, name: 'Payment Integration', client: 'RJA', startDate: '2026-01-01', endDate: '2026-12-31', status: 'Em andamento', note: '' },
      { id: secondProjectId, name: 'Dengo', client: 'RJA', startDate: '2026-09-14', endDate: '2027-03-31', status: 'Em andamento', note: '' },
    ], allocations, history } });
    if (path.endsWith('/allocations')) {
      const body = route.request().postDataJSON();
      allocations.push(body.allocation);
      history.unshift({ id: crypto.randomUUID(), action: 'allocation.created', at: new Date().toISOString(), after: body.allocation });
      return route.fulfill({ json: { allocation: body.allocation } });
    }
    return route.fulfill({ status: 404, json: { error: 'unexpected route' } });
  });
  await page.goto('http://127.0.0.1:5173/ra-fixture');
  await page.evaluate(async avatarUrl => {
    localStorage.removeItem('rja.resourceAllocation.v1');
    localStorage.removeItem('rja.resourceAllocation.ui.v1');
    const { dataService } = await import('/src/data/data-service.js');
    dataService.getUsersForSelection = () => [
      { id: 'u1', displayName: 'Ana Maria Colaboradora de Teste', email: 'ana@example.test', avatarUrl },
      { id: 'u2', displayName: 'Bruno', email: 'bruno@example.test' },
      { id: 'u3', displayName: 'Carlos', email: 'carlos@example.test' },
    ];
    await (await import('/src/pages/resource-allocation.js')).renderResourceAllocation();
  }, avatarSvg);
  assert.match(await page.locator('#page-header').innerText(), /Alocação de Recursos/);
  assert.equal(await page.locator('.ra-row').count(), 2);
  assert.doesNotMatch(await page.locator('#ra-user-filter').innerText(), /Bruno/);
  await page.selectOption('#ra-allocation-form select[name="userId"]', 'u1');
  await page.selectOption('#ra-allocation-form select[name="projectId"]', projectId);
  await page.fill('#ra-allocation-form input[name="startDate"]', '2026-01-01');
  await page.fill('#ra-allocation-form input[name="endDate"]', '2026-12-31');
  await page.fill('#ra-allocation-form input[name="percent"]', '60');
  await page.fill('#ra-allocation-form input[name="role"]', 'Frontend');
  await page.click('#ra-allocation-form button[type="submit"]');
  assert.match(await page.locator('.ra-row[data-user-id="u1"]').innerText(), /60%/);
  await page.selectOption('#ra-allocation-form select[name="userId"]', 'u1');
  await page.selectOption('#ra-allocation-form select[name="projectId"]', secondProjectId);
  await page.fill('#ra-allocation-form input[name="startDate"]', '2026-09-14');
  await page.fill('#ra-allocation-form input[name="endDate"]', '2027-03-31');
  await page.fill('#ra-allocation-form input[name="percent"]', '60');
  await page.click('#ra-allocation-form button[type="submit"]');
  assert.match(dialogs.join('\n'), /Sobrealocação identificada/);
  await page.selectOption('#ra-availability-filter', 'overallocated');
  await page.waitForFunction(() => document.querySelector('.ra-row[data-user-id="u1"]')?.innerText.includes('120%'));
  assert.match(await page.locator('.ra-row[data-user-id="u1"]').innerText(), /120%/);
  await page.click('[data-tab="project"]');
  assert.match(await page.locator('.ra-project').first().innerText(), /Payment Integration|Dengo/);
  assert.equal(await page.locator('.ra-project-allocation [data-edit-allocation], .ra-project-allocation [data-delete-allocation]').count(), 0);
  assert.equal(await page.locator('.ra-project-allocation .ra-user-avatar img').count(), 2);
  assert.match(await page.locator('.ra-project-allocation').first().innerText(), /Ana Maria Colaboradora de Teste/);
  await page.evaluate(async () => {
    localStorage.setItem('rja.resourceAllocation.ui.v1', JSON.stringify({ tab: 'timeline', zoom: 'semester', viewDate: '2026-09-01', filters: {} }));
    await (await import('/src/pages/resource-allocation.js')).renderResourceAllocation();
  });
  assert.match(await page.locator('.ra-timeline-view').innerText(), /Timeline de Alocação/);
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"]').count(), 1);
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-subrow .ra-timeline-bar').count(), 2);
  assert.match(await page.locator('.ra-timeline-row[data-user-id="u1"]').innerText(), /120%/);
  const scaleText = await page.locator('.ra-scale').innerText();
  ['set.', 'out.', 'nov.', 'dez.', 'jan.', 'fev.', 'mar.'].forEach(month => assert.match(scaleText, new RegExp(month.replace('.', '\\.'), 'i')));
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"]').evaluate(el => el.classList.contains('overallocated')), true);
  const firstBar = page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-bar').first();
  const firstBarBox = await firstBar.boundingBox();
  const firstPercentBox = await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-subrow-percent').first().boundingBox();
  assert.ok(firstBarBox.x > firstPercentBox.x + firstPercentBox.width - 2, 'barra nao deve cobrir o chip de percentual no inicio da timeline');
  const trackBox = await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-track').boundingBox();
  assert.ok(firstBarBox.x <= trackBox.x + 72, 'barra iniciada antes da janela deve respeitar somente o respiro visual do percentual');
  assert.ok(firstBarBox.x + firstBarBox.width < trackBox.x + trackBox.width - 80, 'barra com fim em 31/12/2026 nao deve se estender ate o fim da timeline');
  await page.screenshot({ path: '/tmp/resource-allocation.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: resource allocation opens, saves allocation, confirms overcapacity, filters and project tab.');
} finally {
  await browser.close();
}
