import express from 'express';
import { requireAppAuth } from '../auth.js';
import { canAccessPermission, isFull } from '../../lib/appPermissions.js';
import { fetchDashboardDataFromDatabase } from '../../lib/jiraService.js';
import { positiveId, projectKey } from '../../lib/sprintReviewJira.js';
import { createPlanJiraClient } from '../../lib/sprintPlanJira.js';
import { getPlanRecord, insertPlanRecord, listPlanRecords } from '../../lib/sprintPlanStore.js';
import { listReviewRecords } from '../../lib/sprintReviewStore.js';
import { buildSprintPlan, validatePlanProfile } from '../../src/data/sprint-plan.js';

const router = express.Router(), pending = new Set();
router.use((req, res, next) => Promise.resolve(requireAppAuth(req, res, next)).catch(error => {
  if (!res.headersSent) res.status(error instanceof URIError ? 401 : 503).json({ error: 'Nao foi possivel validar a sessao Supabase.' });
}), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!canAccessPermission(req.session?.user, 'projects.sprint-plan')) return res.status(403).json({ error: 'Sem permissao para planejamento de sprint.' });
  next();
});
const handle = action => async (req, res) => { try { await action(req, res); } catch (error) { if (!res.headersSent) res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao processar Sprint Plan. Nenhuma versao foi aprovada.' }); } };
async function enabledProjects() { return (await fetchDashboardDataFromDatabase()).projects.map(item => ({ key: item.key, name: item.name })); }
async function requestContext(req, requireSprint = false) {
  const data = req.method === 'GET' ? req.query : req.body;
  const key = projectKey(data.projectKey), boardId = positiveId(data.boardId);
  if (!(await enabledProjects()).some(item => item.key === key)) throw Object.assign(new Error('Projeto nao habilitado no RJA.'), { status: 403 });
  const sprintId = data.sprintId ? positiveId(data.sprintId) : null;
  if (requireSprint && !sprintId) throw Object.assign(new Error('Selecione uma sprint futura ou ativa.'), { status: 400 });
  return { projectKey: key, boardId, ...(sprintId ? { sprintId } : {}) };
}
function belongs(record, ctx, kind) {
  return record?.kind === kind && record.project_key === ctx.projectKey && record.board_id === String(ctx.boardId) && (!ctx.sprintId || record.sprint_id === String(ctx.sprintId));
}
router.get('/projects', handle(async (_req, res) => res.json({ projects: await enabledProjects() })));
router.get('/boards', handle(async (req, res) => {
  const key = projectKey(req.query.projectKey);
  if (!(await enabledProjects()).some(item => item.key === key)) return res.status(403).json({ error: 'Projeto nao habilitado.' });
  res.json({ boards: await (await createPlanJiraClient()).boards(key) });
}));
router.get('/context', handle(async (req, res) => {
  const ctx = await requestContext(req), client = await createPlanJiraClient(), jiraContext = await client.context(ctx.projectKey, ctx.boardId, ctx.sprintId);
  const profiles = await listPlanRecords({ ...ctx, kind: 'profile', includePayload: true, sprintId: undefined });
  const [types, fields] = await Promise.all([client.request(`/rest/api/3/project/${ctx.projectKey}/statuses`), client.request('/rest/api/3/field')]);
  res.json({ sprints: jiraContext.sprints, targetSprint: jiraContext.targetSprint, previousSprint: jiraContext.previousSprint, profile: profiles[0]?.payload || null, types, fields: [{ id: 'duedate', name: 'Data limite', schema: { type: 'date' } }, ...fields.filter(field => field.custom).map(field => ({ id: field.id, name: field.name, schema: field.schema }))], canConfigure: isFull(req.session.user) });
}));
router.post('/profile', handle(async (req, res) => {
  if (!isFull(req.session.user)) return res.status(403).json({ error: 'Somente o perfil Full pode alterar regras.' });
  const ctx = await requestContext(req), client = await createPlanJiraClient();
  await client.context(ctx.projectKey, ctx.boardId);
  const payload = validatePlanProfile(req.body.profile); payload.version = new Date().toISOString();
  const record = await insertPlanRecord({ ...ctx, sprintId: '', kind: 'profile', actor: req.session.user.id, payload });
  res.json({ profile: record.payload });
}));
router.post('/analyze', handle(async (req, res) => {
  const ctx = await requestContext(req, true), actor = req.session.user.id, lock = `${ctx.projectKey}:${ctx.boardId}:${ctx.sprintId}`;
  if (pending.has(lock)) return res.status(409).json({ error: 'Esta sprint ja esta sendo consultada.' });
  pending.add(lock);
  try {
    const profiles = await listPlanRecords({ ...ctx, kind: 'profile', includePayload: true, sprintId: undefined });
    if (!profiles.length) return res.status(400).json({ error: 'Configure e salve o perfil antes de analisar.' });
    const client = await createPlanJiraClient(), source = await client.collect(ctx.projectKey, ctx.boardId, ctx.sprintId, profiles[0].payload, { previousSprintId: req.body.previousSprintId });
    if (source.previousSprint) {
      const reviews = await listReviewRecords({ projectKey: ctx.projectKey, boardId: ctx.boardId, sprintId: String(source.previousSprint.id), kind: 'snapshot', includePayload: true });
      source.reviewSnapshot = reviews[0] ? { id: reviews[0].id, contentHash: reviews[0].content_hash, review: reviews[0].payload.review } : null;
    }
    const drafts = await listPlanRecords({ ...ctx, kind: 'draft', includePayload: true });
    source.draftSnapshot = drafts[0]?.payload?.plan || null;
    const baselines = await listPlanRecords({ ...ctx, kind: 'baseline', includePayload: true });
    source.baselineSnapshot = baselines[0]?.payload?.plan || null;
    source.mode = req.body.mode === 'current' ? 'current' : undefined;
    const saved = await insertPlanRecord({ ...ctx, kind: 'source', actor, payload: source });
    res.json({ sourceId: saved.id, plan: buildSprintPlan(source), jiraBaseUrl: source.jiraBaseUrl, fetchedAt: source.fetchedAt, collection: source.collection });
  } finally { pending.delete(lock); }
}));
router.post('/recalculate', handle(async (req, res) => {
  const ctx = await requestContext(req, true), source = await getPlanRecord(req.body.sourceId);
  if (!belongs(source, ctx, 'source')) return res.status(403).json({ error: 'Origem nao pertence a este contexto.' });
  const mode = req.body.mode === 'current' ? 'current' : source.payload.mode;
  res.json({ plan: buildSprintPlan({ ...source.payload, mode }) });
}));
router.post('/snapshots', handle(async (req, res) => {
  const ctx = await requestContext(req, true), source = await getPlanRecord(req.body.sourceId);
  if (!belongs(source, ctx, 'source')) return res.status(403).json({ error: 'Origem nao pertence a este contexto.' });
  if (!/^[0-9a-f-]{36}$/i.test(req.body.requestId || '')) return res.status(400).json({ error: 'Identificador da operacao invalido.' });
  const plan = buildSprintPlan(source.payload);
  const accepted = new Set(Array.isArray(req.body.acceptedWarnings) ? req.body.acceptedWarnings : []);
  if (plan.preflight.errors.length) return res.status(409).json({ error: 'O Preflight possui erros bloqueantes.', preflight: plan.preflight });
  const pendingWarnings = plan.preflight.warnings.filter(item => !accepted.has(item.code) && !accepted.has(`${item.code}:${item.issueKey || ''}`));
  if (pendingWarnings.length) return res.status(409).json({ error: 'Confirme os avisos do Preflight antes de aprovar.', warnings: pendingWarnings });
  const kind = plan.state === 'draft' ? 'draft' : plan.state === 'current' ? 'snapshot' : 'baseline';
  if (kind === 'baseline') {
    const existing = await listPlanRecords({ ...ctx, kind: 'baseline', includePayload: true });
    if (existing.length && existing[0].payload?.sourceId !== source.id) return res.status(409).json({ error: 'O Plan Baseline desta sprint ja foi aprovado e e imutavel. Gere uma Visao Atualizada.' });
  }
  const payload = { plan, sourceId: source.id, acceptedWarnings: [...accepted], ruleVersion: plan.ruleVersion, approvedAt: source.payload.fetchedAt };
  const saved = await insertPlanRecord({ ...ctx, kind, actor: req.session.user.id, payload, requestId: req.body.requestId });
  res.status(201).json({ snapshot: saved });
}));
router.get('/snapshots', handle(async (req, res) => {
  const ctx = await requestContext(req, true);
  const [drafts, baselines, views] = await Promise.all([listPlanRecords({ ...ctx, kind: 'draft' }), listPlanRecords({ ...ctx, kind: 'baseline' }), listPlanRecords({ ...ctx, kind: 'snapshot' })]);
  res.json({ snapshots: [...drafts, ...baselines, ...views].sort((a, b) => b.revision - a.revision) });
}));
router.get('/snapshots/:id', handle(async (req, res) => {
  const ctx = await requestContext(req, true), record = await getPlanRecord(req.params.id);
  if (!belongs(record, ctx, record.kind) || !['draft', 'baseline', 'snapshot'].includes(record.kind)) return res.status(403).json({ error: 'Plano nao pertence a este contexto.' });
  res.json({ snapshot: record });
}));
export default router;
