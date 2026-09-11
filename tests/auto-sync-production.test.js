import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AUTO_SYNC_STALE_GRACE_MS, getSyncFreshness } from '../src/utils/sync-freshness.js';

test('producao nao usa Vercel Cron incompatível com Hobby para intervalo de 30 minutos', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.equal(config.crons, undefined);
});

test('GitHub Actions aciona o worker protegido de producao a cada 30 minutos', async () => {
  const workflow = await readFile(new URL('../.github/workflows/auto-sync.yml', import.meta.url), 'utf8');

  assert.match(workflow, /cron:\s+'\*\/30 \* \* \* \*'/);
  assert.match(workflow, /https:\/\/radarjira\.antlia\.com\.br\/api\/jira\/sync\/worker/);
  assert.match(workflow, /Authorization: Bearer \$\{RJA_CRON_SECRET\}/);
  assert.match(workflow, /secrets\.RJA_CRON_SECRET/);
});

test('sincronizacao automatica usa JQL incremental e nao remove dados antigos', async () => {
  const service = await readFile(new URL('../lib/syncJobService.js', import.meta.url), 'utf8');

  assert.match(service, /DEFAULT_AUTO_SYNC_JQL = 'updated >= -90m ORDER BY updated DESC'/);
  assert.match(service, /AUTO_SYNC_JQL = process\.env\.AUTO_SYNC_JQL/);
  assert.match(service, /readAutoSyncCredentialsFromEnv/);
  assert.match(service, /processQueued = false/);
  assert.match(service, /createSyncJob\(\s*credentialsFromEnv,\s*`auto-sync-\$\{source\}`,\s*\{\s*pruneObsolete: false\s*\}/s);
});

test('status de sucesso antigo demais fica marcado como atraso operacional', () => {
  const stale = getSyncFreshness('2026-09-10T20:25:37.000Z', '2026-09-11T13:19:00.000Z');
  assert.equal(stale.isStale, true);
  assert.ok(stale.ageMs > AUTO_SYNC_STALE_GRACE_MS);

  const fresh = getSyncFreshness('2026-09-11T12:25:37.000Z', '2026-09-11T13:19:00.000Z');
  assert.equal(fresh.isStale, false);
});
