import {
  ACCESS_MANAGE_PERMISSION,
  ACCESS_MODULES,
  ACCESS_PROFILES,
  canProfileManageAccess,
  hasPartialSelfScope,
  normalizeAccessProfile,
  permissionLevelForProfile,
  permissionsForProfile,
} from '../shared/access-rbac.js';

export const MENU_PERMISSIONS = ACCESS_MODULES.map(item => item.code);
export const ACCESS_PROFILE_CODES = ACCESS_PROFILES.map(profile => profile.code);
export { ACCESS_MODULES, ACCESS_PROFILES, hasPartialSelfScope, normalizeAccessProfile, permissionsForProfile };

export function isFull(user) {
  return user?.status === 'active' && canProfileManageAccess(user?.role);
}

export function isMaster(user) {
  return user?.status === 'active' && normalizeAccessProfile(user?.role) === 'gestao';
}

export function canManageAccess(user) {
  return user?.status === 'active' && canProfileManageAccess(user?.role);
}

export function canAccessPermission(user, permission) {
  if (!permission) return false;
  if (!user || user.status !== 'active') return false;
  if (permission === ACCESS_MANAGE_PERMISSION) return canManageAccess(user);
  const profileLevel = permissionLevelForProfile(user.role, permission);
  if (profileLevel === 'allow' || profileLevel === 'partial') return true;
  if (ACCESS_PROFILE_CODES.includes(normalizeAccessProfile(user.role))) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function permissionForJiraRequest(req) {
  const path = String(req.path || req.url || '').split('?')[0];
  if (/^\/sprint-plan(?:\/|$)/.test(path)) return 'projects.sprint-plan';
  if (/^\/sprint-review(?:\/|$)/.test(path)) return 'projects.sprint-review';
  if (/^\/resource-allocation(?:\/|$)/.test(path)) return 'projects.resource-allocation';
  if (/^\/system\/status/.test(path)) return 'data';
  if (/^\/config/.test(path)) return 'data';
  if (/^\/test-connection/.test(path)) return 'data';
  if (/^\/sync/.test(path)) return 'data';
  if (/^\/cache/.test(path)) return 'data';
  if (/^\/hours-dashboard/.test(path)) {
    const projectKey = String(req.query?.projectKey || '').toUpperCase();
    return projectKey === 'DOCW' ? 'contracts.docwise' : 'contracts.crawford';
  }
  if (/^\/project-metadata/.test(path)) return req.method === 'GET' ? 'projects.kanban' : 'data';
  if (/^\/issues/.test(path)) return 'projects.kanban';
  if (/^\/projects/.test(path)) return 'projects.kanban';
  if (/^\/analysts\/evolution$/.test(path)) return 'analysts.evolution';
  if (/^\/analysts\/comparative$/.test(path)) return 'analysts.comparative';
  if (/^\/analysts(?:\/general)?$/.test(path)) return 'analysts.general';
  if (/^\/statuses/.test(path)) return 'dashboard';
  if (/^\/metrics/.test(path)) return 'dashboard';
  if (/^\/board/.test(path)) return 'projects.kanban';
  if (/^\/dashboard/.test(path)) return 'dashboard';
  return '__unrecognized_endpoint__';
}
