/**
 * access-store.js - Persistencia local de usuarios e permissoes.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isConfigured as supabaseConfigured, supabase } from '../lib/supabaseServer.js';
import { authConfig, assertAllowedEmail } from '../lib/authConfig.js';
import { requirePrivilegedSupabase } from '../lib/appAuthService.js';
import {
  ACCESS_MODULES,
  ACCESS_PROFILE_CODES,
  ACCESS_PROFILES,
  MENU_PERMISSIONS,
  canManageAccess,
  normalizeAccessProfile,
  permissionsForProfile,
} from '../lib/appPermissions.js';

const DATA_DIR = path.resolve(process.cwd(), '.local-data');
const USERS_FILE = path.join(DATA_DIR, 'access-users.json');
const ACCESS_TABLE = 'rja_access_users';
const ACCESS_GRANTS_TABLE = 'access_grants';
const IS_SERVERLESS = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.NODE_ENV === 'production';
const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

const ROLE_CODES = [...ACCESS_PROFILE_CODES, 'full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba'];
const FIXED_ACCESS_PROFILE_CODES = new Set(ACCESS_PROFILE_CODES);
const STORAGE_ROLE_FALLBACKS = Object.freeze({
  dev_qa: ['dev_qa', 'visualizacao'],
  gestao: ['gestao', 'master'],
  diretoria: ['diretoria', 'full'],
});

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
    role: 'diretoria',
    status: 'active',
    permissions: permissionsForProfile('diretoria'),
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
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

function normalizeRole(role) {
  const normalized = normalizeAccessProfile(role);
  if (ROLE_CODES.includes(normalized)) return normalized;
  return /^[a-z0-9_.-]{2,60}$/.test(normalized) ? normalized : 'dev_qa';
}

function normalizeStatus(status) {
  return status === 'inactive' ? 'inactive' : 'active';
}

function normalizePermissions(role, permissions = []) {
  const profilePermissions = permissionsForProfile(role);
  if (profilePermissions.length) return profilePermissions;
  return [...new Set(permissions.filter(permission => MENU_PERMISSIONS.includes(permission)))];
}

function dbProfileToUser(row, permissions = []) {
  const role = normalizeRole(row.primary_role);
  const name = row.display_name || '';
  return {
    id: row.user_id,
    name: name || row.email,
    login: row.email,
    email: row.email,
    role,
    profileCode: role,
    profileName: ACCESS_PROFILES.find(profile => profile.code === role)?.name || role,
    status: normalizeStatus(row.status),
    permissions: normalizePermissions(role, permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbGrantToUser(row) {
  const role = normalizeRole(row.primary_role);
  const displayName = String(row.display_name || '').trim();
  return {
    id: `grant:${row.email}`,
    name: displayName || row.email,
    login: row.email,
    email: row.email,
    role,
    profileCode: role,
    profileName: ACCESS_PROFILES.find(profile => profile.code === role)?.name || role,
    status: normalizeStatus(row.status),
    permissions: normalizePermissions(role, row.permissions || []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingFirstLogin: true,
  };
}

async function roleIdFor(code) {
  const roleCode = await roleCodeForStorage(code);
  const { data, error } = await supabase
    .from('roles')
    .select('id')
    .eq('code', roleCode)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Perfil ${roleCode} nao encontrado. Aplique a migration oficial de Auth/RLS.`);
  return data.id;
}

async function roleCodeForStorage(code) {
  const roleCode = normalizeRole(code);
  const candidates = STORAGE_ROLE_FALLBACKS[roleCode] || [roleCode];
  const { data, error } = await supabase
    .from('roles')
    .select('code')
    .in('code', candidates);
  if (error) throw error;
  const available = new Set((data || []).map(row => row.code));
  return candidates.find(candidate => available.has(candidate)) || roleCode;
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

async function listAccessGrants() {
  requirePrivilegedSupabase();
  const { data, error } = await supabase
    .from(ACCESS_GRANTS_TABLE)
    .select('email,display_name,status,primary_role,permissions,created_at,updated_at')
    .order('created_at', { ascending: true });
  if (error && /does not exist|schema cache/i.test(error.message || '')) return [];
  if (error) throw error;
  return (data || []).map(dbGrantToUser);
}

async function listAccessProfiles() {
  if (authConfig.provider !== 'supabase') {
    return ACCESS_PROFILES.map(profile => profileSummary(profile, []));
  }

  requirePrivilegedSupabase();
  const [users, grants, roleRows, rolePermissionRows] = await Promise.all([
    listUsersFromSupabaseAuth().catch(() => []),
    listAccessGrants().catch(() => []),
    supabase.from('roles').select('id,code,name,description,created_at').order('created_at', { ascending: true }).then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
    supabase.from('role_permissions').select('role_id, permissions:permission_id(code,name,module)').then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  ]);
  const linkedUsers = [...users, ...grants];
  const rolePermissions = new Map();
  rolePermissionRows.forEach(row => {
    if (!rolePermissions.has(row.role_id)) rolePermissions.set(row.role_id, new Set());
    if (row.permissions?.code) rolePermissions.get(row.role_id).add(row.permissions.code);
  });
  const rowsByCode = new Map(roleRows.map(row => [normalizeRole(row.code), row]));
  return ACCESS_PROFILES.map(profile => {
    const row = rowsByCode.get(profile.code);
    return profileSummary({
      code: profile.code,
      name: profile.name,
      description: row?.description || profile.description || '',
      permissionCodes: row?.id ? [...(rolePermissions.get(row.id) || [])] : undefined,
    }, linkedUsers);
  });
}

function profileSummary(profile, linkedUsers = []) {
  const usersForProfile = linkedUsers.filter(user => normalizeRole(user.role) === profile.code);
  const permissions = ACCESS_MODULES.map(item => ({
    code: item.code,
    module: item.module,
    submodule: item.submodule,
    label: item.label,
    level: item.levels?.[profile.code] || 'deny',
    scope: item.scope || null,
  }));
  return {
    ...profile,
    userCount: usersForProfile.length,
    permissions,
    allowedModules: permissions.filter(item => item.level === 'allow' || item.level === 'partial'),
    blockedModules: permissions.filter(item => item.level === 'deny'),
  };
}

function profileCodeFromName(name = '') {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || `perfil_${Date.now()}`;
}

async function upsertAccessProfile(input = {}) {
  requirePrivilegedSupabase();
  const name = String(input.name || '').trim();
  if (!name) {
    const error = new Error('Nome do perfil e obrigatorio.');
    error.status = 400;
    throw error;
  }
  const code = normalizeRole(input.code || profileCodeFromName(name));
  if (!FIXED_ACCESS_PROFILE_CODES.has(code)) {
    const error = new Error('Perfil invalido. Use apenas Diretoria, Gestao ou Dev/QA.');
    error.status = 400;
    throw error;
  }
  const storageCode = await roleCodeForStorage(code);
  const description = String(input.description || '').trim();
  const selectedPermissions = permissionsForProfile(code);

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .upsert({ code: storageCode, name, description }, { onConflict: 'code' })
    .select('id,code,name,description')
    .single();
  if (roleError) throw roleError;

  const { error: deleteError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', role.id);
  if (deleteError) throw deleteError;

  if (selectedPermissions.length) {
    const { data: permissionRows, error: permissionError } = await supabase
      .from('permissions')
      .select('id,code')
      .in('code', selectedPermissions);
    if (permissionError) throw permissionError;

    const rows = (permissionRows || []).map(permission => ({
      role_id: role.id,
      permission_id: permission.id,
    }));
    if (rows.length) {
      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(rows);
      if (insertError) throw insertError;
    }
  }

  await auditAccessChange(input.actorUserId, 'role.upsert', code, { code, name, permissions: selectedPermissions });
  return profileSummary({ code, name, description: role.description || description, permissionCodes: selectedPermissions }, await listUsers());
}

async function upsertAccessGrant(input = {}) {
  requirePrivilegedSupabase();
  const email = assertAllowedEmail(input.login || input.email);
  const role = normalizeRole(input.role);
  const storageRole = await roleCodeForStorage(role);
  const displayName = String(input.name || '').trim();
  const status = normalizeStatus(input.status);
  const permissions = normalizePermissions(role, input.permissions);
  const grant = {
    email,
    display_name: displayName,
    status,
    primary_role: storageRole,
    permissions,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from(ACCESS_GRANTS_TABLE)
    .upsert(grant, { onConflict: 'email' });
  if (error) throw error;

  const { data: profile, error: profileLookupError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (profileLookupError && !/does not exist|schema cache/i.test(profileLookupError.message || '')) throw profileLookupError;

  if (profile?.user_id) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        ...(displayName ? { display_name: displayName } : {}),
        status,
        primary_role: storageRole,
      })
      .eq('user_id', profile.user_id);
    if (profileError) throw profileError;
    await replaceUserRole(profile.user_id, role);
    await replaceCustomPermissions(profile.user_id, role, permissions);
    await auditAccessChange(input.actorUserId, 'profile.update', profile.user_id, { email, role });
    return findProfileById(profile.user_id);
  }

  await auditAccessChange(input.actorUserId, 'access_grant.upsert', email, { email, role });
  return dbGrantToUser({ ...grant, created_at: new Date().toISOString() });
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

async function deleteUserAccessRows(userId) {
  if (!userId) return;
  for (const table of ['user_permissions', 'user_roles']) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId);
    if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
  }
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('user_id', userId);
  if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
}

async function listUsers() {
  if (authConfig.provider === 'supabase') {
    const [profiles, grants] = await Promise.all([listUsersFromSupabaseAuth(), listAccessGrants()]);
    const profileEmails = new Set(profiles.map(user => user.login.toLowerCase()));
    return [
      ...profiles,
      ...grants.filter(grant => !profileEmails.has(grant.login.toLowerCase())),
    ];
  }
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
  if (authConfig.provider === 'supabase' && String(id || '').startsWith('grant:')) {
    const email = String(id).slice('grant:'.length);
    return (await listAccessGrants()).find(user => user.login.toLowerCase() === email.toLowerCase()) || null;
  }
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
    return upsertAccessGrant(input);
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
    if (String(id || '').startsWith('grant:')) {
      return upsertAccessGrant(input);
    }
    const login = assertAllowedEmail(input.login || input.email);
    const name = String(input.name || '').trim();
    const password = String(input.password || '');
    const role = normalizeRole(input.role);
    const storageRole = await roleCodeForStorage(role);
    if (!login) {
      const error = new Error('Email e obrigatorio.');
      error.status = 400;
      throw error;
    }

    const authChanges = { email: login, email_confirm: true };
    if (name) authChanges.user_metadata = { name };
    if (password) authChanges.password = password;

    const { error: authError } = await supabase.auth.admin.updateUserById(id, authChanges);
    if (authError) throw authError;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        email: login,
        ...(name ? { display_name: name } : {}),
        status: normalizeStatus(input.status),
        primary_role: storageRole,
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
  if (!login) {
    const error = new Error('Login e obrigatorio.');
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
    name: name || login,
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
    if (String(id || '').startsWith('grant:')) {
      const email = String(id).slice('grant:'.length);
      const { error } = await supabase
        .from(ACCESS_GRANTS_TABLE)
        .delete()
        .eq('email', email);
      if (error) throw error;
      await auditAccessChange(actorUserId, 'access_grant.delete', email);
      return null;
    }

    const { data: profile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', id)
      .maybeSingle();
    if (profileLookupError && !/does not exist|schema cache/i.test(profileLookupError.message || '')) throw profileLookupError;

    if (profile?.email) {
      const { error: grantError } = await supabase
        .from(ACCESS_GRANTS_TABLE)
        .delete()
        .eq('email', profile.email);
      if (grantError && !/does not exist|schema cache/i.test(grantError.message || '')) throw grantError;
    }

    await deleteUserAccessRows(id);
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError && !/User not found/i.test(authError.message || '')) throw authError;

    await auditAccessChange(actorUserId, 'profile.delete', id, { email: profile?.email || null });
    return null;
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
  listAccessProfiles,
  upsertAccessProfile,
  revokeUser,
  safeUser,
  updateUser,
};
