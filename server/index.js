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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Body parsing: in dev mode (local server), use express.json().
// In Vercel, api/index.js pre-parses req.body before Express processes it.
// express.json() skips if req.body is already set.
app.use(express.json({ limit: '1mb' }));


// ─── Rotas de autenticação (públicas) ───────────────────
// O frontend e a funcao Vercel usam /api/auth. Mantemos os aliases antigos.
app.post('/api/auth', auth.handleLogin);
app.get('/api/auth', auth.handleCheckSession);
app.delete('/api/auth', auth.handleLogout);
app.post('/api/auth/login', auth.handleLogin);
app.post('/api/auth/logout', auth.handleLogout);
app.get('/api/auth/check', auth.handleCheckSession);

function requireFullAccess(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = auth.validateSession(sessionId);
  if (!session || !canManageAccess(session.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao perfil Full.' });
  }
  req.session = session;
  next();
}

app.get('/api/access/users', requireFullAccess, async (req, res) => {
  res.json({ users: await listUsers() });
});

app.post('/api/access/users', requireFullAccess, async (req, res) => {
  try {
    res.status(201).json({ user: await createUser(req.body || {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/access/users/:id', requireFullAccess, async (req, res) => {
  try {
    res.json({ user: await updateUser(req.params.id, req.body || {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.delete('/api/access/users/:id', requireFullAccess, async (req, res) => {
  try {
    res.json({ user: await revokeUser(req.params.id) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ─── Middleware de proteção opcional ────────────────────────────
// As APIs do Jira usam credenciais armazenadas no banco (criptografadas)
// Não precisam de sessão do usuário
function optionalAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  
  // Se não tem sessionId, permite acesso (as APIs usam credenciais do banco)
  if (!sessionId) {
    return next();
  }
  
  // Se tem sessionId, valida (opcional)
  const session = auth.validateSession(sessionId);
  if (session) {
    req.session = session;
  }
  
  next();
}

// Rotas do Jira sem autenticação obrigatória
app.use('/api/jira', optionalAuth, jiraRoutes);

// Rota raiz para verificação rápida (sem proteção obrigatória)
app.get('/api/jira', optionalAuth, (req, res) => {
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
app.use((err, req, res, next) => {
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
