import { configService } from './configService.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function positiveId(value) {
  const id = String(value || '');
  if (!/^[1-9]\d*$/.test(id)) throw Object.assign(new Error('Identificador Jira invalido.'), { status: 400 });
  return id;
}
export function projectKey(value) {
  const key = String(value || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(key)) throw Object.assign(new Error('Projeto invalido.'), { status: 400 });
  return key;
}
export async function createReviewJiraClient({ connection, fetchImpl = fetch, delay = sleep, timeoutMs = 240_000 } = {}) {
  const environment = process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN
    ? { baseUrl: process.env.JIRA_BASE_URL.trim(), email: process.env.JIRA_EMAIL.trim(), token: process.env.JIRA_API_TOKEN.trim() } : null;
  const config = connection || environment || await configService.getActiveConnection() || await configService.getActiveConfig();
  if (!config?.baseUrl || !config?.email || !config?.token) throw Object.assign(new Error('Configure a conexao Jira na tela Dados.'), { status: 503 });
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Conexao Jira invalida.');
  const deadline = Date.now() + timeoutMs;
  async function request(path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() > deadline) throw Object.assign(new Error('A consulta excedeu o limite. Nenhuma analise parcial foi aprovada.'), { status: 504 });
      const response = await fetchImpl(`${base.origin}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))),
        headers: { Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retry = Number(response.headers.get('retry-after'));
        await delay(Math.min(30_000, Math.max(1000 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0)));
        continue;
      }
      if (!response.ok) throw Object.assign(new Error(`Jira recusou a consulta (${response.status}). Verifique acesso ao projeto e ao board.`), { status: response.status === 403 ? 403 : 502 });
      return response.json();
    }
  }
  async function pages(path, property = 'values') {
    const values = [], seen = new Set();
    for (let startAt = 0, pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const page = await request(`${path}${path.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=100`);
      const batch = page[property];
      if (!Array.isArray(batch)) throw new Error('Formato de paginacao inesperado no Jira.');
      let added = 0;
      for (const entry of batch) {
        if (!entry.id || seen.has(String(entry.id))) continue;
        seen.add(String(entry.id)); values.push(entry); added++;
      }
      const next = startAt + batch.length;
      if (page.isLast === true || (Number.isFinite(page.total) && next >= page.total)) return values;
      if (!batch.length || !added) throw new Error('Paginacao Jira incompleta ou repetida. Tente novamente.');
      startAt = next;
    }
    throw new Error('Limite de paginacao excedido; dados parciais nao serao usados.');
  }
  const boards = key => pages(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey(key))}&type=scrum`);
  async function sprints(key, boardId) {
    const allowed = await boards(key);
    if (!allowed.some(b => String(b.id) === positiveId(boardId))) throw Object.assign(new Error('Board nao pertence ao contexto do projeto.'), { status: 403 });
    return pages(`/rest/agile/1.0/board/${positiveId(boardId)}/sprint?state=active,closed`);
  }
  async function collect(key, boardId, sprintId, profile, { allowActive = false } = {}) {
    const available = await sprints(key, boardId);
    const sprint = available.find(s => String(s.id) === positiveId(sprintId));
    if (!sprint || (sprint.state !== 'closed' && !(allowActive && sprint.state === 'active'))) throw Object.assign(new Error('Selecione uma sprint encerrada deste board.'), { status: 400 });
    const issues = [], seen = new Set(), tokens = new Set();
    let nextPageToken;
    // sprint = ID omits removed issues. Inspect the selected project's history,
    // including cards no longer assigned to the sprint; never sync the whole site.
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const page = await request('/rest/api/3/search/jql', { jql: `project = "${projectKey(key)}" ORDER BY id ASC`, fields: ['summary', 'created', 'updated', 'status', 'issuetype', 'assignee', 'duedate', 'priority', 'parent', 'description', 'issuelinks', ...[profile.sprintField, profile.checklistField, profile.startField, profile.groupField].filter(Boolean)], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) });
      if (!Array.isArray(page.issues)) throw new Error('Consulta Jira retornou dados invalidos.');
      for (const issue of page.issues) if (!seen.has(issue.id)) { seen.add(issue.id); issues.push(issue); }
      if (page.isLast === true) break;
      if (!page.nextPageToken) throw new Error('Jira nao confirmou o fim da consulta. Dados parciais nao serao usados.');
      if (tokens.has(page.nextPageToken)) throw new Error('Cursor Jira repetido. Coleta interrompida.');
      tokens.add(page.nextPageToken); nextPageToken = page.nextPageToken;
      if (pageIndex === 999) throw new Error('Limite de issues excedido.');
    }
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, issues.length) }, async () => {
      while (cursor < issues.length) {
        const issue = issues[cursor++];
        const histories = await pages(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/changelog`);
        for (const h of histories) for (const item of h.items || []) {
          if (item.field === 'Sprint' && !item.fieldId) item.fieldId = profile.sprintField;
        }
        issue.changelog = { histories, total: histories.length };
        issue.historyComplete = true;
        const sprintHistory = JSON.stringify([issue.fields[profile.sprintField], histories.filter(h => h.items?.some(i => i.fieldId === profile.sprintField))]);
        // Only fetch sensitive comment bodies for possible sprint participants.
        if (!allowActive && sprintHistory.includes(String(sprintId))) issue.comments = await pages(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/comment`, 'comments');
        else issue.comments = [];
      }
    }));
    return { projectKey: key, boardId, sprint, profile, issues, scopeComplete: true, fetchedAt: new Date().toISOString(), jiraBaseUrl: base.origin };
  }
  return { request, pages, boards, sprints, collect, baseUrl: base.origin };
}
