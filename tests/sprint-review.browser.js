// Run against `npm run dev -- --host 127.0.0.1`. All data/API responses are synthetic.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildSprintReview } from '../src/data/sprint-review.js';
import { prepareReviewSnapshot } from '../lib/sprintReviewValidation.js';

const source = { projectKey: 'TEST', boardId: 1, sprint: { id: 4, name: 'Sprint 4', state: 'closed', startDate: '2026-08-01T00:00:00Z', completeDate: '2026-08-15T00:00:00Z' }, profile: { version: 1, timezone: 'UTC', sprintField: 'customfield_1', eligibleTypes: ['1'], statusMap: { '1': 'done' }, grouping: 'card' }, scopeComplete: true, issues: Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1), key: `TEST-${i + 1}`, fields: { summary: 'Entrega executiva para validacao de resultado e planejamento ' + i, created: '2026-07-01T00:00:00Z', status: { id: '1' }, issuetype: { id: '1' }, customfield_1: [{ id: 4 }] }, historyComplete: true, changelog: { histories: [], total: 0 }, comments: [] })) };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], snapshots = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sr-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content" style="padding:24px"></main></body></html>' }));
  await page.route('**/api/jira/sprint-review/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/sprint-review')[1];
    let payload = {}, status = 200;
    if (path === '/projects') payload = { projects: [{ key: 'TEST', name: 'Projeto de teste' }] };
    if (path === '/boards') payload = { boards: [{ id: 1, name: 'Board 1' }] };
    if (path === '/context') payload = { sprints: [source.sprint], profile: source.profile, types: [], fields: [], canConfigure: true };
    if (path === '/snapshots') payload = { snapshots };
    if (path === '/analyze') payload = { sourceId: 'fixture', review: buildSprintReview(source), jiraBaseUrl: 'https://jira.example.test', fetchedAt: '2026-09-02T10:00:00Z' };
    if (path === '/recalculate') payload = { review: buildSprintReview({ ...source, choices: route.request().postDataJSON().choices }) };
    if (path === '/snapshots' && route.request().method() === 'POST') {
      try { const snapshot = { id: 'fixture-snapshot', revision: 1, created_at: '2026-09-02T12:00:00Z', payload: prepareReviewSnapshot(source, route.request().postDataJSON()) }; snapshots.push(snapshot); payload = { snapshot }; }
      catch (error) { status = 400; payload = { error: error.message }; }
    }
    await route.fulfill({ json: payload, status });
  });
  await page.goto('http://127.0.0.1:5173/sr-fixture');
  await page.evaluate(async () => { const { renderSprintReview } = await import('/src/pages/sprint-review.js'); await renderSprintReview(); });
  await page.selectOption('#sr-project', 'TEST');
  await page.waitForSelector('#sr-board option[value="1"]', { state: 'attached' });
  await page.selectOption('#sr-board', '1');
  await page.waitForSelector('#sr-sprint option[value="4"]', { state: 'attached' });
  await page.selectOption('#sr-sprint', '4');
  await page.click('#sr-analyze');
  await page.waitForSelector('#sr-search');
  assert.equal(await page.locator('tbody tr').count(), 25);
  await page.selectOption('#sr-size', '10');
  assert.equal(await page.locator('tbody tr').count(), 10);
  await page.fill('#sr-search', 'TEST-26');
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.equal(await page.locator('tbody a').getAttribute('href'), 'https://jira.example.test/browse/TEST-26');
  await page.click('[data-evidence]');
  assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  await page.click('#sr-save');
  await page.waitForSelector('[role=alert]');
  assert.equal(snapshots.length, 0);
  await page.click('#sr-group');
  await page.waitForFunction(() => !document.querySelector('.sprint-review').getAttribute('aria-busy').includes('true'));
  for (const checkbox of await page.locator('[data-warning]').all()) await checkbox.check();
  await page.click('#sr-preview');
  assert.ok(await page.locator('.sr-slide').count() < 16);
  assert.equal(await page.locator('.sr-slide-row').count(), 26);
  assert.equal(await page.locator('.sr-executive-block').count(), 5);
  await page.fill('#sr-exec-highlight', 'Marco confirmado pelas evidências.');
  await page.check('#sr-confirm-text');
  await page.fill('#sr-exec-highlight', 'Marco confirmado pelas evidências do fechamento.');
  assert.equal(await page.isChecked('#sr-confirm-text'), false);
  await page.check('#sr-confirm-text');
  await page.click('#sr-preview');
  const overflow = await page.locator('.sr-slide').evaluateAll(slides => slides.flatMap(node => [node, ...node.querySelectorAll('header,main,footer,p,h1,h2,.sr-slide-row,.sr-slide-statement')].filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2).map(el => el.tagName)));
  assert.deepEqual(overflow, []);
  await page.screenshot({ path: '/tmp/sprint-review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/sprint-review-mobile.png' });
  await page.click('#sr-save');
  await page.waitForFunction(() => document.querySelector('#sr-save').disabled && !document.querySelector('.sprint-review').getAttribute('aria-busy').includes('true'));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].payload.review.executive.highlight.text, 'Marco confirmado pelas evidências do fechamento.');
  const download = page.waitForEvent('download');
  download.catch(() => {});
  await page.evaluate(async () => {
    const { exportSprintSlides } = await import('/src/utils/sprint-review-render.js');
    const { buildSprintReview } = await import('/src/data/sprint-review.js');
    const fixture = { projectKey: 'TEST', boardId: 1, sprint: { id: 4, name: 'Sprint 4', state: 'closed', startDate: '2026-08-01T00:00:00Z', completeDate: '2026-08-15T00:00:00Z' }, profile: { version: 1, timezone: 'UTC', sprintField: 'customfield_1', eligibleTypes: ['1'], statusMap: {}, grouping: 'card' }, issues: [], scopeComplete: true };
    const review = buildSprintReview(fixture);
    review.deliveries = [{ title: 'Entrega de teste', keys: ['TEST-1'], result: 'done', planned: true }];
    await exportSprintSlides(review, 'fixture');
  });
  assert.match((await download).suggestedFilename(), /Sprint_Review_TEST_4_fixture_1.png/);
  assert.deepEqual(errors, []);
  console.log('Browser passed: selection, paging, links, evidence, preflight, immutable save, 16:9 preview, PNG and mobile.');
} finally { await browser.close(); }
