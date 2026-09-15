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
  let stateRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await page.route('**/ra-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content"></main></body></html>' }));
  await page.route('**/api/jira/resource-allocation/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) {
      stateRequests += 1;
      return route.fulfill({ json: { projects: [
        { id: projectId, name: 'Payment Integration', client: 'RJA', startDate: '2026-01-01', endDate: '2026-12-31', status: 'Em andamento', note: '' },
        { id: secondProjectId, name: 'Dengo', client: 'RJA', startDate: '2026-09-14', endDate: '2027-03-31', status: 'Em andamento', note: '' },
      ], allocations, history } });
    }
    if (path.endsWith('/allocations')) {
      const body = route.request().postDataJSON();
      allocations.push(body.allocation);
      history.unshift({ id: crypto.randomUUID(), action: 'allocation.created', at: new Date().toISOString(), after: body.allocation });
      return route.fulfill({ json: { allocation: body.allocation } });
    }
    if (path.includes('/projects/') && route.request().method() === 'DELETE') {
      const id = path.split('/').pop();
      const removed = allocations.filter(item => item.projectId === id);
      for (let index = allocations.length - 1; index >= 0; index--) {
        if (allocations[index].projectId === id) allocations.splice(index, 1);
      }
      return route.fulfill({ json: { project: { id }, allocations: removed } });
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
  await page.waitForFunction(() => document.querySelector('.ra-row[data-user-id="u1"]')?.innerText.includes('60%'));
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
  assert.equal(await page.locator('[data-delete-project]').count(), 2);
  assert.match(await page.locator('.ra-project-allocation').first().getAttribute('title'), /Também alocado em/);
  await page.click('[data-tab="professional"]');
  await page.selectOption('#ra-project-filter', projectId);
  await page.waitForFunction(() => document.querySelectorAll('.ra-row').length >= 1);
  await page.selectOption('#ra-client-filter', 'RJA');
  assert.ok(await page.locator('.ra-row').count() >= 1);
  await page.click('#ra-clear');
  await page.selectOption('#ra-role-filter', 'Frontend');
  assert.match(await page.locator('.ra-row[data-user-id="u1"]').innerText(), /60%/);
  await page.click('#ra-clear');
  await page.selectOption('#ra-status-filter', 'Em andamento');
  assert.ok(await page.locator('.ra-row').count() >= 1);
  await page.click('#ra-clear');
  await page.selectOption('#ra-availability-filter', 'overallocated');
  assert.match(await page.locator('.ra-row[data-user-id="u1"]').innerText(), /120%/);
  await page.fill('#ra-search', 'zzzz-sem-resultado');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.ra-row').count(), 0);
  await page.click('#ra-clear');
  await page.waitForFunction(() => document.querySelectorAll('.ra-row').length >= 1);
  await page.click('[data-tab="project"]');
  await page.selectOption('#ra-project-filter', secondProjectId);
  assert.match(await page.locator('.ra-project').first().innerText(), /Dengo/);
  await page.click('#ra-clear');
  await page.waitForFunction(() => document.querySelectorAll('.ra-project').length >= 1);
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('rja.resourceAllocation.ui.v1', JSON.stringify({ tab: 'timeline', zoom: 'semester', viewDate: '2026-09-01', filters: {}, alertMonths: 2 }));
    await (await import('/src/pages/resource-allocation.js')).renderResourceAllocation();
  });
  assert.match(await page.locator('.ra-timeline-view').innerText(), /Timeline de Alocação/);
  const defaultTimelineUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(defaultTimelineUi.timelineDatePinned, undefined);
  assert.match(await page.locator('.ra-calendar-card > strong').innerText(), /setembro de 2026/i);
  await page.click('[data-resource-kpi="overallocated"]');
  assert.match(await page.locator('.ra-kpi-modal').innerText(), /Sobrealocados/);
  await page.click('[data-close-modal]');
  assert.equal(await page.locator('#ra-alert-months').inputValue(), '2');
  assert.equal(await page.locator('.ra-subrow-percent.available').count(), 0);
  assert.equal(await page.locator('.ra-no-future').count(), 0);
  const stateRequestsBeforeTimelineControls = stateRequests;
  assert.ok(await page.locator('[data-calendar-date="2026-09-15"]').count() > 0);
  await page.click('[data-calendar-date="2026-09-15"]');
  const persistedUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(persistedUi.viewDate, '2026-09-15');
  await page.selectOption('#ra-calendar-month', '11');
  const decemberUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(decemberUi.viewDate, '2026-12-15');
  await page.selectOption('#ra-calendar-year', '2027');
  const yearUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(yearUi.viewDate, '2027-12-15');
  await page.click('[data-calendar-shift="-1"]');
  const shiftedUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(shiftedUi.viewDate, '2027-11-15');
  await page.click('[data-timeline-shift="-1"]');
  await page.click('[data-timeline-today]');
  await page.click('#ra-zoom-in');
  assert.equal(stateRequests, stateRequestsBeforeTimelineControls, 'controles da timeline nao devem recarregar o estado remoto a cada clique');
  const calendarMonthWidth = await page.locator('#ra-calendar-month').boundingBox();
  const calendarYearWidth = await page.locator('#ra-calendar-year').boundingBox();
  assert.ok(calendarMonthWidth.width >= 100, 'seletor de mes do calendario precisa ser legivel');
  assert.ok(calendarYearWidth.width >= 70, 'seletor de ano do calendario precisa ser legivel');
  await page.evaluate(async () => {
    const ui = JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1'));
    localStorage.setItem('rja.resourceAllocation.ui.v1', JSON.stringify({ ...ui, viewDate: '2026-09-01', filters: {} }));
    await (await import('/src/pages/resource-allocation.js')).renderResourceAllocation();
  });
  const lightTimelineColors = await page.locator('.ra-timeline-table').evaluate(el => {
    const table = getComputedStyle(el);
    const head = getComputedStyle(document.querySelector('.ra-timeline-head'));
    const person = getComputedStyle(document.querySelector('.ra-sticky-person'));
    return { table: table.backgroundColor, head: head.backgroundColor, person: person.backgroundColor };
  });
  assert.doesNotMatch(lightTimelineColors.table, /rgb\(7, 19, 36\)|rgb\(8, 23, 42\)/);
  assert.doesNotMatch(lightTimelineColors.head, /rgb\(18, 39, 68\)/);
  assert.doesNotMatch(lightTimelineColors.person, /rgb\(12, 30, 54\)/);
  const allocationHeader = page.locator('.ra-timeline-head > span').nth(1);
  assert.match(await allocationHeader.innerText(), /% alocação/i);
  const allocationHeaderBox = await allocationHeader.boundingBox();
  const allocationHeaderStyles = await allocationHeader.evaluate(el => {
    const styles = getComputedStyle(el);
    return { color: styles.color, background: styles.backgroundColor };
  });
  assert.ok(allocationHeaderBox.width >= 100, 'coluna % alocacao precisa ter largura visivel');
  assert.notEqual(allocationHeaderStyles.color, allocationHeaderStyles.background, 'texto da coluna % alocacao nao pode sumir no fundo');
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"]').count(), 1);
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-subrow .ra-timeline-bar').count(), 2);
  assert.match(await page.locator('.ra-timeline-row[data-user-id="u1"]').innerText(), /120%/);
  const scaleText = await page.locator('.ra-scale').innerText();
  ['setembro 2026', 'outubro 2026', 'novembro 2026', 'dezembro 2026', 'janeiro 2027', 'fevereiro 2027', 'março 2027'].forEach(month => assert.match(scaleText, new RegExp(month, 'i')));
  ['set 26', 'out 26', 'nov 26', 'dez 26'].forEach(month => assert.match(scaleText, new RegExp(month, 'i')));
  assert.doesNotMatch(scaleText, /\b15\b|\b22\b|\b29\b|Hoje/);
  assert.ok(await page.locator('.ra-month-grid i').count() >= 7);
  assert.ok(await page.locator('.ra-month-label strong').count() >= 7);
  assert.ok(await page.locator('.ra-month-label small').count() >= 7);
  assert.equal(await page.locator('.ra-timeline-row[data-user-id="u1"]').evaluate(el => el.classList.contains('overallocated')), true);
  const firstBar = page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-bar').first();
  const firstBarBox = await firstBar.boundingBox();
  const firstPercentBox = await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-subrow-percent').first().boundingBox();
  assert.ok(firstBarBox.x > firstPercentBox.x + firstPercentBox.width - 2, 'barra nao deve cobrir o chip de percentual no inicio da timeline');
  const trackBox = await page.locator('.ra-timeline-row[data-user-id="u1"] .ra-timeline-track').boundingBox();
  assert.ok(firstBarBox.x <= trackBox.x + 72, 'barra iniciada antes da janela deve respeitar somente o respiro visual do percentual');
  assert.ok(firstBarBox.x + firstBarBox.width < trackBox.x + trackBox.width - 80, 'barra com fim em 31/12/2026 nao deve se estender ate o fim da timeline');
  await page.fill('#ra-start-filter', '2027-01-05');
  await page.locator('#ra-start-filter').dispatchEvent('change');
  const filteredUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(filteredUi.viewDate, '2027-01-05');
  assert.match(await page.locator('.ra-scale').innerText(), /janeiro 2027/i);
  await page.fill('#ra-start-filter', '2027-06-01');
  await page.fill('#ra-end-filter', '2027-01-01');
  await page.locator('#ra-end-filter').dispatchEvent('change');
  assert.match(await page.locator('.ra-scale').innerText(), /janeiro 2027/i);
  await page.click('#ra-clear');
  for (const zoom of ['week', 'month', 'quarter', 'semester', 'year']) {
    await page.selectOption('#ra-zoom', zoom);
    assert.ok(await page.locator('.ra-month-label strong').count() >= 1, `zoom ${zoom} deve manter cabecalho mensal legivel`);
  }
  for (const groupBy of ['role', 'project', 'client']) {
    await page.selectOption('#ra-group-filter', groupBy);
    assert.ok(await page.locator('.ra-group').count() >= 1, `agrupamento ${groupBy} deve renderizar grupos`);
  }
  for (const months of ['1', '2', '3', '6']) {
    await page.selectOption('#ra-alert-months', months);
    assert.equal(await page.locator('#ra-alert-months').inputValue(), months);
  }
  await page.setViewportSize({ width: 880, height: 900 });
  const tableBox = await page.locator('.ra-timeline-table').boundingBox();
  const canDrag = await page.locator('.ra-timeline-table').evaluate(el => el.scrollWidth > el.clientWidth);
  assert.equal(canDrag, true);
  const stickyBefore = await page.locator('.ra-timeline-head > span').nth(0).boundingBox();
  const stickyLoadBefore = await page.locator('.ra-timeline-head > span').nth(1).boundingBox();
  await page.mouse.move(stickyBefore.x + 40, stickyBefore.y + 18);
  await page.mouse.down();
  await page.mouse.move(stickyBefore.x + 160, stickyBefore.y + 18, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator('.ra-timeline-table').evaluate(el => el.scrollLeft), 0, 'arrastar as colunas fixas nao deve navegar a timeline');
  await page.mouse.wheel(0, 420);
  assert.equal(await page.locator('.ra-timeline-table').evaluate(el => el.scrollLeft), 0, 'rolar sobre as colunas fixas nao deve navegar a timeline');
  await page.mouse.move(tableBox.x + tableBox.width - 40, tableBox.y + 28);
  await page.mouse.down();
  await page.mouse.move(tableBox.x + 120, tableBox.y + 28, { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.locator('.ra-timeline-table').evaluate(el => el.scrollLeft > 0), 'timeline deve navegar horizontalmente ao arrastar');
  await page.locator('.ra-timeline-table').evaluate(el => { el.scrollLeft = 0; });
  const firstTrackBox = await page.locator('.ra-timeline-track').first().boundingBox();
  await page.mouse.move(firstTrackBox.x + 40, firstTrackBox.y + 20);
  await page.mouse.wheel(0, 420);
  assert.ok(await page.locator('.ra-timeline-table').evaluate(el => el.scrollLeft > 0), 'timeline deve navegar horizontalmente com a rolagem do mouse');
  await page.locator('.ra-timeline-table').evaluate(el => { el.scrollLeft = 0; });
  const barBox = await page.locator('.ra-timeline-bar').first().boundingBox();
  await page.mouse.move(barBox.x + Math.min(24, barBox.width / 2), barBox.y + Math.min(10, barBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(barBox.x - 180, barBox.y + Math.min(10, barBox.height / 2), { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.locator('.ra-timeline-table').evaluate(el => el.scrollLeft > 0), 'timeline deve navegar ao arrastar sobre uma barra do gantt');
  const afterBarDragUi = await page.evaluate(() => JSON.parse(localStorage.getItem('rja.resourceAllocation.ui.v1')));
  assert.equal(afterBarDragUi.filters?.editAllocationId || '', '', 'arrastar uma barra nao deve abrir edicao acidentalmente');
  const stickyAfter = await page.locator('.ra-timeline-head > span').nth(0).boundingBox();
  const stickyLoadAfter = await page.locator('.ra-timeline-head > span').nth(1).boundingBox();
  assert.ok(Math.abs(stickyAfter.x - stickyBefore.x) < 2, 'coluna Profissional deve permanecer fixa ao rolar a timeline');
  assert.ok(Math.abs(stickyLoadAfter.x - stickyLoadBefore.x) < 2, 'coluna % alocacao deve permanecer fixa ao rolar a timeline');
  await page.screenshot({ path: '/tmp/resource-allocation.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: resource allocation opens, saves allocation, confirms overcapacity, filters and project tab.');
} finally {
  await browser.close();
}
