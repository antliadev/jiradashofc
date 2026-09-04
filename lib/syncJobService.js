/**
 * syncJobService.js - Background jobs for Jira import.
 *
 * Credentials are accepted for a single sync run only. When Supabase is
 * available, the API token is encrypted temporarily so a backend worker can
 * finish or recover the job without depending on the browser tab.
 */
import crypto from 'crypto';
import { isConfigured, supabase, checkSupabaseConfig, supabaseKeyIsPrivileged } from './supabaseServer.js';
import { encrypt, decrypt } from './encryption.js';
import { fetchAllIssuesFromJira, upsertIssuesToDatabase, validateJiraPreflight } from './jiraService.js';
import { syncTrackedProjectWorklogs } from './jiraWorklogService.js';
import { validationSyncJob } from './validationDataService.js';

const JOB_TABLE = 'jira_sync_jobs';
const ACTIVE_STATUSES = ['queued', 'running'];
const ACTIVE_JOB_STALE_MS = 10 * 60 * 1000;
const DEFAULT_JQL = 'project is not EMPTY ORDER BY updated DESC';
const ENV_JQL = process.env.JIRA_JQL?.trim() || '';
const memoryJobs = new Map();
const PRIORITY_LABELS = {
  highest: ['Highest', 'Critica', 'Crítica'],
  high: ['High', 'Alta'],
  medium: ['Medium', 'Media', 'Média'],
  low: ['Low', 'Baixa'],
  lowest: ['Lowest', 'Muito baixa']
};
const TYPE_LABELS = {
  epic: ['Epic', 'Epico', 'Épico'],
  story: ['Story', 'Historia', 'História'],
  task: ['Task', 'Tarefa'],
  bug: ['Bug'],
  subtask: ['Sub-task', 'Subtask', 'Subtarefa']
};
const HOURS_PROJECT_JQL = {
  CRAWFORD: 'project = "CRAWFORD"',
  DOCW: '(project = "DOCW" OR (project = "P1" AND text ~ "Docwise"))'
};

/**
 * Read Jira credentials from environment variables.
 * Returns null if any required variable is missing.
 */
function readCredentialsFromEnv() {
  const baseUrl = process.env.JIRA_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();

  if (!baseUrl || !email || !token) return null;

  return {
    baseUrl,
    email,
    token,
    jql: ENV_JQL || DEFAULT_JQL
  };
}

function nowIso() {
  return new Date().toISOString();
}

function expiresIso() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}

function maskEmail(email = '') {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function cleanError(error) {
  const message = error?.message || String(error || 'Erro desconhecido');
  return message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic [redacted]').slice(0, 600);
}

function canPersistJobCredentials() {
  return supabaseKeyIsPrivileged;
}

function assertDatabaseReady() {
  const config = checkSupabaseConfig();
  if (!config.configured || !supabase) {
    throw new Error(config.error || 'Supabase nao configurado. A sincronizacao precisa do banco para persistir os tickets.');
  }
}

function normalizeCredentials({ baseUrl, email, token, jql }) {
  const cleanBaseUrl = (baseUrl || '').trim().toLowerCase().replace(/\/$/, '');
  const cleanEmail = (email || '').trim();
  const cleanToken = (token || '').trim();
  const effectiveJql = (jql || '').trim() || DEFAULT_JQL;

  if (!cleanBaseUrl) throw new Error('Base URL do Jira e obrigatoria.');
  if (!cleanEmail) throw new Error('E-mail do Jira e obrigatorio.');
  if (!cleanToken) throw new Error('API Token do Jira e obrigatorio.');
  if (!cleanEmail.includes('@')) throw new Error('E-mail do Jira invalido.');
  if (!cleanBaseUrl.startsWith('https://')) {
    throw new Error('Base URL deve comecar com https://.');
  }

  return { baseUrl: cleanBaseUrl, email: cleanEmail, token: cleanToken, jql: effectiveJql };
}

function arrayValues(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function quoteJql(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stripOrderBy(jql = '') {
  return String(jql).replace(/\s+ORDER\s+BY[\s\S]*$/i, '').trim();
}

function listClause(field, values) {
  const clean = [...new Set(arrayValues(values))];
  if (!clean.length) return '';
  return `${field} in (${clean.map(quoteJql).join(',')})`;
}

function singleOrListClause(field, valueOrValues) {
  const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
  return listClause(field, values);
}

function priorityValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => PRIORITY_LABELS[item] || item).filter(Boolean);
}

function typeValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => TYPE_LABELS[item] || item).filter(Boolean);
}

function textSearchClause(search) {
  const clean = String(search || '').trim().replace(/[~"'\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
  if (!clean || clean.length < 2) return '';
  return `(summary ~ ${quoteJql(clean)} OR description ~ ${quoteJql(clean)} OR text ~ ${quoteJql(clean)})`;
}

function hoursProjectClause(projectKey) {
  if (!projectKey) return '';
  const normalized = String(projectKey).trim().toUpperCase();
  const clause = HOURS_PROJECT_JQL[normalized];
  if (!clause) throw new Error('Projeto de horas invalido para sincronizacao filtrada.');
  return clause;
}

export function buildScopedJql(scope = {}, baseJql = ENV_JQL || DEFAULT_JQL) {
  const cleanBase = stripOrderBy(String(baseJql || DEFAULT_JQL).trim()) || 'project is not EMPTY';
  const clauses = [];
  const issueKeyClause = listClause('issuekey', scope.issueKeys || scope.keys);

  clauses.push(hoursProjectClause(scope.hoursProjectKey));
  clauses.push(listClause('project', scope.projectKeys || scope.projects));
  clauses.push(singleOrListClause('assignee', scope.assigneeIds));
  clauses.push(singleOrListClause('status', scope.statuses || scope.status));
  clauses.push(singleOrListClause('priority', priorityValues(scope.priorities || scope.priority)));
  clauses.push(singleOrListClause('issuetype', typeValues(scope.types || scope.type)));

  if (scope.dueDateTo) clauses.push(`duedate <= ${quoteJql(scope.dueDateTo)}`);
  if (scope.dueDateFrom) clauses.push(`duedate >= ${quoteJql(scope.dueDateFrom)}`);
  if (scope.noDueDate) clauses.push('duedate is EMPTY');
  if (scope.noAssignee) clauses.push('assignee is EMPTY');

  const stateClauses = [];
  if (scope.overdue) stateClauses.push('(duedate < now() AND statusCategory != "Done")');
  if (scope.blocked) stateClauses.push('(statusCategory = "In Progress" AND status in ("Bloqueado","Blocked"))');
  if (stateClauses.length && issueKeyClause) {
    clauses.push(`(${stateClauses.join(' OR ')} OR ${issueKeyClause})`);
  } else {
    clauses.push(...stateClauses);
    clauses.push(issueKeyClause);
  }

  clauses.push(textSearchClause(scope.search));

  const activeClauses = clauses.filter(Boolean);
  if (!activeClauses.length) return `${cleanBase} ORDER BY updated DESC`;

  return `(${cleanBase}) AND ${activeClauses.map(clause => `(${clause})`).join(' AND ')} ORDER BY updated DESC`;
}

function toPublicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    baseUrl: job.base_url || job.baseUrl,
    emailMasked: job.email_masked || job.emailMasked,
    totalIssues: job.total_issues ?? job.totalIssues ?? 0,
    inserted: job.inserted_count ?? job.inserted ?? 0,
    updated: job.updated_count ?? job.updated ?? 0,
    error: job.error_message || job.error || null,
    logs: job.logs || [],
    startedAt: job.started_at || job.startedAt || null,
    finishedAt: job.finished_at || job.finishedAt || null,
    createdAt: job.created_at || job.createdAt || null,
    updatedAt: job.updated_at || job.updatedAt || null
  };
}

function getJobTimestamp(job, keys) {
  for (const key of keys) {
    const value = job?.[key];
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function isActiveJobTimedOut(job) {
  if (!job || !ACTIVE_STATUSES.includes(job.status)) return false;

  const expiresAt = getJobTimestamp(job, ['expires_at', 'expiresAt']);
  if (expiresAt && expiresAt <= Date.now()) return true;

  const lastActivityAt = getJobTimestamp(job, ['updated_at', 'updatedAt', 'started_at', 'startedAt', 'created_at', 'createdAt']);
  return !!lastActivityAt && Date.now() - lastActivityAt > ACTIVE_JOB_STALE_MS;
}

async function finalizeTimedOutJob(job) {
  if (!job?.id) return job;

  const message = 'Sincronizacao interrompida por timeout do backend. Inicie uma nova sincronizacao.';
  const finishedAt = nowIso();
  const logs = [
    ...(Array.isArray(job.logs) ? job.logs : []),
    { at: finishedAt, message }
  ].slice(-80);

  await patchJob(job.id, {
    status: 'error',
    error: message,
    logs,
    finishedAt,
    tokenEncrypted: null,
    emailEncrypted: null
  });

  return {
    ...job,
    status: 'error',
    error_message: message,
    error: message,
    logs,
    finished_at: finishedAt,
    finishedAt
  };
}

function getMemoryLatestJob() {
  return [...memoryJobs.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function getMemoryActiveJob() {
  return [...memoryJobs.values()]
    .find(job => ACTIVE_STATUSES.includes(job.status)) || null;
}

async function getSupabaseLatestJob() {
  if (!isConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from(JOB_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[sync-job] Nao foi possivel buscar ultimo job:', error.message);
    return null;
  }

  return data || null;
}

async function getSupabaseJob(jobId) {
  if (!isConfigured || !supabase || !jobId) return null;

  const { data, error } = await supabase
    .from(JOB_TABLE)
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    console.warn('[sync-job] Nao foi possivel buscar job:', error.message);
    return null;
  }

  return data || null;
}

async function getSupabaseActiveJob() {
  if (!isConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from(JOB_TABLE)
    .select('*')
    .in('status', ACTIVE_STATUSES)
    .gt('expires_at', nowIso())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[sync-job] Nao foi possivel buscar job ativo:', error.message);
    return null;
  }

  return data || null;
}

async function patchSupabaseJob(jobId, patch) {
  if (!isConfigured || !supabase) return false;

  const { error } = await supabase
    .from(JOB_TABLE)
    .update({ ...patch, updated_at: nowIso() })
    .eq('id', jobId);

  if (error) {
    console.warn('[sync-job] Falha ao atualizar job:', error.message);
    return false;
  }

  return true;
}

function patchMemoryJob(jobId, patch) {
  const job = memoryJobs.get(jobId);
  if (!job) return false;
  const next = { ...job, ...patch, updatedAt: nowIso() };
  if (next.status === 'success' || next.status === 'error') {
    delete next.credentials;
  }
  memoryJobs.set(jobId, next);
  return true;
}

async function patchJob(jobId, patch) {
  const dbPatch = {};
  if ('status' in patch) dbPatch.status = patch.status;
  if ('totalIssues' in patch) dbPatch.total_issues = patch.totalIssues;
  if ('inserted' in patch) dbPatch.inserted_count = patch.inserted;
  if ('updated' in patch) dbPatch.updated_count = patch.updated;
  if ('error' in patch) dbPatch.error_message = patch.error;
  if ('logs' in patch) dbPatch.logs = patch.logs;
  if ('startedAt' in patch) dbPatch.started_at = patch.startedAt;
  if ('finishedAt' in patch) dbPatch.finished_at = patch.finishedAt;
  if ('tokenEncrypted' in patch) dbPatch.api_token_encrypted = patch.tokenEncrypted;
  if ('emailEncrypted' in patch) dbPatch.email_encrypted = patch.emailEncrypted;

  const dbUpdated = Object.keys(dbPatch).length
    ? await patchSupabaseJob(jobId, dbPatch)
    : false;
  const memoryUpdated = patchMemoryJob(jobId, patch);
  return dbUpdated || memoryUpdated;
}

async function readJob(jobId) {
  const dbJob = await getSupabaseJob(jobId);
  const memoryJob = memoryJobs.get(jobId) || null;
  if (dbJob) return memoryJob ? { ...dbJob, ...memoryJob } : dbJob;
  return memoryJob;
}

async function appendLog(jobId, message) {
  const publicMessage = String(message).slice(0, 400);
  const job = await readJob(jobId);
  const currentLogs = Array.isArray(job?.logs) ? job.logs : [];
  const logs = [
    ...currentLogs,
    { at: nowIso(), message: publicMessage }
  ].slice(-80);

  await patchJob(jobId, { logs });
  console.log(`[sync-job:${jobId}] ${publicMessage}`);
}

export async function getSyncJobStatus(jobId = null) {
  let job = jobId
    ? await readJob(jobId)
    : (await getSupabaseLatestJob()) || getMemoryLatestJob();

  if (isActiveJobTimedOut(job)) {
    job = await finalizeTimedOutJob(job);
  }

  return toPublicJob(job);
}

export async function createSyncJob(input = {}, sessionId = null, options = {}) {
  assertDatabaseReady();

  // Determine credentials: prefer input body, fall back to env vars
  const hasInputCredentials = !!(input.token || input.email || input.baseUrl);
  let credentials;
  if (hasInputCredentials) {
    credentials = normalizeCredentials(input);
  } else {
    const envCredentials = readCredentialsFromEnv();
    if (envCredentials) {
      credentials = envCredentials;
    } else {
      throw new Error(
        'Credenciais do Jira nao configuradas. ' +
        'Defina JIRA_BASE_URL, JIRA_EMAIL e JIRA_API_TOKEN nas variaveis de ambiente do servidor.'
      );
    }
  }

  let active = (await getSupabaseActiveJob()) || getMemoryActiveJob();
  if (isActiveJobTimedOut(active)) {
    await finalizeTimedOutJob(active);
    active = null;
  }

  if (active) {
    const publicJob = toPublicJob(active);
    const error = new Error('Ja existe uma sincronizacao em andamento.');
    error.code = 'SYNC_ALREADY_RUNNING';
    error.job = publicJob;
    throw error;
  }

  const syncScope = options.scope || input.scope || null;
  if (syncScope) {
    credentials = {
      ...credentials,
      jql: buildScopedJql(syncScope, credentials.jql)
    };
  }

  await validateJiraPreflight(credentials.baseUrl, credentials.email, credentials.token, credentials.jql);

  const id = crypto.randomUUID();
  const baseJob = {
    id,
    status: 'queued',
    baseUrl: credentials.baseUrl,
    emailMasked: maskEmail(credentials.email),
    totalIssues: 0,
    inserted: 0,
    updated: 0,
    error: null,
    logs: [{ at: nowIso(), message: 'Sincronizacao enfileirada no backend.' }],
    startedAt: null,
    finishedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: expiresIso(),
    credentials,
    scope: syncScope,
    pruneObsolete: !syncScope
  };

  let storedInDatabase = false;
  if (isConfigured && supabase) {
    const shouldPersistCredentials = canPersistJobCredentials();
    const { error } = await supabase.from(JOB_TABLE).insert({
      id,
      status: 'queued',
      base_url: credentials.baseUrl,
      email_masked: maskEmail(credentials.email),
      email_encrypted: shouldPersistCredentials ? encrypt(credentials.email) : null,
      api_token_encrypted: shouldPersistCredentials ? encrypt(credentials.token) : null,
      jql: credentials.jql,
      logs: baseJob.logs,
      expires_at: baseJob.expiresAt,
      created_by_session: sessionId || null
    });

    if (error) {
      throw new Error(`Nao foi possivel criar o job de sincronizacao. Verifique a migracao jira_sync_jobs. Detalhe: ${error.message}`);
    }
    storedInDatabase = true;
  }

  memoryJobs.set(id, baseJob);

  return {
    job: toPublicJob(baseJob),
    credentials,
    scope: syncScope,
    durable: storedInDatabase,
    credentialsPersisted: storedInDatabase && canPersistJobCredentials()
  };
}

/**
 * createSyncJobFromEnv - Cria um job de sincronizacao usando apenas
 * variaveis de ambiente (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).
 * Ideal para o novo fluxo stateless (frontend sem formulario de credenciais).
 */
export async function createSyncJobFromEnv(sessionId = null) {
  return createSyncJob({}, sessionId);
}

export async function createScopedSyncJobFromEnv(scope = {}, sessionId = null) {
  return createSyncJob({}, sessionId, { scope });
}

async function resolveCredentials(jobId, credentials) {
  if (credentials?.token) return credentials;

  const job = await getSupabaseJob(jobId);
  if (!job?.api_token_encrypted) {
    // Fallback: tentar ler de env vars (jobs criados sem persistencia)
    const envCredentials = readCredentialsFromEnv();
    if (envCredentials) {
      return envCredentials;
    }
    throw new Error('Credenciais temporarias nao estao mais disponiveis para este job. ' +
      'Se as credenciais estao configuradas via env vars, verifique JIRA_BASE_URL, JIRA_EMAIL e JIRA_API_TOKEN.');
  }

  return {
    baseUrl: job.base_url,
    email: decrypt(job.email_encrypted),
    token: decrypt(job.api_token_encrypted),
    jql: job.jql || DEFAULT_JQL
  };
}

export async function runSyncJob(jobId, credentials = null) {
  const startedAt = nowIso();

  try {
    const current = await readJob(jobId);
    if (!current) throw new Error('Job de sincronizacao nao encontrado.');
    if (current.status === 'success' || current.status === 'error') return toPublicJob(current);

    const resolved = await resolveCredentials(jobId, credentials || current.credentials);
    const safeCredentials = normalizeCredentials(resolved);

    await patchJob(jobId, { status: 'running', startedAt, error: null });
    await appendLog(jobId, 'Processamento iniciado no backend.');
    await appendLog(jobId, `Buscando tickets no Jira em ${safeCredentials.baseUrl}.`);
    await appendLog(jobId, `Filtro Jira usado: ${safeCredentials.jql || 'todos os tickets visiveis'}.`);

    const rawIssues = await fetchAllIssuesFromJira(
      safeCredentials.baseUrl,
      safeCredentials.email,
      safeCredentials.token,
      safeCredentials.jql,
      {
        onProgress: (message) => appendLog(jobId, message)
      }
    );

    await appendLog(jobId, `${rawIssues.length} tickets recebidos do Jira.`);
    if (rawIssues.length === 0) {
      throw new Error('Filtro Jira retornou 0 tickets. A sincronizacao nao foi concluida para evitar sucesso falso; verifique filtro, permissao do usuario e credenciais informadas.');
    }

    await appendLog(jobId, 'Salvando tickets no Supabase.');
    const isScopedSync = Boolean(current.scope || current.pruneObsolete === false);
    const dbResult = await upsertIssuesToDatabase(rawIssues, {
      baseUrl: safeCredentials.baseUrl,
      pruneObsolete: !isScopedSync,
      onProgress: (message) => appendLog(jobId, message)
    });

    await appendLog(jobId, 'Sincronizando apontamentos de horas dos projetos Crawford e Docwise.');
    try {
      const worklogResult = await syncTrackedProjectWorklogs(rawIssues, safeCredentials, {
        onProgress: (message) => appendLog(jobId, message)
      });
      await appendLog(
        jobId,
        `${worklogResult.worklogs} worklogs Crawford/Docwise sincronizados em ${worklogResult.issues} tickets.`
      );
    } catch (worklogError) {
      // Compatibilidade de rollout: uma migration ainda nao aplicada nao pode
      // invalidar o sync global de tickets que ja foi persistido com sucesso.
      await appendLog(jobId, `Aviso: tickets salvos, mas os worklogs Crawford/Docwise nao foram atualizados: ${cleanError(worklogError)}`);
    }

    await patchJob(jobId, {
      status: 'success',
      totalIssues: dbResult.total,
      inserted: dbResult.inserted,
      updated: dbResult.updated,
      finishedAt: nowIso(),
      tokenEncrypted: null,
      emailEncrypted: null
    });
    await appendLog(jobId, 'Sincronizacao concluida com sucesso.');

    if (!isScopedSync) {
      try {
        const { captureActiveReviewBaselines } = await import('./sprintReviewBaseline.js');
        const count = await captureActiveReviewBaselines(rawIssues, safeCredentials);
        if (count) await appendLog(jobId, `${count} baselines de Sprint Review registrados.`);
      } catch {
        await appendLog(jobId, 'Aviso: baseline automatico da Sprint Review nao capturado. O modulo continua com reconstrucao historica no fechamento.');
      }
    }

    return await getSyncJobStatus(jobId);
  } catch (error) {
    const message = cleanError(error);
    await patchJob(jobId, {
      status: 'error',
      error: message,
      finishedAt: nowIso(),
      tokenEncrypted: null,
      emailEncrypted: null
    });
    await appendLog(jobId, `Erro tratado: ${message}`);
    return await getSyncJobStatus(jobId);
  }
}

export async function runQueuedSyncJobs(limit = 1) {
  if (!isConfigured || !supabase) {
    return { processed: 0, message: 'Supabase nao configurado.' };
  }

  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(JOB_TABLE)
    .select('*')
    .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleCutoff})`)
    .gt('expires_at', nowIso())
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Erro ao buscar jobs pendentes: ${error.message}`);
  }

  for (const job of data || []) {
    await runSyncJob(job.id);
  }

  return { processed: (data || []).length };
}

/**
 * A cadencia fica a cargo do agendador externo, que pode atrasar alguns minutos.
 */
export function isWithinAutoSyncSchedule(date = new Date()) {
  try {
    const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
    return Number.isFinite(time);
  } catch {
    return false;
  }
}

/**
 * Executa a sincronizacao automatica de background (Cron / Scheduler).
 * Se houver jobs em fila, processa-os. Caso contrario, cria um novo job
 * com as credenciais configuradas nas variaveis de ambiente e executa o sync.
 */
export async function executeAutoSync(source = 'cron', { forceScheduleCheck = false } = {}) {
  const validationJob = validationSyncJob();
  if (validationJob) {
    return {
      success: true,
      skipped: true,
      validationMode: true,
      jobId: validationJob.id,
      status: validationJob.status,
      totalIssues: validationJob.totalIssues,
      source,
      reason: 'Dados de validacao ativos no develop porque o Supabase nao esta configurado.'
    };
  }

  if (forceScheduleCheck && !isWithinAutoSyncSchedule()) {
    return {
      success: true,
      skipped: true,
      reason: 'Data invalida para sincronizacao automatica.'
    };
  }

  // 1. Processa jobs pendentes na fila se houver
  try {
    const queuedResult = await runQueuedSyncJobs(1);
    if (queuedResult.processed > 0) {
      return {
        success: true,
        source,
        processedQueued: queuedResult.processed
      };
    }
  } catch (err) {
    console.warn('[sync-service] Falha ao processar jobs na fila:', err.message);
  }

  // 2. Verifica se ja ha job ativo
  let active = (await getSupabaseActiveJob()) || getMemoryActiveJob();
  if (isActiveJobTimedOut(active)) {
    await finalizeTimedOutJob(active);
    active = null;
  }

  if (active) {
    return {
      success: true,
      alreadyRunning: true,
      jobId: active.id,
      status: active.status,
      message: 'Sincronizacao ja em andamento.'
    };
  }

  // 3. Cria novo job usando credenciais de ambiente
  const { job, credentials } = await createSyncJobFromEnv(`auto-sync-${source}`);

  // 4. Executa a sincronizacao
  const result = await runSyncJob(job.id, credentials);
  return {
    success: result?.status === 'success',
    jobId: job.id,
    status: result?.status,
    totalIssues: result?.totalIssues,
    error: result?.error,
    source
  };
}
