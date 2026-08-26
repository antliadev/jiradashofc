/**
 * access-control.js - Regras de perfis e permissoes de navegação.
 */
const CURRENT_USER_KEY = 'rja.currentUser';
const HOME_ROUTE = '/home';

const ACCESS_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', route: '/' },
  { id: 'executive', label: 'Home', route: HOME_ROUTE },
  { id: 'contracts.crawford', label: 'Contratos / Crawford', route: '/contracts/crawford' },
  { id: 'contracts.docwise', label: 'Contratos / Docwise', route: '/contracts/docwise' },
  { id: 'monitoring.overdue', label: 'Monitoramento / Cards em Atraso', route: '/monitoring/overdue' },
  { id: 'monitoring.blocked', label: 'Monitoramento / Cards Bloqueados', route: '/monitoring/blocked' },
  { id: 'gantt', label: 'Gantt', route: '/gantt' },
  { id: 'projects.kanban', label: 'Projetos / Issues - Kanban', route: '/projects' },
  { id: 'projects.health', label: 'Projetos / Saude dos Cards', route: '/projects/health' },
  { id: 'projects.executive', label: 'Projetos / Relatorio Gerencial', route: '/projects/executive' },
  { id: 'projects.detailed', label: 'Projetos / Relatorio Detalhado', route: '/projects/detailed-report' },
  { id: 'analysts.general', label: 'Analistas / Geral', route: '/analysts/general' },
  { id: 'analysts.comparative', label: 'Analistas / Comparativo', route: '/analysts/comparative' },
  { id: 'analysts.evolution', label: 'Analistas / Evolucao', route: '/analysts/evolution' },
  { id: 'data', label: 'Dados', route: '/data' },
];

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
  '/projects/executive': 'projects.executive',
  '/projects/detailed-report': 'projects.detailed',
  '/analysts': 'analysts.general',
  '/analysts/general': 'analysts.general',
  '/analysts/comparative': 'analysts.comparative',
  '/analysts/evolution': 'analysts.evolution',
  '/data': 'data',
  '/access': 'access.manage',
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
  return user?.role === 'full' && user?.status === 'active';
}

function isMaster(user = getCurrentUser()) {
  return user?.role === 'master' && user?.status === 'active';
}

function canAccessPermission(permission, user = getCurrentUser()) {
  if (!permission) return true;
  // A ausencia de um usuario nunca pode liberar uma rota protegida. A
  // autenticacao e validada no backend, mas este bloqueio evita que menus e
  // paginas pisquem ou sejam renderizados com um estado local incompleto.
  if (!user || user.status !== 'active') return false;
  if (permission === 'access.manage') return isFull(user);
  if (isFull(user) || isMaster(user)) return true;
  if (!['custom', 'personalizado', 'visualizacao'].includes(user.role)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function canAccessRoute(path, user = getCurrentUser()) {
  const permission = ROUTE_PERMISSION[normalizePath(path)];
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
