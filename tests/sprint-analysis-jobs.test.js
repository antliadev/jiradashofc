import test from 'node:test';
import assert from 'node:assert/strict';
import { getSprintAnalysisJob, publicSprintAnalysisJob, startSprintAnalysisJob } from '../lib/sprintAnalysisJobs.js';

test('analysis job continua fora da requisicao e preserva status por contexto', async () => {
  const context = { projectKey: 'DEV', boardId: '10', sprintId: '5' };
  const job = startSprintAnalysisJob({
    scope: 'sprint-plan',
    context,
    actor: 'user-1',
    work: async () => ({ sourceId: 'source-1', plan: { metrics: { planned: 1 } } }),
  });
  assert.equal(publicSprintAnalysisJob(job).status, 'running');
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 20; i++) {
      const current = getSprintAnalysisJob(job.id, { scope: 'sprint-plan', actor: 'user-1', context });
      if (current?.status === 'completed') return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('job did not complete');
  });
  const completed = getSprintAnalysisJob(job.id, { scope: 'sprint-plan', actor: 'user-1', context });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.plan.metrics.planned, 1);
  assert.equal(getSprintAnalysisJob(job.id, { scope: 'sprint-review', actor: 'user-1', context }), null);
  assert.equal(getSprintAnalysisJob(job.id, { scope: 'sprint-plan', actor: 'other', context }), null);
});

test('analysis job falha com mensagem segura e rastreavel', async () => {
  const job = startSprintAnalysisJob({
    scope: 'sprint-review',
    context: { projectKey: 'DEV', boardId: '10', sprintId: '4' },
    actor: 'user-1',
    work: async () => { throw Object.assign(new Error('Selecione uma sprint encerrada.'), { status: 400 }); },
  });
  for (let i = 0; i < 20 && job.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const payload = publicSprintAnalysisJob(job);
  assert.equal(payload.status, 'failed');
  assert.equal(payload.error.status, 400);
  assert.match(payload.message, /sprint encerrada/i);
});
