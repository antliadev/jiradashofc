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

function authClientForTokenSession(accessToken, refreshToken = '') {
  const client = authClientForUserSession();
  if (!client || !accessToken) return null;
  return client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  }).then(result => ({ client, result }));
}

async function findAccessGrantByEmail(email) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('access_grants')
    .select('email,display_name,status,primary_role,permissions')
    .eq('email', normalizeEmail(email))
    .maybeSingle();
  if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
  return data || null;
}

async function roleIdFor(code) {
  const { data, error } = await supabase
    .from('roles')
    .select('id')
    .eq('code', code || 'visualizacao')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Perfil ${code} nao encontrado. Aplique a migration oficial de Auth/RLS.`);
  return data.id;
}

async function replaceGrantedRoleAndPermissions(userId, grant) {
  const role = grant.primary_role || 'visualizacao';
  const roleId = await roleIdFor(role);
  const { error: deleteRoleError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);
  if (deleteRoleError) throw deleteRoleError;

  const { error: insertRoleError } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role_id: roleId });
  if (insertRoleError) throw insertRoleError;

  const { error: deletePermissionError } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId);
  if (deletePermissionError) throw deletePermissionError;

  if (role !== 'personalizado' || !Array.isArray(grant.permissions) || !grant.permissions.length) return;

  const { data: permissionRows, error: permissionLookupError } = await supabase
    .from('permissions')
    .select('id,code')
    .in('code', grant.permissions);
  if (permissionLookupError) throw permissionLookupError;

  const rows = (permissionRows || []).map(permission => ({
    user_id: userId,
    permission_id: permission.id,
  }));
  if (!rows.length) return;

  const { error: insertPermissionError } = await supabase
    .from('user_permissions')
    .insert(rows);
  if (insertPermissionError) throw insertPermissionError;
}

async function upsertProfileFromGrant(user, grant) {
  if (!supabase || !grant) return null;
  const { error } = await supabase
    .from('profiles')
    .upsert({
      user_id: user.id,
      email: normalizeEmail(user.email),
      display_name: grant.display_name || user.user_metadata?.name || user.email,
      status: grant.status || 'active',
      primary_role: grant.primary_role || 'visualizacao',
      last_login_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;
  await replaceGrantedRoleAndPermissions(user.id, grant);
  return {
    user_id: user.id,
    email: normalizeEmail(user.email),
    display_name: grant.display_name || user.user_metadata?.name || user.email,
    status: grant.status || 'active',
    primary_role: grant.primary_role || 'visualizacao',
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

async function loadGrantedSessionUser(user) {
  const email = assertAllowedEmail(user.email);
  if (authConfig.requireEmailConfirmation && !user.email_confirmed_at) {
    const authError = new Error('Confirme o email antes de acessar o JiraDash.');
    authError.status = 403;
    authError.code = 'AUTH_EMAIL_NOT_CONFIRMED';
    throw authError;
  }

  let { profile, permissions } = await loadProfileAndPermissions(user.id);
  if (!profile) {
    const grant = await findAccessGrantByEmail(email);
    if (!grant || grant.status === 'inactive') {
      const authError = new Error('Email nao liberado na Gestao de Acessos.');
      authError.status = 403;
      authError.code = 'AUTH_EMAIL_NOT_GRANTED';
      throw authError;
    }
    profile = await upsertProfileFromGrant(user, grant);
    permissions = Array.isArray(grant.permissions) ? grant.permissions : [];
  }

  if (profile?.status === 'inactive') {
    const authError = new Error('Usuario inativo.');
    authError.status = 403;
    throw authError;
  }

  return { email, profile, permissions };
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

  const { profile, permissions } = await loadGrantedSessionUser(data.user);

  setAuthCookies(res, data.session);
  return {
    sessionId: 'supabase-cookie',
    email: data.user.email,
    user: publicUserFromSupabase(data.user, profile, permissions),
  };
}

export async function signInWithSupabaseOAuthTokens(accessToken, refreshToken, res) {
  const tokenSession = await authClientForTokenSession(accessToken, refreshToken);
  if (!tokenSession) {
    const error = new Error('Supabase Auth nao configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.');
    error.status = 503;
    throw error;
  }

  const { result } = tokenSession;
  if (result.error || !result.data?.session?.access_token || !result.data?.user) {
    const authError = new Error(result.error?.message || 'Sessao Google invalida.');
    authError.status = 401;
    throw authError;
  }

  const { profile, permissions } = await loadGrantedSessionUser(result.data.user);
  setAuthCookies(res, result.data.session);
  return {
    sessionId: 'supabase-cookie',
    email: result.data.user.email,
    user: publicUserFromSupabase(result.data.user, profile, permissions),
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

  let grantedSession;
  try {
    grantedSession = await loadGrantedSessionUser(user);
  } catch {
    return null;
  }

  return {
    id: 'supabase-cookie',
    email,
    user: publicUserFromSupabase(user, grantedSession.profile, grantedSession.permissions),
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
