import express from 'express';
import { requireAppAuth } from '../auth.js';
import { canAccessPermission, isFull } from '../../lib/appPermissions.js';
import { fetchDashboardDataFromDatabase } from '../../lib/jiraService.js';
import { createReviewJiraClient, positiveId, projectKey } from '../../lib/sprintReviewJira.js';
import { getReviewRecord, insertReviewRecord, listReviewRecords, insertReviewArt } from '../../lib/sprintReviewStore.js';
import { buildReviewArtManifest, collectReviewArt, reviewArtPageCount } from '../../lib/sprintReviewArt.js';
import { prepareReviewSnapshot, validateReviewProfile, validateReviewChoices } from '../../lib/sprintReviewValidation.js';
import { buildSprintReview } from '../../src/data/sprint-review.js';
import { sprintSlidePages } from '../../src/utils/sprint-review-render.js';
import { synthesizeSprintReview } from '../../lib/sprintReviewAI.js';
import { buildSuggestedReviewProfile } from '../../lib/sprintProfileDefaults.js';

const router = express.Router();
const pending = new Set();
router.use((req, res, next) => {
  Promise.resolve(requireAppAuth(req, res, next)).catch(error => {
    if (!res.headersSent) res.status(error instanceof URIError ? 401 : 503).json({ error: 'Nao foi possivel validar a sessao Supabase.' });
  });
}, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!canAccessPermission(req.session?.user, 'projects.sprint-review')) return res.status(403).json({ error: 'Sem permissao para Sprint Review.' });
  next();
});
const handle = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao processar Sprint Review. Nenhuma versao foi aprovada.' }); } };
async function projects() { return (await fetchDashboardDataFromDatabase()).projects.map(p => ({ key: p.key, name: p.name })); }
async function context(req) {
  const data = req.method === 'GET' || Buffer.isBuffer(req.body) ? req.query : req.body;
  const key = projectKey(data.projectKey), boardId = positiveId(data.boardId);
  if (!(await projects()).some(p => p.key === key)) throw Object.assign(new Error('Projeto nao habilitado no RJA.'), { status: 403 });
  return { projectKey: key, boardId, ...(data.sprintId ? { sprintId: positiveId(data.sprintId) } : {}) };
}
router.get('/projects', handle(async (_req, res) => res.json({ projects: await projects() })));
router.get('/boards', handle(async (req, res) => {
  const key = projectKey(req.query.projectKey);
  if (!(await projects()).some(p => p.key === key)) return res.status(403).json({ error: 'Projeto nao habilitado.' });
  const client = await createReviewJiraClient();
  res.json({ boards: await client.boards(key) });
}));
router.get('/context', handle(async (req, res) => {
  const ctx = await context(req), client = await createReviewJiraClient();
  const sprints = await client.sprints(ctx.projectKey, ctx.boardId);
  const profiles = await listReviewRecords({ ...ctx, kind: 'profile', includePayload: true });
  const types = await client.request(`/rest/api/3/project/${ctx.projectKey}/statuses`);
  const fields = await client.request('/rest/api/3/field');
  const priorities = await client.request('/rest/api/3/priority');
  const profileFields = fields.filter(f => f.custom).map(f => ({ id: f.id, name: f.name, schema: f.schema }));
  res.json({ sprints, profile: profiles[0]?.payload || buildSuggestedReviewProfile({ types, fields: profileFields }), types, priorities: priorities.map(p => ({ id: p.id, name: p.name })), fields: profileFields, canConfigure: isFull(req.session.user) });
}));
router.post('/profile', handle(async (req, res) => {
  if (!isFull(req.session.user)) return res.status(403).json({ error: 'Somente o perfil Full pode alterar regras.' });
  const ctx = await context(req), client = await createReviewJiraClient();
  await client.sprints(ctx.projectKey, ctx.boardId);
  const payload = validateReviewProfile(req.body.profile);
  payload.version = new Date().toISOString();
  const record = await insertReviewRecord({ ...ctx, kind: 'profile', actor: req.session.user.id, payload });
  res.json({ profile: record.payload });
}));
router.post('/analyze', handle(async (req, res) => {
  const ctx = await context(req), actor = req.session.user.id;
  if (!ctx.sprintId) return res.status(400).json({ error: 'Selecione uma sprint.' });
  const lock = `${ctx.projectKey}:${ctx.boardId}:${ctx.sprintId}`;
  if (pending.has(lock)) return res.status(409).json({ error: 'Esta sprint ja esta sendo consultada. Aguarde e tente novamente.' });
  pending.add(lock);
  try {
    const client = await createReviewJiraClient();
    const profiles = await listReviewRecords({ ...ctx, kind: 'profile', includePayload: true, sprintId: undefined });
    let profile = profiles[0]?.payload;
    if (!profile) {
      const [types, fields] = await Promise.all([client.request(`/rest/api/3/project/${ctx.projectKey}/statuses`), client.request('/rest/api/3/field')]);
      profile = buildSuggestedReviewProfile({ types, fields: fields.filter(f => f.custom).map(f => ({ id: f.id, name: f.name, schema: f.schema })) });
    }
    const source = await client.collect(ctx.projectKey, ctx.boardId, ctx.sprintId, profile, { includePostClosure: req.body.mode === 'current' });
    source.mode = req.body.mode === 'current' ? 'current' : 'historical';
    if (source.mode === 'current') {
      source.historicalCompleteDate = source.sprint.completeDate;
      source.sprint = { ...source.sprint, completeDate: source.fetchedAt };
    }
    const baselines = await listReviewRecords({ ...ctx, kind: 'baseline', includePayload: true });
    source.baselineSnapshot = baselines.find(row => row.payload.startDate === source.sprint.startDate)?.payload || null;
    source.ai = { status: 'unconfigured', suggestions: [] };
    const record = await insertReviewRecord({ ...ctx, kind: 'source', actor, payload: source });
    res.json({ sourceId: record.id, review: buildSprintReview(source), aiAvailable: Boolean(process.env.NVIDIA_API_KEY), jiraBaseUrl: source.jiraBaseUrl, fetchedAt: source.fetchedAt, collection: source.collection });
  } finally { pending.delete(lock); }
}));
router.post('/recalculate', handle(async (req, res) => {
  const ctx = await context(req), record = await getReviewRecord(req.body.sourceId);
  if (record.kind !== 'source' || record.project_key !== ctx.projectKey || record.board_id !== ctx.boardId || record.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Origem nao pertence a este contexto.' });
  const choices = validateReviewChoices(record.payload, req.body.choices || {});
  res.json({ review: buildSprintReview({ ...record.payload, choices }) });
}));
router.post('/synthesize', handle(async (req, res) => {
  const ctx = await context(req), record = await getReviewRecord(req.body.sourceId);
  if (record.kind !== 'source' || record.project_key !== ctx.projectKey || record.board_id !== ctx.boardId || record.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Origem nao pertence a este contexto.' });
  const source = record.payload;
  const choices = validateReviewChoices(source, req.body.choices || {});
  const lock = `ai:${ctx.projectKey}:${ctx.boardId}:${ctx.sprintId}`;
  if (pending.has(lock)) return res.status(409).json({ error: 'Ja existe uma sintese em andamento para esta sprint.' });
  pending.add(lock);
  try { source.ai = await synthesizeSprintReview(buildSprintReview({ ...source, choices })); }
  finally { pending.delete(lock); }
  const saved = await insertReviewRecord({ ...ctx, kind: 'source', actor: req.session.user.id, payload: source });
  res.json({ sourceId: saved.id, review: buildSprintReview({ ...source, choices }) });
}));
router.post('/snapshots', handle(async (req, res) => {
  const ctx = await context(req), record = await getReviewRecord(req.body.sourceId);
  if (record.kind !== 'source' || record.project_key !== ctx.projectKey || record.board_id !== ctx.boardId || record.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Origem nao pertence a este contexto.' });
  if (!/^[0-9a-f-]{36}$/i.test(req.body.requestId || '')) return res.status(400).json({ error: 'Identificador da operacao invalido.' });
  const payload = prepareReviewSnapshot(record.payload, req.body);
  payload.sourceId = record.id;
  payload.renderManifest = { pageCount: sprintSlidePages(payload.review).length, templateVersion: payload.templateVersion };
  const saved = await insertReviewRecord({ ...ctx, kind: 'snapshot', actor: req.session.user.id, payload, requestId: req.body.requestId });
  res.status(201).json({ snapshot: saved });
}));
router.get('/snapshots', handle(async (req, res) => res.json({ snapshots: await listReviewRecords({ ...await context(req), kind: 'snapshot' }) })));
router.get('/snapshots/:id', handle(async (req, res) => {
  const ctx = await context(req), record = await getReviewRecord(req.params.id);
  if (record.kind !== 'snapshot' || record.project_key !== ctx.projectKey || record.board_id !== ctx.boardId || record.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Review nao pertence a este contexto.' });
  res.json({ snapshot: record });
}));
router.post('/snapshots/:id/art/:page', express.raw({ type: 'image/png', limit: '4mb' }), handle(async (req, res) => {
  const ctx = await context(req), snapshot = await getReviewRecord(req.params.id);
  if (snapshot.kind !== 'snapshot' || snapshot.project_key !== ctx.projectKey || snapshot.board_id !== ctx.boardId || snapshot.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Review nao pertence a este contexto.' });
  if (snapshot.created_by !== req.session.user.id) return res.status(403).json({ error: 'Somente quem aprovou esta versao pode anexar sua arte. Crie uma nova versao.' });
  const render = await insertReviewArt({ snapshot, page: Number(req.params.page), data: req.body, actor: req.session.user.id });
  res.status(201).json({ id: render.id, hash: render.content_hash });
}));
router.get('/snapshots/:id/art', handle(async (req, res) => {
  const ctx = await context(req), snapshot = await getReviewRecord(req.params.id);
  if (snapshot.kind !== 'snapshot' || snapshot.project_key !== ctx.projectKey || snapshot.board_id !== ctx.boardId || snapshot.sprint_id !== ctx.sprintId) return res.status(403).json({ error: 'Review nao pertence a este contexto.' });
  const records = await listReviewRecords({ ...ctx, kind: 'render', snapshotId: snapshot.id, includePayload: true });
  if (!snapshot.payload.renderManifest) return res.status(409).json({ error: 'Versao antiga sem manifesto de arte. Crie uma nova versao; a original sera preservada.' });
  const pageCount = reviewArtPageCount(snapshot), collected = collectReviewArt(snapshot, records);
  const manifest = collected.size === pageCount ? buildReviewArtManifest(snapshot, records) : { complete: false, pageCount, uploadedPages: [...collected.keys()].sort((a, b) => a - b) };
  const renders = [...collected.entries()].sort(([a], [b]) => a - b).map(([page, { record, hash }]) => ({ id: record.id, page, png: record.payload.png, hash, createdAt: record.created_at }));
  res.json({ renders, manifest });
}));
export default router;
