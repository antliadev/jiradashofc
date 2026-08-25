/**
 * server/auth.js - Módulo de autenticação
 * Login com usuarios locais e fallback para credencial de ambiente.
 */
import { authenticateUser } from './access-store.js';

import { createSignedSession, verifySignedSession } from '../lib/authSession.js';

// Fallback legado temporario. A versao oficial deve substituir este fluxo por
// Supabase Auth; enquanto isso, credenciais precisam ser configuradas fora do repo.
const VALID_EMAIL = process.env.AUTH_EMAIL || '';
const VALID_PASSWORD = process.env.AUTH_PASSWORD || '';

// Armazenamento de sessões em memória (em produção, usar Redis ou BD)
const sessions = new Map();

/**
 * Gera um ID de sessão único
 */
function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Valida credenciais do usuário
 */
function validateCredentials(email, password) {
  return !!VALID_EMAIL && !!VALID_PASSWORD && email === VALID_EMAIL && password === VALID_PASSWORD;
}

/**
 * Cria uma nova sessão
 */
function createLegacySession(user) {
  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    email: user.login || user.email,
    user,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
  };
  
  sessions.set(sessionId, session);
  return session;
}

function createSession(user) {
  const email = user.login || user.email;
  try {
    const id = createSignedSession(email, user);
    const session = {
      id,
      email,
      user,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
    sessions.set(id, session);
    return session;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn('[Auth] Sessao assinada indisponivel; usando memoria apenas no ambiente local.');
    return createLegacySession(user);
  }
}

/**
 * Valida uma sessão existente
 */
function validateSession(sessionId) {
  const signed = verifySignedSession(sessionId);
  if (signed) {
    const storedSession = sessions.get(sessionId);
    if (storedSession) return storedSession;
    return {
      id: sessionId,
      email: signed.email,
      user: signed.user || null,
      createdAt: new Date(signed.iat).toISOString(),
      expiresAt: new Date(signed.exp).toISOString()
    };
  }

  const session = sessions.get(sessionId);
  
  if (!session) {
    return null;
  }
  
  // Verificar expiração
  if (new Date(session.expiresAt) < new Date()) {
    sessions.delete(sessionId);
    return null;
  }
  
  return session;
}

/**
 * Destroi uma sessão
 */
function destroySession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Middleware Express para verificar autenticação
 */
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const session = validateSession(sessionId);
  
  if (!session) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida' });
  }
  
  // Adicionar sessão ao request para uso posterior
  req.session = session;
  next();
}

/**
 * Endpoint de login
 */
async function handleLogin(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  
  const managedUser = await authenticateUser(email, password);
  const fallbackUser = validateCredentials(email, password) ? {
    id: 'env-admin',
    name: 'Administrador',
    login: email,
    role: 'full',
    status: 'active',
    permissions: [],
  } : null;
  const user = managedUser || fallbackUser;

  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  
  let session;
  try {
    session = createSession(user);
  } catch (error) {
    console.error('[Auth] Falha ao criar sessao:', error.message);
    return res.status(500).json({ error: 'Autenticacao indisponivel. Verifique a configuracao segura da sessao.' });
  }
  
  res.json({
    success: true,
    sessionId: session.id,
    email: session.email,
    user: session.user
  });
}

/**
 * Endpoint de logout
 */
function handleLogout(req, res) {
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
  
  if (sessionId) {
    destroySession(sessionId);
  }
  
  res.json({ success: true, message: 'Logout realizado' });
}

/**
 * Endpoint para verificar sessão atual
 */
function handleCheckSession(req, res) {
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ authenticated: false });
  }
  
  const session = validateSession(sessionId);
  
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  
  res.json({
    authenticated: true,
    email: session.email,
    user: session.user
  });
}

export {
  handleLogin,
  handleLogout,
  handleCheckSession,
  requireAuth,
  validateSession
};
