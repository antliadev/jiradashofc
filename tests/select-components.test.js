import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMultiSelect } from '../src/utils/multi-select.js';
import { readFile } from 'node:fs/promises';

const cssPath = new URL('../src/styles/main.css', import.meta.url);

test('renderMultiSelect preserva atributos funcionais e expõe semântica acessível', () => {
  const html = renderMultiSelect({
    id: 'status-filter',
    label: 'Status',
    options: [
      { value: 'todo', label: 'A fazer' },
      { value: 'progress', label: 'Em andamento' },
    ],
    selectedValues: ['progress'],
    optionDataAttribute: 'data-monitoring-filter',
    optionDataValue: 'statuses',
    allDataAttribute: 'data-monitoring-filter-all',
    allDataValue: 'statuses',
    wrapperDataAttribute: 'data-filter-key',
    wrapperDataValue: 'statuses',
  });

  assert.match(html, /role="combobox"/);
  assert.match(html, /role="listbox" aria-multiselectable="true"/);
  assert.match(html, /data-monitoring-filter="statuses" value="progress" checked/);
  assert.match(html, /data-monitoring-filter-all="statuses"/);
  assert.match(html, /data-multi-remove="progress"/);
  assert.match(html, /Em andamento/);
});

test('renderMultiSelect limita chips visíveis e mantém a contagem restante', () => {
  const options = [1, 2, 3, 4].map(value => ({ value: String(value), label: `Opção ${value}` }));
  const html = renderMultiSelect({
    id: 'users-filter',
    label: 'Profissionais',
    options,
    selectedValues: options.map(option => option.value),
  });

  assert.equal((html.match(/data-multi-remove=/g) || []).length, 2);
  assert.match(html, /multi-select-more">\+2/);
  assert.match(html, /aria-selected="true"/);
});

test('renderMultiSelect rejeita nomes arbitrários de atributos data', () => {
  const html = renderMultiSelect({
    id: 'safe-filter',
    label: 'Seguro',
    options: [{ value: '1', label: 'Um' }],
    optionDataAttribute: 'onclick',
    allDataAttribute: 'data-safe onmouseover',
  });

  assert.doesNotMatch(html, /onclick|onmouseover/);
});

test('listas selecionáveis destacam o estado sem ícones de check', async () => {
  const css = await readFile(cssPath, 'utf8');

  assert.doesNotMatch(css, /content:\s*['"]✓['"]/);
  assert.doesNotMatch(css, /grid-template-columns:\s*22px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.select-list-option\.is-selected[\s\S]*background:\s*var\(--accent-glow\)/);
});
