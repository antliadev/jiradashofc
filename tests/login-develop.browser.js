// Execute com Vite iniciado na branch develop. Nenhuma credencial real e transmitida.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/login-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/styles/main.css"></head><body><header id="page-header"></header><main id="page-content"></main></body></html>' }));
  let attempts = 0;
  await page.route('**/api/auth', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 401, json: { authenticated: false } });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 401, json: { error: 'Credenciais invalidas.' } });
    return route.fulfill({ json: { success: true, sessionId: 'supabase-cookie', user: { id: 'u1', status: 'active', role: 'custom', permissions: ['executive'] } } });
  });
  await page.goto('http://127.0.0.1:5173/login-fixture#/login');
  await page.evaluate(async () => { window.updateLayout = () => {}; window.markAuthenticated = user => { window.__validatedUser = user; }; (await import('/src/pages/login.js')).renderLogin(); });
  assert.equal(await page.locator('#login-form').count(), 1);
  assert.equal(await page.locator('#google-login-btn').count(), 0);
  const note = await page.locator('.login-environment-note').innerText();
  assert.match(note, /homologacao/i);
  assert.match(note, /admin/i);
  assert.equal(await page.locator('#login-email').getAttribute('type'), 'text');
  await page.fill('#login-email', 'admin');
  await page.fill('#login-password', 'senha-incorreta');
  await page.click('#login-btn');
  await page.waitForSelector('#login-error:not([style*="display: none"])');
  assert.match(await page.locator('#login-error').innerText(), /Credenciais invalidas/);
  await page.fill('#login-password', 'admin');
  await page.click('#login-btn');
  await page.waitForFunction(() => location.hash === '#/home');
  assert.equal(await page.evaluate(() => window.__validatedUser?.id), 'u1');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/login-develop.png', fullPage: true });
  console.log('Browser passed: develop exibe email/senha, trata erro e autentica sem Google.');
} finally { await browser.close(); }
