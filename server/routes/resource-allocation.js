import express from 'express';
import { requireAppAuth } from '../auth.js';
import { canAccessPermission } from '../../lib/appPermissions.js';
import { listResourceAllocationState, upsertResourceAllocation, upsertResourceProject } from '../../lib/resourceAllocationStore.js';

const router = express.Router();

router.use((req, res, next) => {
  Promise.resolve(requireAppAuth(req, res, next)).catch(error => {
    if (!res.headersSent) res.status(error instanceof URIError ? 401 : 503).json({ error: 'Nao foi possivel validar a sessao Supabase.' });
  });
}, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!canAccessPermission(req.session?.user, 'projects.resource-allocation')) return res.status(403).json({ error: 'Sem permissao para Alocacao de Recursos.' });
  next();
});

const handle = action => async (req, res) => {
  try {
    await action(req, res);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Falha ao processar Alocacao de Recursos.' });
  }
};

router.get('/state', handle(async (_req, res) => {
  res.json(await listResourceAllocationState());
}));

router.post('/projects', handle(async (req, res) => {
  const project = await upsertResourceProject({ project: req.body?.project || {}, actor: req.session.user.id });
  res.status(201).json({ project });
}));

router.post('/allocations', handle(async (req, res) => {
  const allocation = await upsertResourceAllocation({ allocation: req.body?.allocation || {}, actor: req.session.user.id });
  res.status(201).json({ allocation });
}));

export default router;
