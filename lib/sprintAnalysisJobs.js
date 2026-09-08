const jobs = new Map();
const MAX_JOBS = 100;
const MAX_AGE_MS = 60 * 60 * 1000;

function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_JOBS && now - job.updatedAt < MAX_AGE_MS) continue;
    jobs.delete(id);
  }
}

function safeError(error) {
  return {
    message: error?.status ? error.message : 'A análise falhou antes de gerar resultado. Verifique a configuração e tente novamente.',
    status: error?.status || 500,
  };
}

export function startSprintAnalysisJob({ scope, context, actor, work }) {
  pruneJobs();
  const id = crypto.randomUUID();
  const now = Date.now();
  const job = {
    id,
    scope,
    context,
    actor,
    status: 'running',
    message: 'Análise iniciada. Coletando dados do Jira e validando regras.',
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  Promise.resolve()
    .then(async () => {
      const result = await work();
      Object.assign(job, {
        status: 'completed',
        message: 'Análise concluída.',
        result,
        updatedAt: Date.now(),
      });
    })
    .catch(error => {
      Object.assign(job, {
        status: 'failed',
        message: safeError(error).message,
        error: safeError(error),
        updatedAt: Date.now(),
      });
    });
  return job;
}

export function getSprintAnalysisJob(id, { scope, actor, context } = {}) {
  pruneJobs();
  const job = jobs.get(String(id || ''));
  if (!job) return null;
  if (scope && job.scope !== scope) return null;
  if (actor && job.actor !== actor) return null;
  if (context) {
    for (const key of ['projectKey', 'boardId', 'sprintId']) {
      if (context[key] != null && String(job.context?.[key]) !== String(context[key])) return null;
    }
  }
  return job;
}

export function publicSprintAnalysisJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    context: job.context,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}
