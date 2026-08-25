import { createClient } from '@supabase/supabase-js';
import { authConfig, assertAllowedEmail, normalizeEmail } from './authConfig.js';
import { supabase, supabaseKeyIsPrivileged } from './supabaseServer.js';

const ACCESS_COOKIE = 'rja_access_token';
const REFRESH_COOKIE = 'rja_refresh_token';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieOptions({ clear = false } = {}) {
  const parts = [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function serializeCookie(name, value, options = {}) {
  return `${name}=${encodeURIComponent(value || '')}; ${cookieOptions(options)}`;
}

function setAuthCookies(res, session) {
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, session.access_token),
    serializeCookie(REFRESH_COOKIE, session.refresh_token),
  ]);
}

function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, '', { clear: true }),
    serializeCookie(REFRESH_COOKIE, '', { clear: true }),
  ]);
}

function getCookie(req, name) {
  if (req.cookies?.[name]) return req.cookies[name];
  const raw = req.headers?.cookie || '';
  return raw
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function authClientForUserSession() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function publicUserFromSupabase(user, profile = null, permissions = []) {
  const role = profile?.role || profile?.primary_role || 'visualizacao';
  return {
    id: user.id,
    name: profile?.display_name || user.user_metadata?.name || user.email,
    login: user.email,
    email: user.email,
    role,
    status: profile?.status || 'active',
    permissions,
    emailConfirmedAt: user.email_confirmed_at || null,
  };
}

async function loadProfileAndPermissions(userId) {
  if (!supabase) return { profile: null, permissions: [] };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id,email,display_name,status,primary_role')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError && !/does not exist|schema cache/i.test(profileError.message || '')) {
    throw profileError;
  }

  const { data: permissionRows, error: permissionError } = await supabase
    .from('user_effective_permissions')
    .select('permission_code')
    .eq('user_id', userId);

  if (permissionError && !/does not exist|schema cache/i.test(permissionError.message || '')) {
    throw permissionError;
  }

  return {
    profile: profile || null,
    permissions: (permissionRows || []).map(row => row.permission_code).filter(Boolean),
  };
}

export function isSupabaseAuthReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export async function signInWithSupabase(email, password, res) {
  const cleanEmail = assertAllowedEmail(email);
  const client = authClientForUserSession();
  if (!client) {
    const error = new Error('Supabase Auth nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.');
    error.status = 503;
    throw error;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  if (error) {
    const authError = new Error(error.message || 'Credenciais invalidas.');
    authError.status = 401;
    throw authError;
  }

  if (!data?.session?.access_token || !data?.user) {
    const authError = new Error('Sessao Supabase nao retornada.');
    authError.status = 401;
    throw authError;
  }

  if (authConfig.requireEmailConfirmation && !data.user.email_confirmed_at) {
    const authError = new Error('Confirme o email antes de acessar o JiraDash.');
    authError.status = 403;
    authError.code = 'AUTH_EMAIL_NOT_CONFIRMED';
    throw authError;
  }

  const { profile, permissions } = await loadProfileAndPermissions(data.user.id);
  if (profile?.status === 'inactive') {
    const authError = new Error('Usuario inativo.');
    authError.status = 403;
    throw authError;
  }

  setAuthCookies(res, data.session);
  return {
    sessionId: 'supabase-cookie',
    email: data.user.email,
    user: publicUserFromSupabase(data.user, profile, permissions),
  };
}

export async function resolveSupabaseSession(req, res = null) {
  const accessToken = decodeURIComponent(getCookie(req, ACCESS_COOKIE) || '');
  const refreshToken = decodeURIComponent(getCookie(req, REFRESH_COOKIE) || '');
  if (!accessToken) return null;

  const client = authClientForUserSession();
  if (!client) return null;

  let userResult = await client.auth.getUser(accessToken);
  if (userResult.error && refreshToken) {
    const refreshResult = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (!refreshResult.error && refreshResult.data?.session && res) {
      setAuthCookies(res, refreshResult.data.session);
      userResult = await client.auth.getUser(refreshResult.data.session.access_token);
    }
  }

  const user = userResult.data?.user;
  if (!user || userResult.error) return null;
  const email = normalizeEmail(user.email);
  try {
    assertAllowedEmail(email);
  } catch {
    return null;
  }
  if (authConfig.requireEmailConfirmation && !user.email_confirmed_at) return null;

  const { profile, permissions } = await loadProfileAndPermissions(user.id);
  if (profile?.status === 'inactive') return null;

  return {
    id: 'supabase-cookie',
    email,
    user: publicUserFromSupabase(user, profile, permissions),
  };
}

export async function signOutSupabase(req, res) {
  const accessToken = decodeURIComponent(getCookie(req, ACCESS_COOKIE) || '');
  const client = authClientForUserSession();
  if (client && accessToken) {
    await client.auth.signOut({ scope: 'local' }).catch(() => null);
  }
  clearAuthCookies(res);
}

export function requirePrivilegedSupabase() {
  if (!supabase || !supabaseKeyIsPrivileged) {
    const error = new Error('Operacao exige SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY no backend.');
    error.status = 503;
    throw error;
  }
}
