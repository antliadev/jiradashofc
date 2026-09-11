// Execute com o Vite em 127.0.0.1:5173. Valida a sidebar real sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sidebar-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><aside id="sidebar" class="sidebar"></aside><main class="main-content"></main></body></html>',
  }));
  await page.goto('http://127.0.0.1:5173/sidebar-fixture#/projects/resource-allocation');
  await page.evaluate(async () => {
    localStorage.setItem('rja.currentUser', JSON.stringify({ role: 'full', status: 'active' }));
    localStorage.removeItem('rja.sidebar.collapsed');
    const { dataService } = await import('/src/data/data-service.js');
    dataService._hasLoaded = true;
    dataService.getCards = () => [];
    const { renderSidebar } = await import('/src/components/sidebar.js');
    renderSidebar();
  });

  const sidebar = page.locator('#sidebar');
  await assert.doesNotReject(() => sidebar.waitFor({ state: 'visible' }));

  const projectsGroup = page.locator('[data-menu="projects"]');
  const sprintGroup = page.locator('[data-menu="sprint"]');
  const projectsSubmenu = page.locator('#submenu-projects');
  const sprintButton = page.locator('[data-nav-toggle="sprint"]');
  const sprintSubmenu = page.locator('#submenu-sprint');

  assert.equal(await projectsGroup.evaluate(el => el.classList.contains('expanded')), true);
  assert.equal(await projectsSubmenu.getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('[data-route="/projects/resource-allocation"]').evaluate(el => el.classList.contains('active')), true);
  assert.equal(await page.locator('[data-route="/projects"]').evaluate(el => el.classList.contains('active')), false);
  assert.equal(await projectsSubmenu.evaluate(el => getComputedStyle(el).gridTemplateRows !== '0px'), true);

  await sprintButton.click();
  assert.equal(await sprintButton.getAttribute('aria-expanded'), 'true');
  assert.equal(await sprintSubmenu.getAttribute('aria-hidden'), 'false');
  assert.equal(await sprintGroup.evaluate(el => el.classList.contains('expanded')), true);
  assert.equal(await projectsGroup.evaluate(el => el.classList.contains('expanded')), true);

  await page.locator('[data-nav-toggle="contracts"]').click();
  assert.equal(await page.locator('#submenu-contracts').getAttribute('aria-hidden'), 'false');
  assert.equal(await sprintSubmenu.getAttribute('aria-hidden'), 'true');
  assert.equal(await projectsSubmenu.getAttribute('aria-hidden'), 'false');

  await page.locator('#sidebar-collapse-toggle').click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), true);
  assert.match(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).transitionProperty), /width|transform/);
  assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).transitionDuration.split(',')[0].trim()), '0.52s');
  await page.mouse.move(32, 40);
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.sidebar')).width) > 220);
  assert.equal(await page.locator('.sidebar').evaluate(el => parseFloat(getComputedStyle(el).width) > 220), true);
  await page.locator('#sidebar-collapse-toggle').click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), true);
  assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-hover-suppressed')), true);
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.sidebar')).width) < 100);
  assert.equal(await page.locator('.sidebar').evaluate(el => parseFloat(getComputedStyle(el).width) < 100), true);
  await page.mouse.move(500, 40);
  assert.equal(await page.evaluate(() => document.body.classList.contains('sidebar-hover-suppressed')), false);
  await page.mouse.move(32, 40);
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.sidebar')).width) > 220);
  assert.equal(await page.locator('.sidebar').evaluate(el => parseFloat(getComputedStyle(el).width) > 220), true);
  assert.match(await projectsSubmenu.evaluate(el => getComputedStyle(el).transitionProperty), /grid-template-rows|opacity|transform/);

  await page.screenshot({ path: '/tmp/sidebar-accordion.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: sidebar accordion preserva rotas, estado ativo, colapso e transicoes suaves.');
} finally {
  await browser.close();
}
