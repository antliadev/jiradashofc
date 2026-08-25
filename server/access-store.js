/**
 * access-store.js - Persistencia local de usuarios e permissoes.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isConfigured as supabaseConfigured, supabase } from '../lib/supabaseServer.js';
import { authConfig, assertAllowedEmail } from '../lib/authConfig.js';
import { requirePrivilegedSupabase } from '../lib/appAuthService.js';
import { MENU_PERMISSIONS, canManageAccess } from '../lib/appPermissions.js';

const DATA_DIR = path.resolve(process.cwd(), '.local-data');
const USERS_FILE = path.join(DATA_DIR, 'access-users.json');
const ACCESS_TABLE = 'rja_access_users';
const IS_SERVERLESS = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.NODE_ENV === 'production';
const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

const ROLE_CODES = ['full', 'master', 'visualizacao', 'personalizado'];
const LEGACY_ROLE_MAP = { custom: 'personalizado' };

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `pbkdf2:${ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [, iterations, salt, hash] = String(storedHash || '').split(':');
  if (!iterations || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(String(password), salt, Number(iterations), KEY_LENGTH, DIGEST).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function defaultAdmin() {
  const login = process.env.AUTH_EMAIL;
  const password = process.env.AUTH_PASSWORD;
  if (!login || !password) {
    throw new Error('AUTH_EMAIL e AUTH_PASSWORD precisam estar definidos para o fallback legado de acesso.');
  }
  return {
    id: crypto.randomUUID(),
    name: 'Administrador',
    login,
    passwordHash: hashPassword(password),
    role: 'full',
    status: 'active',
    permissions: [...MENU_PERMISSIONS],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function dbToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function userToDb(user) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    password_hash: user.passwordHash,
    role: user.role,
    status: user.status,
    permissions: user.permissions || [],
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

async function readUsersFromSupabase() {
  const { data, error } = await supabase
    .from(ACCESS_TABLE)
    .select('id,name,login,password_hash,role,status,permissions,created_at,updated_at')
    .order('created_at', { ascending: true });

  if (error) throw error;
  const users = (data || []).map(dbToUser).filter(Boolean);
  if (users.length) return users;

  const admin = defaultAdmin();
  const { error: insertError } = await supabase
    .from(ACCESS_TABLE)
    .insert(userToDb(admin));
  if (insertError) throw insertError;
  return [admin];
}

async function writeUsersToSupabase(users) {
  for (const user of users) {
    const { error } = await supabase
      .from(ACCESS_TABLE)
      .upsert(userToDb(user), { onConflict: 'id' });
    if (error) throw error;
  }
}

function shouldUseSupabase() {
  return supabaseConfigured && IS_SERVERLESS;
}

function readUsersRawLocal() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) {
    const users = [defaultAdmin()];
    writeUsersRawLocal(users);
    return users;
  }
  const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function writeUsersRawLocal(users) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

async function readUsersRaw() {
  if (shouldUseSupabase()) {
    try {
      return await readUsersFromSupabase();
    } catch (error) {
      console.error('[AccessStore] Falha ao ler Supabase:', error.message);
      return [defaultAdmin()];
    }
  }
  return readUsersRawLocal();
}

async function writeUsersRaw(users) {
  if (shouldUseSupabase()) {
    await writeUsersToSupabase(users);
    return;
  }
  writeUsersRawLocal(users);
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

function normalizeRole(role) {
  const normalized = LEGACY_ROLE_MAP[role] || role;
  return ROLE_CODES.includes(normalized) ? normalized : 'personalizado';
}

function normalizeStatus(status) {
  return status === 'inactive' ? 'inactive' : 'active';
}

function normalizePermissions(role, permissions = []) {
  if (role === 'full' || role === 'master') return [...MENU_PERMISSIONS];
  if (role === 'visualizacao') {
    return MENU_PERMISSIONS.filter(permission => permission !== 'data');
  }
  return [...new Set(permissions.filter(permission => MENU_PERMISSIONS.includes(permission)))];
}

function dbProfileToUser(row, permissions = []) {
  const role = normalizeRole(row.primary_role);
  return {
    id: row.user_id,
    name: row.display_name || row.email,
    login: row.email,
    email: row.email,
    role,
    status: normalizeStatus(row.status),
    permissions: normalizePermissions(role, permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function roleIdFor(code) {
  const roleCode = normalizeRole(code);
  const { data, error } = await supabase
    .from('roles')
    .select('id')
    .eq('code', roleCode)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Perfil ${roleCode} nao encontrado. Aplique a migration oficial de Auth/RLS.`);
  return data.id;
}

async function permissionCodesForUser(userId) {
  const { data, error } = await supabase
    .from('user_effective_permissions')
    .select('permission_code')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).map(row => row.permission_code).filter(Boolean);
}

async function listUsersFromSupabaseAuth() {
  requirePrivilegedSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,display_name,status,primary_role,created_at,updated_at')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const users = [];
  for (const profile of data || []) {
    const permissions = await permissionCodesForUser(profile.user_id);
    users.push(dbProfileToUser(profile, permissions));
  }
  return users;
}

async function findProfileById(id) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,display_name,status,primary_role,created_at,updated_at')
    .eq('user_id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return dbProfileToUser(data, await permissionCodesForUser(data.user_id));
}

async function replaceUserRole(userId, role) {
  const roleId = await roleIdFor(role);
  const { error: deleteError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role_id: roleId });
  if (insertError) throw insertError;
}

async function replaceCustomPermissions(userId, role, permissions = []) {
  const { error: deleteError } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  if (normalizeRole(role) !== 'personalizado') return;
  const selected = normalizePermissions('personalizado', permissions);
  if (!selected.length) return;

  const { data: permissionRows, error: permissionError } = await supabase
    .from('permissions')
    .select('id,code')
    .in('code', selected);
  if (permissionError) throw permissionError;

  const rows = (permissionRows || []).map(permission => ({
    user_id: userId,
    permission_id: permission.id,
  }));
  if (!rows.length) return;

  const { error: insertError } = await supabase
    .from('user_permissions')
    .insert(rows);
  if (insertError) throw insertError;
}

async function auditAccessChange(actorUserId, action, targetId, metadata = {}) {
  if (!supabase) return;
  await supabase
    .from('audit_logs')
    .insert({
      actor_user_id: actorUserId || null,
      action,
      target_type: 'profile',
      target_id: targetId || null,
      metadata,
    })
    .throwOnError();
}

async function listUsers() {
  if (authConfig.provider === 'supabase') return listUsersFromSupabaseAuth();
  return (await readUsersRaw()).map(safeUser);
}

async function findUserByLogin(login) {
  if (authConfig.provider === 'supabase') {
    const users = await listUsersFromSupabaseAuth();
    return users.find(user => user.login.toLowerCase() === String(login || '').toLowerCase()) || null;
  }
  return (await readUsersRaw()).find(user => user.login.toLowerCase() === String(login || '').toLowerCase()) || null;
}

async function findUserById(id) {
  if (authConfig.provider === 'supabase') return findProfileById(id);
  return (await readUsersRaw()).find(user => user.id === id) || null;
}

async function authenticateUser(login, password) {
  const user = await findUserByLogin(login);
  if (!user || user.status !== 'active') return null;
  return verifyPassword(password, user.passwordHash) ? safeUser(user) : null;
}

async function createUser(input = {}) {
  if (authConfig.provider === 'supabase') {
    requirePrivilegedSupabase();
    const login = assertAllowedEmail(input.login || input.email);
    const name = String(input.name || '').trim();
    const role = normalizeRole(input.role);
    if (!name || !login) {
      const error = new Error('Nome e email sao obrigatorios.');
      error.status = 400;
      throw error;
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(login, {
      data: { name },
    });
    if (error) throw error;

    const userId = data?.user?.id;
    if (!userId) throw new Error('Supabase nao retornou o usuario convidado.');

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        email: login,
        display_name: name,
        status: normalizeStatus(input.status),
        primary_role: role,
      }, { onConflict: 'user_id' });
    if (profileError) throw profileError;

    await replaceUserRole(userId, role);
    await replaceCustomPermissions(userId, role, input.permissions);
    await auditAccessChange(input.actorUserId, 'profile.invite', userId, { email: login, role });
    return findProfileById(userId);
  }

  const users = await readUsersRaw();
  const login = String(input.login || '').trim();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  const role = normalizeRole(input.role);

  if (!name || !login || !password) {
    const error = new Error('Nome, login e senha sao obrigatorios.');
    error.status = 400;
    throw error;
  }
  if (users.some(user => user.login.toLowerCase() === login.toLowerCase())) {
    const error = new Error('Login ja cadastrado.');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name,
    login,
    passwordHash: hashPassword(password),
    role,
    status: normalizeStatus(input.status),
    permissions: normalizePermissions(role, input.permissions),
    createdAt: now,
    updatedAt: now,
  };
  users.push(user);
  await writeUsersRaw(users);
  return safeUser(user);
}

async function updateUser(id, input = {}) {
  if (authConfig.provider === 'supabase') {
    requirePrivilegedSupabase();
    const login = assertAllowedEmail(input.login || input.email);
    const name = String(input.name || '').trim();
    const role = normalizeRole(input.role);
    if (!name || !login) {
      const error = new Error('Nome e email sao obrigatorios.');
      error.status = 400;
      throw error;
    }

    const { error: authError } = await supabase.auth.admin.updateUserById(id, {
      email: login,
      user_metadata: { name },
    });
    if (authError) throw authError;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        email: login,
        display_name: name,
        status: normalizeStatus(input.status),
        primary_role: role,
      })
      .eq('user_id', id);
    if (profileError) throw profileError;

    await replaceUserRole(id, role);
    await replaceCustomPermissions(id, role, input.permissions);
    await auditAccessChange(input.actorUserId, 'profile.update', id, { email: login, role });
    return findProfileById(id);
  }

  const users = await readUsersRaw();
  const index = users.findIndex(user => user.id === id);
  if (index < 0) {
    const error = new Error('Usuario nao encontrado.');
    error.status = 404;
    throw error;
  }
  const login = String(input.login || '').trim();
  const name = String(input.name || '').trim();
  const role = normalizeRole(input.role);
  if (!name || !login) {
    const error = new Error('Nome e login sao obrigatorios.');
    error.status = 400;
    throw error;
  }
  if (users.some(user => user.id !== id && user.login.toLowerCase() === login.toLowerCase())) {
    const error = new Error('Login ja cadastrado.');
    error.status = 409;
    throw error;
  }

  users[index] = {
    ...users[index],
    name,
    login,
    role,
    status: normalizeStatus(input.status),
    permissions: normalizePermissions(role, input.permissions),
    updatedAt: new Date().toISOString(),
  };

  if (input.password) {
    users[index].passwordHash = hashPassword(input.password);
  }

  await writeUsersRaw(users);
  return safeUser(users[index]);
}

async function revokeUser(id, actorUserId = null) {
  if (authConfig.provider === 'supabase') {
    requirePrivilegedSupabase();
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ status: 'inactive' })
      .eq('user_id', id);
    if (profileError) throw profileError;

    const { error: authError } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: '876000h',
    });
    if (authError) throw authError;

    await auditAccessChange(actorUserId, 'profile.revoke', id);
    return findProfileById(id);
  }

  const users = await readUsersRaw();
  const index = users.findIndex(user => user.id === id);
  if (index < 0) {
    const error = new Error('Usuario nao encontrado.');
    error.status = 404;
    throw error;
  }
  users[index] = {
    ...users[index],
    status: 'inactive',
    updatedAt: new Date().toISOString(),
  };
  await writeUsersRaw(users);
  return safeUser(users[index]);
}

export {
  MENU_PERMISSIONS,
  authenticateUser,
  canManageAccess,
  createUser,
  findUserById,
  listUsers,
  revokeUser,
  safeUser,
  updateUser,
};
