/**
 * authSession.js - Stateless signed sessions for serverless auth fallback.
 */
import crypto from 'crypto';

const SESSION_PREFIX = 'sessv1_';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function getSessionSecret() {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.JIRA_ENCRYPTION_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function createSignedSession(email, user = null) {
  const secret = getSessionSecret();
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SESSION_SECRET precisa estar definido com pelo menos 32 caracteres.');
  }

  const now = Date.now();
  const payload = {
    email,
    user,
    iat: now,
    exp: now + SESSION_TTL_MS,
    nonce: crypto.randomBytes(16).toString('base64url')
  };
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(body, secret);
  return `${SESSION_PREFIX}${body}.${signature}`;
}

export function verifySignedSession(sessionId) {
  const secret = getSessionSecret();
  if (!secret || !sessionId?.startsWith(SESSION_PREFIX)) return null;

  const raw = sessionId.slice(SESSION_PREFIX.length);
  const [body, signature] = raw.split('.');
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(body));
    if (!payload?.email || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
