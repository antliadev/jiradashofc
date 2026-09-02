import { fieldAt, sprintIds, timestamp } from '../src/data/sprint-review.js';
import { createReviewJiraClient } from './sprintReviewJira.js';
import { insertReviewRecord, latestReviewProfiles, listReviewRecords } from './sprintReviewStore.js';

export function reconstructReviewBaseline(source) {
  const { sprint, profile } = source;
  const fields = [...new Set(['created', 'summary', 'status', 'assignee', 'duedate', 'parent', 'priority', 'issuetype', profile.startField, profile.groupField, profile.checklistField].filter(Boolean))];
  if (!source.scopeComplete || !Number.isFinite(timestamp(sprint.startDate))) throw new Error('Nao foi possivel reconstruir o baseline completo.');
  const items = [];
  for (const issue of source.issues) {
    if (!issue.historyComplete || issue.changelog.histories.some(h => !Number.isFinite(timestamp(h.created)))) throw new Error('Historico incompleto no baseline.');
    const ids = sprintIds(fieldAt(issue, profile.sprintField, sprint.startDate));
    if (!ids) throw new Error('Historico de sprint nao interpretavel no baseline.');
    if (timestamp(issue.fields.created) <= timestamp(sprint.startDate) && ids.includes(String(sprint.id))) items.push({ key: issue.key, fields: Object.fromEntries(fields.map(field => [field, fieldAt(issue, field, sprint.startDate)])) });
  }
  return { startDate: sprint.startDate, capturedAt: source.fetchedAt, mode: 'reconstructed_at_start', items, profileVersion: profile.version };
}

// Called by the existing sync worker. Failure is reported separately and never
// turns a successful Jira synchronization into an apparent failure.
export async function captureActiveReviewBaselines(rawIssues, credentials) {
  const projects = new Set(rawIssues.map(issue => issue.fields?.project?.key).filter(Boolean));
  const profiles = (await latestReviewProfiles()).filter(row => projects.has(row.project_key));
  let captured = 0;
  const started = Date.now();
  for (const profile of profiles) {
    if (Date.now() - started > 60_000) break;
    const client = await createReviewJiraClient({ connection: credentials, timeoutMs: Math.max(1, 60_000 - (Date.now() - started)) });
    const active = (await client.sprints(profile.project_key, profile.board_id)).filter(s => s.state === 'active');
    for (const sprint of active) {
      const ctx = { projectKey: profile.project_key, boardId: profile.board_id, sprintId: sprint.id };
      const existing = await listReviewRecords({ ...ctx, kind: 'baseline', includePayload: true });
      if (existing.some(row => row.payload.startDate === sprint.startDate)) continue;
      const source = await client.collect(ctx.projectKey, ctx.boardId, ctx.sprintId, profile.payload, { allowActive: true });
      await insertReviewRecord({ ...ctx, kind: 'baseline', actor: 'system:sync', payload: reconstructReviewBaseline(source) });
      captured++;
    }
  }
  return captured;
}
