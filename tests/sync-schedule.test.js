import assert from 'node:assert/strict';
import test from 'node:test';
import { isWithinAutoSyncSchedule } from '../lib/syncJobService.js';

test('agenda aceita execucoes a qualquer hora e dia', () => {
  assert.equal(isWithinAutoSyncSchedule(new Date('2026-08-20T09:00:00Z')), true);
  assert.equal(isWithinAutoSyncSchedule(new Date('2026-08-20T09:30:00Z')), true);
  assert.equal(isWithinAutoSyncSchedule(new Date('2026-08-20T21:00:00Z')), true);
  assert.equal(isWithinAutoSyncSchedule(new Date('2026-08-20T21:37:00Z')), true);
  assert.equal(isWithinAutoSyncSchedule(new Date('2026-08-22T12:00:00Z')), true);
  assert.equal(isWithinAutoSyncSchedule(new Date('invalid')), false);
});
