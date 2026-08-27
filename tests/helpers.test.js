import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, parseJiraDate } from '../src/utils/helpers.js';

test('formatDate preserva data pura do Jira sem deslocar por timezone', () => {
  assert.equal(formatDate('2026-02-28'), '28/02/2026');
});

test('parseJiraDate rejeita datas invalidas', () => {
  assert.equal(parseJiraDate('sem-data'), null);
});
