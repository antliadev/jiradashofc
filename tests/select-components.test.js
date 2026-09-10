import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMultiSelect } from '../src/utils/multi-select.js';

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
