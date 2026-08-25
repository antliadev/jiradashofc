export const MENU_PERMISSIONS = [
  'dashboard',
  'executive',
  'contracts.crawford',
  'contracts.docwise',
  'monitoring.overdue',
  'monitoring.blocked',
  'gantt',
  'projects.kanban',
  'projects.health',
  'projects.executive',
  'projects.detailed',
  'analysts.general',
  'analysts.comparative',
  'analysts.evolution',
  'data',
];

export function isFull(user) {
  return user?.role === 'full' && user?.status === 'active';
}

export function isMaster(user) {
  return user?.role === 'master' && user?.status === 'active';
}

export function canManageAccess(user) {
  return isFull(user);
}

export function canAccessPermission(user, permission) {
  if (!permission) return true;
  if (!user || user.status !== 'active') return false;
  if (permission === 'access.manage') return canManageAccess(user);
  if (isFull(user) || isMaster(user)) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function permissionForJiraRequest(req) {
  const path = String(req.path || req.url || '').split('?')[0];
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
  if (/^\/analysts/.test(path)) return 'analysts.general';
  if (/^\/statuses/.test(path)) return 'dashboard';
  if (/^\/metrics/.test(path)) return 'dashboard';
  if (/^\/board/.test(path)) return 'projects.kanban';
  if (/^\/dashboard/.test(path)) return 'dashboard';
  return 'dashboard';
}
