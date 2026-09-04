import { createReviewJiraClient, mayBelongToReview, positiveId, projectKey } from './sprintReviewJira.js';
import { resolvePreviousSprint } from '../src/data/sprint-plan.js';

export async function createPlanJiraClient(options = {}) {
  const jira = await createReviewJiraClient(options);
  async function allSprints(key, boardId) {
    const allowed = await jira.boards(key);
    if (!allowed.some(board => String(board.id) === positiveId(boardId))) throw Object.assign(new Error('Board nao pertence ao contexto do projeto.'), { status: 403 });
    return jira.pages(`/rest/agile/1.0/board/${positiveId(boardId)}/sprint?state=active%2Cclosed%2Cfuture`);
  }
  async function context(key, boardId, targetSprintId) {
    const all = await allSprints(projectKey(key), boardId);
    const eligible = all.filter(sprint => sprint.state === 'future' || sprint.state === 'active');
    const target = targetSprintId ? all.find(sprint => String(sprint.id) === positiveId(targetSprintId)) : null;
    if (targetSprintId && (!target || !eligible.includes(target))) throw Object.assign(new Error('Selecione uma sprint futura ou ativa deste board.'), { status: 400 });
    return { allSprints: all, sprints: eligible, targetSprint: target, previousSprint: target ? resolvePreviousSprint(all, target.id) : null };
  }
  async function collect(key, boardId, targetSprintId, profile, { previousSprintId } = {}) {
    const started = Date.now(), resolved = await context(key, boardId, targetSprintId);
    let previousSprint = resolved.previousSprint;
    if (previousSprintId) {
      const override = resolved.allSprints.find(sprint => String(sprint.id) === positiveId(previousSprintId) && sprint.state === 'closed');
      if (!override) throw Object.assign(new Error('Sprint anterior informada nao pertence ao board ou nao esta encerrada.'), { status: 400 });
      previousSprint = override;
    }
    const issues = [], seen = new Set(), tokens = new Set();
    let nextPageToken;
    const fields = ['summary', 'created', 'updated', 'status', 'issuetype', 'assignee', 'duedate', 'priority', 'parent', 'description', 'issuelinks', ...[profile.sprintField, profile.checklistField, profile.startField, profile.groupField, profile.executiveDateField].filter(Boolean)];
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const page = await jira.request('/rest/api/3/search/jql', { jql: `project = "${projectKey(key)}" ORDER BY id ASC`, fields: [...new Set(fields)], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) });
      if (!Array.isArray(page.issues)) throw new Error('Consulta Jira retornou dados invalidos.');
      for (const issue of page.issues) if (issue.id && !seen.has(String(issue.id))) { seen.add(String(issue.id)); issues.push(issue); }
      if (page.isLast === true) break;
      if (!page.nextPageToken || tokens.has(page.nextPageToken)) throw new Error('Jira nao confirmou paginacao completa; dados parciais foram descartados.');
      tokens.add(page.nextPageToken); nextPageToken = page.nextPageToken;
      if (pageIndex === 999) throw new Error('Limite de issues excedido.');
    }
    let cursor = 0, commentIssues = 0;
    await Promise.all(Array.from({ length: Math.min(4, issues.length) }, async () => {
      while (cursor < issues.length) {
        const issue = issues[cursor++];
        const histories = await jira.pages(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/changelog`);
        for (const history of histories) for (const item of history.items || []) if (item.field === 'Sprint' && !item.fieldId) item.fieldId = profile.sprintField;
        issue.changelog = { histories, total: histories.length }; issue.historyComplete = true;
        const relevant = mayBelongToReview(issue, profile.sprintField, resolved.targetSprint.id) || (previousSprint && mayBelongToReview(issue, profile.sprintField, previousSprint.id));
        issue.comments = relevant ? await jira.pages(`/rest/api/3/issue/${encodeURIComponent(issue.id)}/comment`, 'comments') : [];
        if (relevant) commentIssues++;
      }
    }));
    return { projectKey: projectKey(key), boardId: positiveId(boardId), targetSprint: resolved.targetSprint, previousSprint, sprints: resolved.allSprints, profile, issues, scopeComplete: true, fetchedAt: new Date().toISOString(), jiraBaseUrl: jira.baseUrl, collection: { strategy: 'project_history', projectIssueCount: issues.length, commentIssues, durationMs: Date.now() - started }, previousSprintOverride: previousSprintId ? { sprintId: String(previousSprintId), auditRequired: true } : null };
  }
  return { ...jira, allSprints, context, collect };
}
