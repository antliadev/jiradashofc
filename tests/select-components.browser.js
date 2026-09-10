// Execute com o Vite em 127.0.0.1:5173. Valida os selects compartilhados sem Jira/Supabase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/select-components-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles/main.css"></head><body><main id="fixture" class="report-toolbar"></main></body></html>',
  }));
  await page.goto('http://127.0.0.1:5173/select-components-fixture');
  await page.evaluate(async () => {
    const { initSelectLists } = await import('/src/utils/select-list.js');
    const { initMultiSelects, renderMultiSelect } = await import('/src/utils/multi-select.js');
    const root = document.getElementById('fixture');
    root.innerHTML = `
      <label>Status<select id="single-select">
        <option value="">Todos</option>
        ${Array.from({ length: 9 }, (_, index) => `<option value="${index + 1}">Status ${index + 1}</option>`).join('')}
      </select></label>
      ${renderMultiSelect({
        id: 'multi-select',
        label: 'Analistas',
        options: [
          { value: 'ana', label: 'Ana' },
          { value: 'bruno', label: 'Bruno' },
          { value: 'carla', label: 'Carla' },
        ],
        selectedValues: ['ana', 'bruno', 'carla'],
        optionDataAttribute: 'data-test-option',
      })}`;
    window.singleChanges = 0;
    window.multiChanges = 0;
    document.getElementById('single-select').addEventListener('change', () => { window.singleChanges += 1; });
    document.querySelectorAll('[data-test-option]').forEach(input => input.addEventListener('change', () => { window.multiChanges += 1; }));
    initSelectLists();
    initMultiSelects();
  });

  const singleTrigger = page.locator('.select-list-trigger');
  await singleTrigger.click();
  assert.equal(await singleTrigger.getAttribute('aria-expanded'), 'true');
  await page.locator('[data-select-list-search]').fill('Status 7');
  await page.locator('[data-select-list-option]:visible').click();
  assert.equal(await page.locator('#single-select').inputValue(), '7');
  assert.equal(await singleTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => window.singleChanges), 1);

  const multiTrigger = page.locator('[data-multi-select-trigger]');
  assert.equal(await page.locator('[data-multi-remove]').count(), 2);
  assert.match(await multiTrigger.innerText(), /\+1/);
  await multiTrigger.press('Enter');
  assert.equal(await multiTrigger.getAttribute('aria-expanded'), 'true');
  await page.locator('[data-multi-select-search]').fill('Carla');
  assert.equal(await page.locator('[data-multi-option]:visible').count(), 1);
  await page.locator('[data-multi-select-search]').press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.value), 'carla');
  await page.locator('[data-multi-select-search]').fill('');
  await page.locator('[data-multi-remove="ana"]').click();
  assert.equal(await page.locator('[data-test-option][value="ana"]').isChecked(), false);
  assert.equal(await page.evaluate(() => window.multiChanges), 1);

  await page.screenshot({ path: '/tmp/select-components-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: selects único e múltiplo preservam eventos, busca, chips e teclado no mobile.');
} finally {
  await browser.close();
}
