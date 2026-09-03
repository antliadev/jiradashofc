// Synthetic fixture only. Requires Vite at http://127.0.0.1:5173.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildSprintReview } from '../src/data/sprint-review.js';

const source = { projectKey: 'DEMO', boardId: 1, sprint: { id: 4, name: 'Sprint 4', state: 'closed', startDate: '2026-08-17T12:00:00Z', endDate: '2026-08-21T21:00:00Z', completeDate: '2026-08-22T15:10:56Z' }, profile: { version: 1, timezone: 'America/Sao_Paulo', sprintField: 'customfield_1', eligibleTypes: ['1'], statusMap: { '1': 'done', '2': 'progress' }, grouping: 'card' }, choices: { confirmGrouping: true }, scopeComplete: true,
  issues: ['Polimento e documentação — Client-Reference', 'Preparação — Freeze', 'Infraestrutura — Freeze', 'CI mínima — Freeze', 'Quality Gates — Freeze', 'Banco e pacote — Freeze'].map((summary, i) => ({ id: String(i + 1), key: `DEMO-${i + 1}`, fields: { summary, created: '2026-07-01T00:00:00Z', duedate: `2026-08-${17 + Math.min(i, 4)}`, status: { id: i === 5 ? '2' : '1' }, issuetype: { id: '1' }, customfield_1: [{ id: 4 }] }, historyComplete: true, changelog: { histories: [], total: 0 }, comments: [] })) };
const review = buildSprintReview(source);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let saved = [], savedArt = { renders: [], manifest: { complete: false, pageCount: 1, uploadedPages: [] } };
  await page.route('**/sr-front-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="pt-BR"><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><div id="page-header"></div><main id="page-content" style="padding:24px"></main></body></html>' }));
  await page.route('**/api/jira/sprint-review/**', route => {
    const path = new URL(route.request().url()).pathname.split('/sprint-review')[1];
    if (path === '/snapshots') return route.fulfill({ json: { snapshots: saved } });
    if (path === '/snapshots/saved') return route.fulfill({ json: { snapshot: saved[0] } });
    if (path === '/snapshots/saved/art') return saved[0]?.payload.renderManifest ? route.fulfill({ json: savedArt }) : route.fulfill({ status: 409, json: { error: 'Versão antiga sem manifesto. Crie uma nova versão.' } });
    const payload = { '/projects': { projects: [{ key: 'DEMO', name: 'Projeto demonstrativo' }] }, '/boards': { boards: [{ id: 1, name: 'Board demonstrativo' }] }, '/context': { sprints: [source.sprint], profile: source.profile, types: [], fields: [], canConfigure: true }, '/snapshots': { snapshots: [] }, '/analyze': { sourceId: 'fixture6', review, fetchedAt: source.sprint.completeDate } }[path] || {};
    return route.fulfill({ json: payload });
  });
  await page.goto('http://127.0.0.1:5173/sr-front-fixture');
  await page.evaluate(async () => (await import('/src/pages/sprint-review.js')).renderSprintReview());
  await page.selectOption('#sr-project', 'DEMO');
  await page.selectOption('#sr-board', '1');
  await page.selectOption('#sr-sprint', '4');
  await page.click('#sr-analyze');
  await page.waitForSelector('#sr-exec-highlight');
  await page.click('#sr-preview');
  assert.equal(await page.locator('.sr-slide').count(), 1);
  assert.equal(await page.locator('.sr-slide-row').count(), 6);
  assert.equal(await page.locator('.sr-executive-block').count(), 5);
  await page.locator('[role=tab]').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'), 'cards');
  assert.equal(await page.locator('[role=tabpanel]').getAttribute('aria-labelledby'), 'sr-tab-cards');
  await page.click('[data-executive-evidence=attention]');
  assert.equal(await page.locator('dialog').evaluate(d => d.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-executive-evidence=attention]').evaluate(e => e === document.activeElement), true);
  await page.click('[data-tab=plan]'); await page.click('#sr-preview');
  await page.screenshot({ path: '/tmp/sprint-review-fixture6-tela.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await page.screenshot({ path: '/tmp/sprint-review-fixture6-tela-clara.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/sprint-review-fixture6-mobile.png', fullPage: true, animations: 'disabled' });
  await page.fill('#sr-exec-highlight', 'Texto revisado pelo usuário.');
  assert.match(await page.locator('#sr-origin-highlight').textContent(), /Edição humana.*não verificada/);
  saved = [{ id: 'saved', revision: 1, content_hash: 'fixture-hash', created_at: source.sprint.completeDate, payload: { review, sourceId: 'fixture6', goal: null, acceptedWarnings: [], renderManifest: { pageCount: 1, templateVersion: 'antlia-sprint-16x9-v2' } } }];
  await page.selectOption('#sr-sprint', ''); await page.selectOption('#sr-sprint', '4');
  await page.selectOption('#sr-saved', 'saved');
  await page.waitForFunction(() => document.querySelector('#sr-save')?.disabled);
  await page.click('#sr-preview');
  assert.equal(await page.locator('#sr-preview-area .sr-slide').count(), 0);
  assert.match(await page.locator('#sr-preview-area').textContent(), /incompleta, não final/);
  savedArt = { renders: [{ page: 1, png: 'iVBORw0KGgo=', hash: 'png-hash' }], manifest: { complete: true, snapshotId: 'saved', snapshotHash: 'wrong-source', pageCount: 1, pages: [{ page: 1, hash: 'png-hash' }] } };
  await page.selectOption('#sr-saved', ''); await page.selectOption('#sr-saved', 'saved');
  await page.waitForFunction(() => document.querySelector('.sprint-review').getAttribute('aria-busy') === 'false');
  await page.click('#sr-preview');
  assert.equal(await page.locator('#sr-preview-area img').count(), 0);
  delete saved[0].payload.renderManifest;
  await page.selectOption('#sr-saved', ''); await page.selectOption('#sr-saved', 'saved');
  await page.waitForSelector('[role=alert]');
  await page.click('#sr-preview');
  assert.match(await page.locator('#sr-preview-area').textContent(), /Arte original indisponível\/sem manifesto/);
  assert.equal(await page.locator('#sr-preview-area .sr-slide').count(), 0);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.evaluate(async review => {
    const { renderSprintSlides } = await import('/src/utils/sprint-review-render.js');
    document.body.innerHTML = renderSprintSlides({ review });
    document.querySelector('.sr-slide').style.zoom = '1';
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode()));
  }, review);
  const overflow = await page.locator('.sr-slide').evaluate(node => [node, ...node.querySelectorAll('*')].filter(e => e.clientWidth && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)).map(e => ({ tag: e.tagName, class: e.className, h: e.clientHeight, sh: e.scrollHeight, w: e.clientWidth, sw: e.scrollWidth, text: e.textContent })));
  assert.deepEqual(overflow, []);
  await page.locator('.sr-slide').screenshot({ path: '/tmp/sprint-review-fixture6-arte.png' });
  let downloads = 0; page.on('download', () => downloads++);
  const failed = await page.evaluate(async review => {
    const { exportSprintSlides } = await import('/src/utils/sprint-review-render.js');
    const expanded = { ...review, deliveries: [...review.deliveries, ...review.deliveries] };
    const persisted = [];
    try { await exportSprintSlides(expanded, 'failure', { persist: async (_, page) => { persisted.push(page); if (page === 2) throw new Error('Falha simulada'); } }); }
    catch (e) { return { message: e.message, persisted }; }
  }, review);
  assert.deepEqual(failed, { message: 'Falha simulada', persisted: [1, 2] });
  assert.equal(downloads, 0);
  const download = page.waitForEvent('download'); download.catch(() => {});
  await page.evaluate(async review => {
    const { exportSprintSlides } = await import('/src/utils/sprint-review-render.js');
    await exportSprintSlides(review, 'fixture6', { persist: async () => {} });
  }, review);
  await (await download).saveAs('/tmp/sprint-review-fixture6-export.png');
  assert.deepEqual(errors, []);
  console.log('Front browser passed: fixture6 single slide, keyboard, dialog focus, themes, mobile, PNG, no downloads on partial persistence.');
} finally { await browser.close(); }
