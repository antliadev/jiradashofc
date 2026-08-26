/**
 * jiraService.js — Integração Jira + Supabase
 *
 * Fluxo:
 *  1) sync → busca do Jira → upsert no Supabase (por issue_id)
 *  2) dashboard/issues/etc → lê do Supabase (nunca do Jira diretamente)
 */
import { supabase, isConfigured, checkSupabaseConfig } from './supabaseServer.js';
import NodeCache from 'node-cache';

const dashboardCache = new NodeCache({ stdTTL: 30, checkperiod: 60, useClones: false });
const DASHBOARD_CACHE_KEY = 'jira-dashboard:v2';

const JIRA_FIELDS = [
  'summary', 'description', 'status', 'statuscategorychangedate', 'assignee', 'reporter', 'creator',
  'project', 'issuetype', 'priority', 'created', 'updated',
  'resolutiondate', 'duedate', 'labels', 'components', 'fixVersions', 'parent',
  'timetracking', 'comment',
  'customfield_10015',
  'customfield_10016',
  'customfield_10020',
  'customfield_11275',
  'customfield_11377',
  'customfield_11376',
  'customfield_10046'
];

const JIRA_CREDENTIAL_ERROR = 'Credencial Jira inválida ou sem permissão. Verifique JIRA_EMAIL e JIRA_API_TOKEN.';
const DETAIL_BATCH_SIZE = 500;

const OPTIONAL_ISSUE_COLUMNS = [
  'start_date',
  'planned_start_date',
  'planned_end_date',
  'jira_url',
  'raw_fields',
  'comment_count',
  'human_comment_count',
  'automation_comment_count',
  'last_comment_at',
  'last_comment_author_id',
  'last_comment_author_name',
  'last_human_comment_at',
  'last_human_comment_author_id',
  'last_human_comment_author_name',
  'changelog_count',
  'assignee_history',
  'status_history',
  'blocked_reason',
  'blocked_action_taken',
  'blocked_pending_with',
  'integration_warnings',
  'raw_changelog'
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeAuthHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function firstValidDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return null;
}

function getSprintDates(sprintField) {
  const sprints = Array.isArray(sprintField) ? sprintField : [];
  const selected = sprints.find(s => s?.state === 'active') || sprints[sprints.length - 1] || null;
  return {
    start: firstValidDate(selected?.startDate),
    end: firstValidDate(selected?.endDate, selected?.completeDate)
  };
}

function parseEnvList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function configuredJiraFields() {
  const customFields = [
    ...parseEnvList('JIRA_EXTRA_FIELDS'),
    process.env.JIRA_BLOCK_REASON_FIELD,
    process.env.JIRA_BLOCK_ACTION_FIELD,
    process.env.JIRA_BLOCK_PENDING_FIELD
  ].filter(Boolean);

  return [...new Set([...JIRA_FIELDS, ...customFields])];
}

function normalizeTextKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function adfToText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(adfToText).filter(Boolean).join(' ').trim();
  if (typeof value !== 'object') return String(value || '').trim();
  const ownText = typeof value.text === 'string' ? value.text : '';
  const children = Array.isArray(value.content) ? value.content.map(adfToText).filter(Boolean).join(' ') : '';
  return [ownText, children].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function cleanJiraFieldValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim() || null;
  if (Array.isArray(value)) return value.map(cleanJiraFieldValue).filter(Boolean).join(', ') || null;
  if (typeof value === 'object') {
    return value.displayName || value.name || value.value || value.text || adfToText(value) || null;
  }
  return null;
}

function getConfiguredFieldValue(fields, envName) {
  const keys = parseEnvList(envName);
  for (const key of keys) {
    const value = fields?.[key];
    const cleaned = cleanJiraFieldValue(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function sanitizeRawFields(fields = {}) {
  const { comment: _comment, ...rest } = fields || {};
  return rest;
}

function getUserSnapshot(user = {}) {
  return {
    accountId: user.accountId || user.account_id || null,
    displayName: user.displayName || user.name || null,
    emailAddress: user.emailAddress || user.email || null,
    accountType: user.accountType || null
  };
}

function isAutomationAuthor(user = {}) {
  const accountType = normalizeTextKey(user.accountType);
  const displayName = normalizeTextKey(user.displayName || user.name);
  const email = normalizeTextKey(user.emailAddress || user.email);
  return accountType === 'app'
    || displayName.includes('automation')
    || displayName.includes('automacao')
    || displayName.includes('jira')
    || displayName.includes('bot')
    || email.includes('automation')
    || email.includes('automacao')
    || email.includes('bot');
}

function extractComments(raw) {
  const commentsField = raw.fields?.comment;
  const comments = Array.isArray(commentsField?.comments) ? commentsField.comments : [];
  return comments.map(comment => {
    const author = getUserSnapshot(comment.author || {});
    return {
      commentId: comment.id || null,
      author,
      bodyText: adfToText(comment.body),
      createdAt: comment.created || null,
      updatedAt: comment.updated || comment.created || null,
      isAutomation: isAutomationAuthor(comment.author || {})
    };
  });
}

function extractChangelogItems(raw) {
  const histories = Array.isArray(raw.changelog?.histories) ? raw.changelog.histories : [];
  const rows = [];
  histories.forEach(history => {
    const author = getUserSnapshot(history.author || {});
    const items = Array.isArray(history.items) ? history.items : [];
    items.forEach((item, index) => {
      rows.push({
        historyId: history.id || null,
        itemIndex: index,
        author,
        field: item.field || null,
        fieldId: item.fieldId || null,
        fieldType: item.fieldtype || item.fieldType || null,
        fromValue: item.from || null,
        fromDisplay: item.fromString || null,
        toValue: item.to || null,
        toDisplay: item.toString || null,
        createdAt: history.created || null
      });
    });
  });
  return rows;
}

function buildHistorySummary(items, wantedField) {
  const wanted = normalizeTextKey(wantedField);
  return items
    .filter(item => normalizeTextKey(item.field) === wanted || normalizeTextKey(item.fieldId) === wanted)
    .map(item => ({
      at: item.createdAt,
      author: item.author.displayName,
      from: item.fromDisplay || item.fromValue,
      to: item.toDisplay || item.toValue
    }))
    .filter(item => item.at || item.from || item.to);
}

function buildIntegrationSummary(raw) {
  const comments = extractComments(raw);
  const changelogItems = extractChangelogItems(raw);
  const humanComments = comments.filter(comment => !comment.isAutomation);
  const automationComments = comments.filter(comment => comment.isAutomation);
  const lastComment = comments
    .filter(comment => comment.updatedAt || comment.createdAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
  const lastHumanComment = humanComments
    .filter(comment => comment.updatedAt || comment.createdAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
  const warnings = [];
  const commentTotal = Number(raw.fields?.comment?.total || comments.length || 0);

  if (commentTotal > comments.length) {
    warnings.push({
      code: 'COMMENTS_PARTIAL',
      message: `Jira informou ${commentTotal} comentarios, mas a pagina trouxe ${comments.length}.`
    });
  }

  return {
    comments,
    changelogItems,
    commentTotal,
    humanCommentCount: humanComments.length,
    automationCommentCount: automationComments.length,
    lastComment,
    lastHumanComment,
    assigneeHistory: buildHistorySummary(changelogItems, 'assignee'),
    statusHistory: buildHistorySummary(changelogItems, 'status'),
    warnings
  };
}

function normalizeIssue(raw, context = {}) {
  const f = raw.fields || {};
  const sprintDates = getSprintDates(f.customfield_10020);
  const dueDate = f.duedate || null;
  const plannedStartDate = firstValidDate(f.customfield_10015, sprintDates.start);
  const plannedEndDate = firstValidDate(dueDate, sprintDates.end);
  const baseUrl = (context.baseUrl || '').replace(/\/$/, '');
  const integration = buildIntegrationSummary(raw);

  return {
    issue_id:        raw.id,
    issue_key:       raw.key,
    title:           f.summary || '',
    status_id:       f.status?.id || null,
    status_name:     f.status?.name || 'Unknown',
    status_category: f.status?.statusCategory?.name || null,
    project_id:      f.project?.id || null,
    project_key:     f.project?.key || '',
    project_name:    f.project?.name || '',
    project_avatar:  f.project?.avatarUrls?.['48x48'] || null,
    type_id:         f.issuetype?.id || null,
    type_name:       f.issuetype?.name || 'Task',
    type_icon:       f.issuetype?.iconUrl || null,
    priority_id:     f.priority?.id || null,
    priority_name:   f.priority?.name || null,
    priority_icon:   f.priority?.iconUrl || null,
    assignee_id:     f.assignee?.accountId || null,
    assignee_name:   f.assignee?.displayName || null,
    assignee_avatar: f.assignee?.avatarUrls?.['48x48'] || null,
    assignee_email:  f.assignee?.emailAddress || null,
    reporter_id:     f.reporter?.accountId || null,
    reporter_name:   f.reporter?.displayName || null,
    reporter_avatar: f.reporter?.avatarUrls?.['48x48'] || null,
    creator_id:      f.creator?.accountId || null,
    creator_name:    f.creator?.displayName || null,
    creator_avatar:  f.creator?.avatarUrls?.['48x48'] || null,
    labels:          f.labels || [],
    components:      (f.components || []).map(c => ({ id: c.id, name: c.name })),
    fix_versions:    (f.fixVersions || []).map(v => ({ id: v.id, name: v.name })),
    parent_key:      f.parent?.key || null,
    parent_title:    f.parent?.fields?.summary || null,
    jira_created_at: f.created || null,
    jira_updated_at: f.updated || null,
    jira_resolved_at:f.resolutiondate || null,
    due_date:        dueDate,
    start_date:      plannedStartDate,
    planned_start_date: plannedStartDate,
    planned_end_date: plannedEndDate,
    jira_url:        baseUrl && raw.key ? `${baseUrl}/browse/${raw.key}` : null,
    raw_fields:      sanitizeRawFields(f),
    comment_count:   integration.commentTotal,
    human_comment_count: integration.humanCommentCount,
    automation_comment_count: integration.automationCommentCount,
    last_comment_at: integration.lastComment?.updatedAt || integration.lastComment?.createdAt || null,
    last_comment_author_id: integration.lastComment?.author?.accountId || null,
    last_comment_author_name: integration.lastComment?.author?.displayName || null,
    last_human_comment_at: integration.lastHumanComment?.updatedAt || integration.lastHumanComment?.createdAt || null,
    last_human_comment_author_id: integration.lastHumanComment?.author?.accountId || null,
    last_human_comment_author_name: integration.lastHumanComment?.author?.displayName || null,
    changelog_count: integration.changelogItems.length,
    assignee_history: integration.assigneeHistory,
    status_history: integration.statusHistory,
    blocked_reason: getConfiguredFieldValue(f, 'JIRA_BLOCK_REASON_FIELD'),
    blocked_action_taken: getConfiguredFieldValue(f, 'JIRA_BLOCK_ACTION_FIELD'),
    blocked_pending_with: getConfiguredFieldValue(f, 'JIRA_BLOCK_PENDING_FIELD'),
    integration_warnings: integration.warnings,
    story_points:    f.customfield_10016 || 0,
    synced_at:       new Date().toISOString()
  };
}

function stripOptionalIssueColumns(rows) {
  return rows.map(row => {
    const copy = { ...row };
    OPTIONAL_ISSUE_COLUMNS.forEach(column => delete copy[column]);
    return copy;
  });
}

// ─────────────────────────────────────────────
// Retry com backoff exponencial para rate limiting
// ─────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY = 1000; // 1 segundo
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/**
 * Executa uma função com retry automático em caso de erros temporários.
 * Implementa backoff exponencial para evitar sobrecarregar a API.
 */
async function fetchWithRetry(fn, options = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelay = DEFAULT_INITIAL_DELAY,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    retries = 0
  } = options;

  try {
    return await fn();
  } catch (error) {
    // Erros que justificam retry
    const retryableErrors = [
      429, // Rate limiting
      500, // Internal server error
      502, // Bad gateway
      503, // Service unavailable
      504  // Gateway timeout
    ];

    const status = error.status || (error.message?.match(/status (\d+)/)?.[1]);
    const isRetryable = retryableErrors.includes(parseInt(status));
    
    // Não retry para erros de autenticação
    const isAuthError = status === 401 || status === 403;

    if (!isRetryable || isAuthError || retries >= maxRetries) {
      throw error;
    }

    const delay = initialDelay * Math.pow(backoffMultiplier, retries);
    console.log(`[Jira] Retry ${retries + 1}/${maxRetries} após ${delay}ms...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(fn, { ...options, retries: retries + 1 });
  }
}

// ─────────────────────────────────────────────
// Jira API — busca com paginação
// ─────────────────────────────────────────────

function stripOrderBy(jql = '') {
  return String(jql).replace(/\s+ORDER\s+BY[\s\S]*$/i, '').trim();
}

function normalizeBaseUrl(baseUrl = '') {
  let cleanBaseUrl = String(baseUrl || '').trim().toLowerCase().replace(/\/$/, '');
  if (cleanBaseUrl && !cleanBaseUrl.startsWith('http')) cleanBaseUrl = `https://${cleanBaseUrl}`;
  return cleanBaseUrl;
}

function parseJiraJson(text, context) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Resposta invalida do Jira em ${context}: ${String(text || '').substring(0, 200)}`);
  }
}

function createCredentialError(detail = '') {
  const error = new Error(detail ? `${JIRA_CREDENTIAL_ERROR} ${detail}` : JIRA_CREDENTIAL_ERROR);
  error.code = 'JIRA_AUTH_INVALID';
  return error;
}

async function readJiraResponse(response, context) {
  const text = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw createCredentialError(`Jira retornou ${response.status}.`);
  }

  const json = parseJiraJson(text, context);

  if (!response.ok) {
    const detail = json?.errorMessages || json?.errors || json;
    if (response.status === 400 && context === 'search/approximate-count') {
      throw new Error(`JQL invalida (400): ${JSON.stringify(detail).substring(0, 200)}`);
    }
    throw new Error(`Erro Jira ${response.status} em ${context}: ${JSON.stringify(detail).substring(0, 240)}`);
  }

  return json;
}

export async function validateJiraPreflight(baseUrl, email, token, jql = 'project is not EMPTY ORDER BY updated DESC') {
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const cleanEmail = String(email || '').trim();
  const cleanToken = String(token || '').trim();

  if (!cleanBaseUrl || !cleanEmail || !cleanToken) {
    throw createCredentialError('Credenciais incompletas.');
  }

  const authHeader = makeAuthHeader(cleanEmail, cleanToken);

  const myselfRes = await fetch(`${cleanBaseUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const myself = await readJiraResponse(myselfRes, 'myself');

  const projectRes = await fetch(`${cleanBaseUrl}/rest/api/3/project/search?maxResults=1`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const projects = await readJiraResponse(projectRes, 'project/search');
  const projectTotal = Number(projects.total || 0);
  if (projectTotal <= 0) {
    throw createCredentialError('Usuario autenticado, mas sem projetos Jira visiveis.');
  }

  const countRes = await fetch(`${cleanBaseUrl}/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jql: stripOrderBy(jql) }),
    signal: AbortSignal.timeout(30000)
  });
  const countJson = await readJiraResponse(countRes, 'search/approximate-count');

  return {
    success: true,
    user: {
      accountId: myself.accountId,
      displayName: myself.displayName,
      emailAddress: myself.emailAddress
    },
    projectTotal,
    totalTickets: Number(countJson.count || 0)
  };
}

export async function countIssuesInJira(baseUrl, email, token, jql) {
  baseUrl = normalizeBaseUrl(baseUrl);

  const authHeader = makeAuthHeader(email, token);
  const response = await fetch(`${baseUrl}/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jql: stripOrderBy(jql) }),
    signal: AbortSignal.timeout(30000)
  });

  const json = await readJiraResponse(response, 'search/approximate-count');

  return Number(json.count || 0);
}

export async function fetchAllIssuesFromJira(baseUrl, email, token, jql, options = {}) {
  const { onProgress } = options;
  // Sanitização de segurança e robustez
  baseUrl = normalizeBaseUrl(baseUrl);

  const authHeader = makeAuthHeader(email, token);
  const allIssues = [];
  let nextPageToken = null;
  let page = 1;
  const MAX_PAGES = 50; // Limite de 5.000 tickets para evitar timeout na Vercel
  const preflight = await validateJiraPreflight(baseUrl, email, token, jql);
  const expectedCount = preflight.totalTickets;

  console.log('[Jira] Iniciando busca. JQL:', jql.substring(0, 80) + '...');
  await onProgress?.(`Jira informou ${expectedCount} tickets para o filtro.`);
  await onProgress?.('Busca paginada iniciada no Jira.');

  while (page <= MAX_PAGES) {
    const payload = {
      jql,
      maxResults: 100,
      fields: configuredJiraFields(),
      expand: 'changelog',
      ...(nextPageToken ? { nextPageToken } : {})
    };

    // Função de fetch envolvida para retry
    const fetchPage = async () => {
      const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      const text = await response.text();

      if (response.status === 401 || response.status === 403) {
        throw createCredentialError(`Jira retornou ${response.status}.`);
      }

      let json;
      try { json = JSON.parse(text); } catch {
        throw { status: 0, message: `Resposta inválida do Jira (pág ${page}): ${text.substring(0, 200)}` };
      }

      if (response.status === 400) throw { status: 400, message: `JQL inválida (400): ${JSON.stringify(json).substring(0, 200)}` };
      if (!response.ok) throw { status: response.status, message: `Erro Jira ${response.status}: ${JSON.stringify(json).substring(0, 200)}` };

      return { response, json };
    };

    // Executar com retry
    let result;
    try {
      result = await fetchWithRetry(fetchPage, { maxRetries: 3, initialDelay: 1000 });
    } catch (err) {
      throw new Error(err.message || 'Erro ao buscar dados do Jira', { cause: err });
    }

    const { json } = result;
    const issues = Array.isArray(json.issues) ? json.issues : [];
    allIssues.push(...issues);

    console.log(`[Jira] Pág ${page}: +${issues.length} issues (total: ${allIssues.length}) | isLast: ${json.isLast}`);
    await onProgress?.(`Pagina ${page}: ${issues.length} tickets recebidos, total ${allIssues.length}.`);

    if (json.isLast === true || !json.nextPageToken) break;
    nextPageToken = json.nextPageToken;
    page++;
  }

  console.log(`[Jira] Busca concluída. Total: ${allIssues.length} issues em ${page} páginas.`);
  await onProgress?.(`Busca concluida: ${allIssues.length} tickets em ${page} paginas.`);
  if (expectedCount > allIssues.length) {
    throw new Error(`Busca incompleta no Jira: filtro retornou ${expectedCount} tickets, mas apenas ${allIssues.length} foram recebidos antes de finalizar.`);
  }

  return allIssues;
}

// ─────────────────────────────────────────────
// Supabase — upsert em lotes
// ─────────────────────────────────────────────

export async function upsertIssuesToDatabase(rawIssues, options = {}) {
  const { onProgress } = options;
  if (!isConfigured || !supabase) {
    const config = checkSupabaseConfig();
    throw new Error(config.error || 'Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }

  const syncStartedAt = new Date().toISOString();
  const normalized = rawIssues.map(issue => normalizeIssue(issue, options));
  const BATCH = 100;
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);

    let { data, error } = await supabase
      .from('jira_issues')
      .upsert(batch, {
        onConflict: 'issue_id',   // chave única — nunca duplica
        ignoreDuplicates: false   // sempre atualiza campos
      })
      .select('issue_id, created_at, synced_at');

    if (error && isMissingColumnError(error)) {
      console.warn('[DB] Colunas opcionais ausentes. Execute as migracoes em sql/ antes da proxima sincronizacao.');
      const retry = await supabase
        .from('jira_issues')
        .upsert(stripOptionalIssueColumns(batch), {
          onConflict: 'issue_id',
          ignoreDuplicates: false
        })
        .select('issue_id, created_at, synced_at');
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Erro ao salvar issues no banco (lote ${i / BATCH + 1}): ${error.message}`);
    }

    // Conta inseridos vs atualizados pela diferença de timestamps
    data.forEach(row => {
      const createdMs = new Date(row.created_at).getTime();
      const syncedMs  = new Date(row.synced_at).getTime();
      const diffMs    = Math.abs(syncedMs - createdMs);
      if (diffMs < 5000) inserted++; else updated++;
    });

    console.log(`[DB] Lote ${i / BATCH + 1}: ${batch.length} issues processadas (acum: ${i + batch.length}/${normalized.length})`);
    await onProgress?.(`Lote ${i / BATCH + 1}: ${batch.length} tickets salvos (${i + batch.length}/${normalized.length}).`);
  }

  console.log(`[DB] Upsert concluído. Novos: ~${inserted} | Atualizados: ~${updated}`);
  let pruned = 0;
  const staleDelete = await supabase
    .from('jira_issues')
    .delete({ count: 'exact' })
    .lt('synced_at', syncStartedAt);

  if (staleDelete.error) {
    throw new Error(`Erro ao remover tickets obsoletos: ${staleDelete.error.message}`);
  }
  pruned += staleDelete.count || 0;

  const nullDelete = await supabase
    .from('jira_issues')
    .delete({ count: 'exact' })
    .is('synced_at', null);

  if (nullDelete.error) {
    throw new Error(`Erro ao remover tickets sem sync: ${nullDelete.error.message}`);
  }
  pruned += nullDelete.count || 0;

  if (pruned > 0) {
    await onProgress?.(`${pruned} tickets obsoletos removidos do Supabase.`);
  }

  const detailResult = await upsertIssueIntegrationDetails(rawIssues, { onProgress });

  console.log(`[DB] Tickets obsoletos removidos: ${pruned}`);
  clearJiraDashboardCache();
  return { total: normalized.length, inserted, updated, pruned, ...detailResult };
}

function issueCommentRows(rawIssues) {
  const syncedAt = new Date().toISOString();
  return rawIssues.flatMap(issue => extractComments(issue).map(comment => ({
    comment_id: comment.commentId || `${issue.id}:${comment.createdAt || comment.updatedAt || comment.bodyText.slice(0, 32)}`,
    issue_id: issue.id,
    issue_key: issue.key,
    author_account_id: comment.author.accountId,
    author_name: comment.author.displayName,
    author_email: comment.author.emailAddress,
    body_text: comment.bodyText,
    is_automation: comment.isAutomation,
    jira_created_at: comment.createdAt,
    jira_updated_at: comment.updatedAt,
    synced_at: syncedAt
  })));
}

function issueChangelogRows(rawIssues) {
  const syncedAt = new Date().toISOString();
  return rawIssues.flatMap(issue => extractChangelogItems(issue).map(item => ({
    history_item_id: `${issue.id}:${item.historyId || item.createdAt || 'history'}:${item.itemIndex}`,
    history_id: item.historyId,
    issue_id: issue.id,
    issue_key: issue.key,
    author_account_id: item.author.accountId,
    author_name: item.author.displayName,
    field_name: item.field,
    field_id: item.fieldId,
    field_type: item.fieldType,
    from_value: item.fromValue,
    from_display: item.fromDisplay,
    to_value: item.toValue,
    to_display: item.toDisplay,
    jira_created_at: item.createdAt,
    synced_at: syncedAt
  })));
}

async function replaceDetailRows(tableName, issueIds, rows, onProgress) {
  if (!issueIds.length) return { written: 0, available: true };

  for (let i = 0; i < issueIds.length; i += DETAIL_BATCH_SIZE) {
    const ids = issueIds.slice(i, i + DETAIL_BATCH_SIZE);
    const { error } = await supabase
      .from(tableName)
      .delete()
      .in('issue_id', ids);

    if (error) {
      if (isMissingTableError(error)) {
        console.warn(`[DB] Tabela opcional ${tableName} ausente. Execute sql/migration-jira-comments-changelog.sql.`);
        return { written: 0, available: false };
      }
      throw new Error(`Erro ao limpar ${tableName}: ${error.message}`);
    }
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += DETAIL_BATCH_SIZE) {
    const batch = rows.slice(i, i + DETAIL_BATCH_SIZE);
    if (!batch.length) continue;
    const { error } = await supabase
      .from(tableName)
      .upsert(batch, {
        onConflict: tableName === 'jira_issue_comments' ? 'comment_id' : 'history_item_id',
        ignoreDuplicates: false
      });

    if (error) {
      if (isMissingTableError(error)) {
        console.warn(`[DB] Tabela opcional ${tableName} ausente. Execute sql/migration-jira-comments-changelog.sql.`);
        return { written: 0, available: false };
      }
      throw new Error(`Erro ao salvar ${tableName}: ${error.message}`);
    }
    written += batch.length;
  }

  await onProgress?.(`${written} registros salvos em ${tableName}.`);
  return { written, available: true };
}

async function upsertIssueIntegrationDetails(rawIssues, options = {}) {
  const { onProgress } = options;
  const issueIds = [...new Set(rawIssues.map(issue => issue.id).filter(Boolean))];
  const comments = issueCommentRows(rawIssues);
  const changelog = issueChangelogRows(rawIssues);

  const commentsResult = await replaceDetailRows('jira_issue_comments', issueIds, comments, onProgress);
  const changelogResult = await replaceDetailRows('jira_issue_changelog', issueIds, changelog, onProgress);

  return {
    commentsSynced: commentsResult.written,
    changelogItemsSynced: changelogResult.written,
    detailsPersistence: commentsResult.available && changelogResult.available ? 'supabase' : 'jira_issues_summary_only'
  };
}

// ─────────────────────────────────────────────
// Supabase — leitura para dashboard/listagem
// ─────────────────────────────────────────────

const DASHBOARD_ISSUE_COLUMNS = [
  'id',
  'issue_id',
  'issue_key',
  'title',
  'project_id',
  'project_key',
  'project_name',
  'project_avatar',
  'status_id',
  'status_name',
  'status_category',
  'type_id',
  'type_name',
  'type_icon',
  'priority_id',
  'priority_name',
  'priority_icon',
  'assignee_id',
  'assignee_name',
  'assignee_email',
  'assignee_avatar',
  'reporter_id',
  'reporter_name',
  'reporter_avatar',
  'creator_id',
  'creator_name',
  'creator_avatar',
  'labels',
  'components',
  'fix_versions',
  'parent_key',
  'parent_title',
  'jira_created_at',
  'jira_updated_at',
  'jira_resolved_at',
  'due_date',
  'start_date',
  'planned_start_date',
  'planned_end_date',
  'jira_url',
  'story_points',
  'comment_count',
  'human_comment_count',
  'automation_comment_count',
  'last_comment_at',
  'last_comment_author_id',
  'last_comment_author_name',
  'last_human_comment_at',
  'last_human_comment_author_id',
  'last_human_comment_author_name',
  'changelog_count',
  'assignee_history',
  'status_history',
  'blocked_reason',
  'blocked_action_taken',
  'blocked_pending_with',
  'integration_warnings',
  'synced_at',
  'created_at'
].join(',');

const BASE_DASHBOARD_ISSUE_COLUMNS = DASHBOARD_ISSUE_COLUMNS
  .split(',')
  .filter(column => !OPTIONAL_ISSUE_COLUMNS.includes(column))
  .join(',');

function isMissingColumnError(error) {
  const message = error?.message || '';
  const code = error?.code || '';
  return code === '42703'
    || /column .* does not exist/i.test(message)
    || /Could not find .* column/i.test(message)
    || /schema cache/i.test(message);
}

function isMissingTableError(error) {
  const message = error?.message || '';
  const code = error?.code || '';
  return code === '42P01'
    || /relation .* does not exist/i.test(message)
    || /table .* does not exist/i.test(message)
    || /Could not find the table/i.test(message)
    || /schema cache/i.test(message);
}

export async function fetchIssuesFromDatabase(filters = {}) {
  if (!supabase) {
    const config = checkSupabaseConfig();
    throw new Error(config.error || 'Supabase nao configurado para leitura dos tickets.');
  }

  // O Supabase tem limite padrão de 1000 rows por query.
  // Paginamos internamente para garantir que TODOS os registros sejam retornados.
  const PAGE_SIZE = 1000;
  const allData = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('jira_issues')
      .select(DASHBOARD_ISSUE_COLUMNS)
      .range(from, from + PAGE_SIZE - 1);

    if (filters.project)  query = query.eq('project_key', filters.project);
    if (filters.status)   query = query.eq('status_name', filters.status);
    if (filters.assignee) query = query.eq('assignee_id', filters.assignee);
    if (filters.priority) query = query.eq('priority_name', filters.priority);
    if (filters.type)     query = query.eq('type_name', filters.type);

    query = query.order('jira_updated_at', { ascending: false });

    let { data, error } = await query;
    if (error && /column .* does not exist/i.test(error.message || '')) {
      query = supabase
        .from('jira_issues')
        .select(BASE_DASHBOARD_ISSUE_COLUMNS)
        .range(from, from + PAGE_SIZE - 1);
      if (filters.project)  query = query.eq('project_key', filters.project);
      if (filters.status)   query = query.eq('status_name', filters.status);
      if (filters.assignee) query = query.eq('assignee_id', filters.assignee);
      if (filters.priority) query = query.eq('priority_name', filters.priority);
      if (filters.type)     query = query.eq('type_name', filters.type);
      query = query.order('jira_updated_at', { ascending: false });
      const retry = await query;
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      throw new Error(`Erro ao ler issues no banco: ${error.message}`);
    }
    const rows = data || [];
    allData.push(...rows);

    // Se retornou menos que PAGE_SIZE, não há mais páginas
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`[DB] fetchIssuesFromDatabase: ${allData.length} issues carregadas em ${Math.ceil(allData.length / PAGE_SIZE)} páginas`);
  return allData;
}

function applyIssueFilters(query, filters = {}) {
  if (filters.project)  query = query.eq('project_key', filters.project);
  if (filters.status)   query = query.eq('status_name', filters.status);
  if (filters.assignee) query = query.eq('assignee_id', filters.assignee);
  if (filters.priority) query = query.eq('priority_name', filters.priority);
  if (filters.type)     query = query.eq('type_name', filters.type);
  return query;
}

export async function fetchIssuesPageFromDatabase(filters = {}, options = {}) {
  if (!supabase) {
    const config = checkSupabaseConfig();
    throw new Error(config.error || 'Supabase nao configurado para leitura dos tickets.');
  }

  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(options.offset, 10) || 0, 0);

  let query = supabase
    .from('jira_issues')
    .select(DASHBOARD_ISSUE_COLUMNS, { count: 'exact' });

  query = applyIssueFilters(query, filters);
  query = query
    .order('jira_updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  let { data, error, count } = await query;
  if (error && /column .* does not exist/i.test(error.message || '')) {
    query = supabase
      .from('jira_issues')
      .select(BASE_DASHBOARD_ISSUE_COLUMNS, { count: 'exact' });
    query = applyIssueFilters(query, filters);
    query = query
      .order('jira_updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    const retry = await query;
    data = retry.data;
    error = retry.error;
    count = retry.count;
  }
  if (error) {
    throw new Error(`Erro ao ler issues no banco: ${error.message}`);
  }

  return {
    total: count || 0,
    limit,
    offset,
    issues: data || []
  };
}

export function clearJiraDashboardCache() {
  dashboardCache.del(DASHBOARD_CACHE_KEY);
}

export async function fetchDashboardDataFromDatabase({ force = false } = {}) {
  if (!force) {
    const cached = dashboardCache.get(DASHBOARD_CACHE_KEY);
    if (cached) return cached;
  }

  const issues = await fetchIssuesFromDatabase();
  const data = buildDashboardData(issues);
  dashboardCache.set(DASHBOARD_CACHE_KEY, data);
  return data;
}

export async function countIssuesInDatabase() {
  if (!supabase) {
    const config = checkSupabaseConfig();
    throw new Error(config.error || 'Supabase nao configurado para contagem dos tickets.');
  }
  
  const { count, error } = await supabase
    .from('jira_issues')
    .select('*', { count: 'exact', head: true });
    
  if (error) {
    throw new Error(`Erro ao contar issues no banco: ${error.message}`);
  }
  
  console.log(`[DB] countIssuesInDatabase: ${count} issues encontradas.`);
  return count || 0;
}

// ─────────────────────────────────────────────
// Testa conexão com o Jira
// ─────────────────────────────────────────────

export async function testJiraConnection(baseUrl, email, token, jql) {
  try {
    baseUrl = baseUrl?.trim()?.replace(/\/$/, '') || '';
    email   = email?.trim() || '';
    token   = token?.trim() || '';

    // Sanitização de segurança e robustez
    baseUrl = (baseUrl || '').trim().toLowerCase().replace(/\/$/, '');
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    
    if (!baseUrl || !email || !token) {
      return { success: false, error: 'Credenciais incompletas (URL, email ou token ausente).' };
    }

    const authHeader = makeAuthHeader(email, token);

    // 1) Testa autenticação
    const myselfUrl = `${baseUrl}/rest/api/3/myself`;
    const myselfRes = await fetch(myselfUrl, {
      method: 'GET',
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (myselfRes.status === 401) return { success: false, error: 'Email ou token inválidos (401).' };
    if (myselfRes.status === 403) return { success: false, error: 'Token sem permissão de leitura (403).' };
    if (!myselfRes.ok) {
      console.error(`[Jira] Falha no myself (${myselfRes.status}) para URL: ${myselfUrl}`);
      return { success: false, error: `Erro ao autenticar: ${myselfRes.status} (Verifique se a URL ${baseUrl} está correta)` };
    }

    const user = await myselfRes.json();

    // 2) Testa JQL — busca amostra + contagem total
    const effectiveJql = jql?.trim() || 'project is not EMPTY ORDER BY updated DESC';

    // 2a) Busca amostra via API v3 (POST /search/jql)
    const searchRes = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: effectiveJql, maxResults: 1, fields: ['key', 'summary', 'status', 'project'] }),
      signal: AbortSignal.timeout(15000)
    });

    if (!searchRes.ok) {
      const err = await searchRes.json().catch(() => ({}));
      return { success: false, error: `JQL inválida ou sem acesso (${searchRes.status}): ${JSON.stringify(err).substring(0, 150)}` };
    }

    const searchData = await searchRes.json();
    const sampleIssues = (searchData.issues || []).map(i => ({
      key: i.key,
      title: i.fields?.summary,
      project: i.fields?.project?.key,
      status: i.fields?.status?.name
    }));

    // 2b) Busca contagem total via POST /search/approximate-count
    //     A API v3 POST /search/jql NÃO retorna o campo 'total'.
    //     A API antiga GET /search foi descontinuada (410 Gone).
    //     Usamos o endpoint oficial de contagem aproximada.
    let totalTickets = searchData.issues?.length || 0;
    try {
      totalTickets = await countIssuesInJira(baseUrl, email, token, effectiveJql);
    } catch (countError) {
      console.warn('[Jira] Falha ao buscar contagem total (fallback):', countError.message);
    }

    return {
      success: true,
      user: { displayName: user.displayName, email: user.emailAddress, accountId: user.accountId },
      testResult: {
        totalTickets,
        isLast: searchData.isLast,
        sampleIssues
      }
    };
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { success: false, error: 'Timeout ao conectar com o Jira. Verifique a URL.' };
    }
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────
// Agrega dados do banco para o dashboard
// ─────────────────────────────────────────────

/**
 * Enriquece issue flat (do banco) com propriedades aninhadas
 * para compatibilidade com o frontend.
 */
function enrichIssue(issue) {
  return {
    ...issue,
    // Aliases aninhados para compatibilidade com o frontend
    id: issue.issue_id,
    key: issue.issue_key,
    title: issue.title,
    project: {
      id: issue.project_id,
      key: issue.project_key,
      name: issue.project_name,
      avatar: issue.project_avatar
    },
    status: {
      id: issue.status_id,
      name: issue.status_name,
      category: issue.status_category
    },
    type: {
      id: issue.type_id,
      name: issue.type_name,
      icon: issue.type_icon
    },
    priority: issue.priority_name ? {
      id: issue.priority_id,
      name: issue.priority_name,
      icon: issue.priority_icon
    } : null,
    assignee: issue.assignee_id ? {
      id: issue.assignee_id,
      name: issue.assignee_name,
      avatar: issue.assignee_avatar,
      email: issue.assignee_email
    } : null,
    reporter: issue.reporter_id ? {
      id: issue.reporter_id,
      name: issue.reporter_name,
      avatar: issue.reporter_avatar
    } : null,
    creator: issue.creator_id ? {
      id: issue.creator_id,
      name: issue.creator_name,
      avatar: issue.creator_avatar
    } : null,
    parent: issue.parent_key ? {
      key: issue.parent_key,
      title: issue.parent_title
    } : null,
    labels: issue.labels || [],
    components: issue.components || [],
    fixVersions: issue.fix_versions || [],
    createdAt: issue.jira_created_at,
    updatedAt: issue.jira_updated_at,
    resolvedAt: issue.jira_resolved_at,
    dueDate: issue.due_date,
    startDate: issue.start_date || null,
    plannedStartDate: issue.planned_start_date || null,
    plannedEndDate: issue.planned_end_date || issue.due_date || null,
    dateSource: issue.planned_start_date || issue.start_date ? 'jira' : 'created_at_fallback',
    jiraUrl: issue.jira_url || null,
    storyPoints: issue.story_points || 0
  };
}

export function buildDashboardData(rawIssues) {
  const projectsMap  = {};
  const analystsMap  = {};
  const statusesSet  = new Set();
  const prioritiesMap = {};
  const byStatus = {};
  const byProject = {};
  const byAnalyst = {};
  const boardColumnsMap = {};
  const metrics = {
    unassigned: 0,
    blocked: 0,
    done: 0,
    inProgress: 0
  };
  const issues = [];
  let lastSyncedAt = null;

  const DEFAULT_STATUS_ORDER = [
    'NÃO INICIADO', 'EM PROGRESSO', 'READY4TEST',
    'VALIDAÇÃO CLIENTE', 'BLOQUEADO', 'CONCLUÍDO', 'CANCELADO'
  ];

  function statusOrder(name) {
    const up = (name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const idx = DEFAULT_STATUS_ORDER.findIndex(s =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === up
    );
    return idx >= 0 ? idx : 99;
  }

  rawIssues.forEach(rawIssue => {
    const issue = enrichIssue(rawIssue);
    issues.push(issue);

    const projectKey = issue.project_key || '';
    const statusName = issue.status_name || 'Unknown';
    const assigneeId = issue.assignee_id;
    const statusLower = statusName.toLowerCase();
    const statusCategory = (issue.status_category || '').toLowerCase();

    if (projectKey) {
      if (!projectsMap[projectKey]) {
        projectsMap[projectKey] = {
          id: issue.project_id, key: projectKey,
          name: issue.project_name, avatar: issue.project_avatar,
          totalTickets: 0, statuses: {}, analysts: new Set()
        };
      }
      projectsMap[projectKey].totalTickets++;
      if (assigneeId) projectsMap[projectKey].analysts.add(assigneeId);
      projectsMap[projectKey].statuses[statusName] = (projectsMap[projectKey].statuses[statusName] || 0) + 1;
      byProject[projectKey] = (byProject[projectKey] || 0) + 1;
    }

    statusesSet.add(statusName);
    byStatus[statusName] = (byStatus[statusName] || 0) + 1;
    if (!boardColumnsMap[statusName]) {
      boardColumnsMap[statusName] = { name: statusName, total: 0, issues: [] };
    }
    boardColumnsMap[statusName].total++;
    boardColumnsMap[statusName].issues.push(issue);

    if (assigneeId) {
      if (!analystsMap[assigneeId]) {
        analystsMap[assigneeId] = {
          id: assigneeId, name: issue.assignee_name,
          avatar: issue.assignee_avatar, email: issue.assignee_email,
          totalTickets: 0, ticketsByStatus: {}, ticketsByProject: {}
        };
      }
      analystsMap[assigneeId].totalTickets++;
      analystsMap[assigneeId].ticketsByStatus[statusName] = (analystsMap[assigneeId].ticketsByStatus[statusName] || 0) + 1;
      analystsMap[assigneeId].ticketsByProject[projectKey] = (analystsMap[assigneeId].ticketsByProject[projectKey] || 0) + 1;
    }

    if (issue.priority_name) {
      prioritiesMap[issue.priority_name] = (prioritiesMap[issue.priority_name] || 0) + 1;
    }

    if (!assigneeId) metrics.unassigned++;
    if (statusLower.includes('bloq') || statusLower.includes('block')) metrics.blocked++;
    if (statusCategory === 'done' || statusLower.includes('conclu') || statusLower.includes('done')) metrics.done++;
    if (statusCategory === 'indeterminate' || statusLower.includes('progr') || statusLower.includes('andamento')) metrics.inProgress++;

    if (issue.synced_at && (!lastSyncedAt || new Date(issue.synced_at) > new Date(lastSyncedAt))) {
      lastSyncedAt = issue.synced_at;
    }
  });

  const projects = Object.values(projectsMap).map(p => ({ ...p, analystCount: p.analysts.size, analysts: undefined }));
  const analysts = Object.values(analystsMap);
  const statuses = Array.from(statusesSet).sort((a, b) => statusOrder(a) - statusOrder(b));
  const total    = issues.length;

  const percentByStatus = {};
  Object.entries(byStatus).forEach(([s, c]) => { percentByStatus[s] = total > 0 ? Math.round((c / total) * 100) : 0; });
  analysts.forEach(a => { byAnalyst[a.name || a.id] = a.totalTickets; });

  const board = {
    columns: statuses.map(s => boardColumnsMap[s] || { name: s, total: 0, issues: [] })
  };

  return {
    lastSyncedAt,
    totalIssues: total,
    totalProjects: projects.length,
    totalAnalysts: analysts.length,
    issues,
    projects,
    analysts,
    statuses,
    metrics: {
      byProject, byStatus, byAnalyst,
      byPriority: prioritiesMap,
      percentByStatus,
      distributionByProject: byProject,
      distributionByAnalyst: byAnalyst,
      ...metrics
    },
    board
  };
}
