/**
 * server/index.js — Servidor Express para desenvolvimento local
 *
 * Usa as mesmas funções do lib/ que o Vercel usa em produção.
 * O Vite faz proxy de /api/* para este servidor (porta 3001).
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jiraRoutes from './routes/jira.js';
import * as auth from './auth.js';
import { canManageAccess, createUser, listUsers, revokeUser, updateUser } from './access-store.js';
import { authConfig } from '../lib/authConfig.js';
import { canAccessPermission, permissionForJiraRequest } from '../lib/appPermissions.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Parsing do body: em modo dev (servidor local), usa express.json().
// Na Vercel, api/index.js faz a pré-análise do req.body antes do Express processar.
// O express.json() ignora se req.body já estiver definido.
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
  next();
});

// ─── Rotas de autenticação (públicas) ───────────────────
// O frontend e a funcao Vercel usam /api/auth. Mantemos os aliases antigos.
app.post('/api/auth', auth.handleLogin);
app.get('/api/auth', auth.handleCheckSession);
app.delete('/api/auth', auth.handleLogout);
app.get('/api/auth/config', auth.handlePublicConfig);
app.post('/api/auth/oauth', auth.handleOAuthSession);
app.post('/api/auth/login', auth.handleLogin);
app.post('/api/auth/logout', auth.handleLogout);
app.get('/api/auth/check', auth.handleCheckSession);

function requireFullAccess(req, res, next) {
  auth.requireAppAuth(req, res, () => {
    if (!canManageAccess(req.session?.user)) {
      return res.status(403).json({ error: 'Acesso restrito ao perfil Full.' });
    }
    next();
  });
}

app.get('/api/access/users', requireFullAccess, async (req, res) => {
  res.json({ users: await listUsers() });
});

app.post('/api/access/users', requireFullAccess, async (req, res) => {
  try {
    res.status(201).json({ user: await createUser({ ...(req.body || {}), actorUserId: req.session?.user?.id }) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/access/users/:id', requireFullAccess, async (req, res) => {
  try {
    res.json({ user: await updateUser(req.params.id, { ...(req.body || {}), actorUserId: req.session?.user?.id }) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.delete('/api/access/users/:id', requireFullAccess, async (req, res) => {
  try {
    res.json({ user: await revokeUser(req.params.id, req.session?.user?.id) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

function jiraApiAuth(req, res, next) {
  const forceProtectedApi = process.env.NODE_ENV === 'production'
    || process.env.VERCEL === '1'
    || process.env.VERCEL === 'true'
    || authConfig.requireApiAuth;

  if (forceProtectedApi) {
    return auth.requireAppAuth(req, res, () => {
      const permission = permissionForJiraRequest(req);
      if (!canAccessPermission(req.session?.user, permission)) {
        return res.status(403).json({ error: 'Permissao insuficiente para esta API.', permission });
      }
      next();
    });
  }

  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return next();
  }

  const session = auth.validateSession(sessionId);
  if (session) {
    req.session = session;
  }
  
  next();
}

app.use('/api/jira', jiraApiAuth, jiraRoutes);

// Rota raiz para verificação rápida (sem proteção obrigatória)
app.get('/api/jira', jiraApiAuth, (req, res) => {
  res.json({
    status: 'ok',
    message: 'Radar Jira Antlia API (Desenvolvimento)',
    endpoints: [
      'GET  /api/jira/config          - Configuração atual',
      'POST /api/jira/config          - Salva configuração',
      'POST /api/jira/test-connection - Testa conexão com Jira',
      'GET  /api/jira/sync/status     - Status da sincronização',
      'POST /api/jira/sync            - Sincroniza Jira → banco (credenciais do body)',
      'POST /api/jira/sync/start      - Sincroniza Jira → banco (apenas env vars)',
      'GET  /api/jira/dashboard       - Dados agregados (do banco)',
      'GET  /api/jira/issues          - Lista de tickets (do banco)',
      'GET  /api/jira/projects        - Projetos (do banco)',
      'GET  /api/jira/analysts        - Analistas (do banco)',
      'GET  /api/jira/statuses        - Status (do banco)',
      'GET  /api/jira/metrics         - Métricas (do banco)',
      'GET  /api/jira/board           - Board Kanban (do banco)'
    ],
    note: 'Dados são lidos do Supabase. Apenas /sync chama a API do Jira.'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler global
app.use((err, req, res, _next) => {
  console.error('[Server] Erro não tratado:', err.message);
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

// Agendador de sincronização automática em background (para servidor Node/Standalone).
// Executa ao iniciar e depois a cada 30 minutos, todos os dias.
function initAutoSyncScheduler() {
  let lastRunAt = 0;

  setInterval(async () => {
    try {
      const now = new Date();
      const elapsedMs = Date.now() - lastRunAt;
      if (lastRunAt && elapsedMs < 30 * 60 * 1000) return;

      const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      lastRunAt = Date.now();
      console.log(`[AutoSync] Disparando sincronizacao automatica (${formatter.format(now)} BRT)...`);
      const { executeAutoSync } = await import('../lib/syncJobService.js');
      const result = await executeAutoSync('node-scheduler', { forceScheduleCheck: true });
      console.log('[AutoSync] Resultado da sincronizacao automatica:', result?.status || 'concluido');
    } catch (err) {
      console.error('[AutoSync] Erro no agendador:', err.message);
    }
  }, 30 * 1000); // Checa a cada 30 segundos
}

// Iniciar servidor e agendador
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`[Server] Rodando na porta ${PORT}`);
    console.log(`[Server] API Jira: http://localhost:${PORT}/api/jira`);
    initAutoSyncScheduler();
  });
}

export default app;
