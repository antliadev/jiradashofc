/**
 * access-control.js - Regras de perfis e permissoes de navegação.
 */
import {
  ACCESS_MANAGE_PERMISSION,
  ACCESS_MODULES,
  ACCESS_PROFILES,
  canProfileManageAccess,
  normalizeAccessProfile,
  permissionLevelForProfile,
} from '../../shared/access-rbac.js';

const CURRENT_USER_KEY = 'rja.currentUser';
const HOME_ROUTE = '/home';

const ACCESS_ITEMS = ACCESS_MODULES.filter(item => item.route && !item.code.startsWith('access.')).map(item => ({
  id: item.code,
  label: item.label,
  route: item.route,
}));

const ROUTE_PERMISSION = {
  '/': 'dashboard',
  [HOME_ROUTE]: 'executive',
  '/executive': 'executive',
  '/contracts/crawford': 'contracts.crawford',
  '/contracts/docwise': 'contracts.docwise',
  '/monitoring/overdue': 'monitoring.overdue',
  '/monitoring/blocked': 'monitoring.blocked',
  '/gantt': 'gantt',
  '/projects': 'projects.kanban',
  '/board': 'projects.kanban',
  '/projects/health': 'projects.health',
  '/projects/resource-allocation': 'projects.resource-allocation',
  '/projects/sprint-plan': 'projects.sprint-plan',
  '/projects/sprint-review': 'projects.sprint-review',
  '/projects/executive': 'projects.executive',
  '/projects/detailed-report': 'projects.detailed',
  '/analysts': 'analysts.general',
  '/analysts/general': 'analysts.general',
  '/analysts/comparative': 'analysts.comparative',
  '/analysts/evolution': 'analysts.evolution',
  '/data': 'data',
  '/access': ACCESS_MANAGE_PERMISSION,
};

function normalizePath(path) {
  return (path || '/').split('?')[0] || '/';
}

function setCurrentUser(user) {
  if (!user) {
    localStorage.removeItem(CURRENT_USER_KEY);
    return;
  }
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function isFull(user = getCurrentUser()) {
  return user?.status === 'active' && canProfileManageAccess(user?.role);
}

function canAccessPermission(permission, user = getCurrentUser()) {
  if (!permission) return false;
  // A ausencia de um usuario nunca pode liberar uma rota protegida. A
  // autenticacao e validada no backend, mas este bloqueio evita que menus e
  // paginas pisquem ou sejam renderizados com um estado local incompleto.
  if (!user || user.status !== 'active') return false;
  if (permission === ACCESS_MANAGE_PERMISSION) return isFull(user);
  const profileLevel = permissionLevelForProfile(user.role, permission);
  if (profileLevel === 'allow' || profileLevel === 'partial') return true;
  if (ACCESS_PROFILES.some(profile => profile.code === normalizeAccessProfile(user.role))) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function canAccessRoute(path, user = getCurrentUser()) {
  const normalizedPath = normalizePath(path);
  const permission = ROUTE_PERMISSION[normalizedPath]
    || (normalizedPath.startsWith('/executive/') ? ROUTE_PERMISSION['/executive'] : null);
  return canAccessPermission(permission, user);
}

function firstAllowedRoute(user = getCurrentUser()) {
  if (!user || user.status !== 'active') return '/login';
  if (canAccessPermission('executive', user)) return HOME_ROUTE;
  if (isFull(user)) return '/';
  return ACCESS_ITEMS.find(item => canAccessPermission(item.id, user))?.route || '/login';
}

export {
  ACCESS_ITEMS,
  HOME_ROUTE,
  canAccessPermission,
  canAccessRoute,
  firstAllowedRoute,
  getCurrentUser,
  setCurrentUser,
};
