import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cssPath = new URL('../src/styles/main.css', import.meta.url);
const feedbackPath = new URL('../src/utils/ui-feedback.js', import.meta.url);

test('design system mantém tokens de superfície, foco e movimento reduzido', async () => {
  const css = await readFile(cssPath, 'utf8');

  for (const contract of [
    '--surface-raised:',
    '--accent-strong:',
    '--ring:',
    ':focus-visible',
    '@media (prefers-reduced-motion: reduce)',
  ]) {
    assert.match(css, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('componentes principais compartilham a fundação visual responsiva', async () => {
  const css = await readFile(cssPath, 'utf8');

  for (const selector of [
    '.sidebar',
    '.page-header',
    '.filter-bar',
    '.kpi-card',
    '.data-table th',
    '.ui-modal',
    '.ui-toast',
    '@media (max-width: 768px)',
  ]) {
    assert.ok(css.includes(selector), `Contrato visual ausente: ${selector}`);
  }
});

test('modal de confirmação fecha com Escape, contém o foco e o devolve ao acionador', async () => {
  const source = await readFile(feedbackPath, 'utf8');

  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /previouslyFocused\.focus\(\)/);
});
