// Execute com VERCEL_GIT_COMMIT_REF=main para provar que producao permanece Google-only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/login-main-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><header id="page-header"></header><main id="page-content"></main></body></html>' }));
  await page.goto('http://127.0.0.1:5174/login-main-fixture#/login');
  await page.evaluate(async () => { window.updateLayout = () => {}; (await import('/src/pages/login.js')).renderLogin(); });
  assert.equal(await page.locator('#google-login-btn').count(), 1);
  assert.equal(await page.locator('#login-form').count(), 0);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  console.log('Browser passed: main permanece Google-only e nao renderiza senha.');
} finally { await browser.close(); }
