/**
 * main.js — Ponto de entrada da aplicação
 * Autenticação opcional quando credenciais do Jira estão configuradas
 */
import './styles/main.css';
import { initRouter, registerRoute, setNotFound, setAuthGuard } from './utils/router.js';
import { renderSidebar } from './components/sidebar.js';
import { dataService } from './data/data-service.js';
import { canAccessRoute, firstAllowedRoute, getCurrentUser, HOME_ROUTE, setCurrentUser } from './utils/access-control.js';
import { sanitize } from './utils/helpers.js';
import { getTheme, toggleTheme } from './utils/theme.js';
import { renderPageLoading } from './utils/ui-feedback.js';
import { initSelectLists } from './utils/select-list.js';

initSelectLists();
dataService.subscribe(() => {
  if (!document.getElementById('sidebar')?.classList.contains('hidden')) {
    renderSidebar();
  }
});

// Rotas públicas (não requerem autenticação)
const publicRoutes = ['/login'];
const dataRoutes = new Set([
  HOME_ROUTE,
  '/',
  '/projects',
  '/projects/executive',
  '/projects/health',
  '/projects/detailed-report',
  '/cards',
  '/monitoring/overdue',
  '/monitoring/blocked',
  '/analysts',
  '/analysts/general',
  '/analysts/comparative',
  '/analysts/evolution',
  '/board',
  '/executive',
  '/gantt',
]);
const AUTH_CACHE_TTL_MS = 30000;
let authCache = {
  authenticated: false,
  checkedAt: 0
};
let authValidationPromise = null;
const RECOVERY_STORAGE_KEY = 'rja.auth.recovery';

function normalizePath(path) {
  return (path || '/').split('?')[0] || '/';
}

function captureSupabaseRecoveryState() {
  const searchParams = new URLSearchParams(window.location.search || '');
  const hash = window.location.hash || '';
  let authParams = null;

  if (hash.startsWith('#access_token=') || hash.startsWith('#error=')) {
    authParams = new URLSearchParams(hash.slice(1));
  } else if (searchParams.get('type') === 'recovery' || searchParams.get('error')) {
    authParams = searchParams;
  }

  if (!authParams) return;

  const recoveryState = {
    accessToken: authParams.get('access_token') || '',
    refreshToken: authParams.get('refresh_token') || '',
    type: authParams.get('type') || '',
    error: authParams.get('error') || '',
    errorCode: authParams.get('error_code') || '',
    errorDescription: authParams.get('error_description') || '',
  };

  if (
    !recoveryState.accessToken &&
    !recoveryState.refreshToken &&
    !recoveryState.error &&
    recoveryState.type !== 'recovery'
  ) {
    return;
  }

  sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(recoveryState));
  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  window.location.hash = '#/login?recovery=1';
}

function renderDataLoading() {
  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');
  if (header) {
    header.innerHTML = `
      <div>
        <h2>Carregando dados</h2>
        <div class="subtitle">Lendo dados persistidos no Supabase</div>
      </div>
    `;
  }
  if (content) {
    content.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  }
}

function renderDataLoadError(error) {
  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');
  if (header) {
    header.innerHTML = `
      <div>
        <h2>Falha ao carregar dados</h2>
        <div class="subtitle">Dashboard depende do Supabase como fonte principal</div>
      </div>
    `;
  }
  if (content) {
    content.innerHTML = `
      <div class="empty-state">
        <h3>Dados persistidos indisponiveis</h3>
        <p>${sanitize(error?.message || 'Nao foi possivel carregar /api/jira/dashboard.')}</p>
        <button class="btn btn-primary" id="retry-data-load">Tentar novamente</button>
        <button class="btn btn-secondary" onclick="location.hash='#/data'">Ir para Dados</button>
      </div>
    `;
    document.getElementById('retry-data-load')?.addEventListener('click', () => {
      dataService.ensureLoaded({ force: true }).then(() => {
        renderSidebar();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }).catch(renderDataLoadError);
    });
  }
}

async function renderRoute(importPage, renderName, params = {}, options = {}) {
  const path = normalizePath(window.location.hash.replace(/^#\/?/, '/') || '/');
  if (options.public) {
    updateLayout(false);
  } else {
    updateLayout(true);
    renderSidebar();
    const content = document.getElementById('page-content');
    if (content) content.innerHTML = renderPageLoading();
  }
  if (dataRoutes.has(path) && !options.skipDataLoad) {
    if (!dataService.isLoaded) renderDataLoading();
    try {
      await dataService.ensureLoaded();
      renderSidebar();
    } catch (error) {
      renderDataLoadError(error);
      return;
    }
  }

  const module = await importPage();
  module[renderName](params);
}

// ─── Configuração de Rotas ──────────────────────────────

// Registrar rotas com lazy loading
registerRoute('/', () => renderRoute(() => import('./pages/dashboard.js'), 'renderDashboard'));
registerRoute('/login', () => renderRoute(() => import('./pages/login.js'), 'renderLogin', {}, { skipDataLoad: true, public: true }));
registerRoute(HOME_ROUTE, () => renderRoute(() => import('./pages/executive.js'), 'renderExecutive'));
registerRoute('/projects', () => renderRoute(() => import('./pages/projects.js'), 'renderProjects'));
registerRoute('/cards', () => renderRoute(() => import('./pages/cards.js'), 'renderCards'));
registerRoute('/analysts', () => renderRoute(() => import('./pages/analysts.js'), 'renderAnalysts'));
registerRoute('/analysts/general', () => renderRoute(() => import('./pages/analysts.js'), 'renderAnalysts'));
registerRoute('/analysts/comparative', () => renderRoute(() => import('./pages/analysts.js'), 'renderAnalysts'));
registerRoute('/analysts/evolution', () => renderRoute(() => import('./pages/analysts.js'), 'renderAnalysts'));
registerRoute('/board', () => renderRoute(() => import('./pages/board.js'), 'renderBoard'));
registerRoute('/data', () => renderRoute(() => import('./pages/data.js'), 'renderData', {}, { skipDataLoad: true }));
registerRoute('/access', () => renderRoute(() => import('./pages/access.js'), 'renderAccessManagement', {}, { skipDataLoad: true }));
registerRoute('/executive', () => renderRoute(() => import('./pages/executive.js'), 'renderExecutive'));
registerRoute('/executive/:projectKey', (params) => renderRoute(() => import('./pages/executive.js'), 'renderExecutive', params));
registerRoute('/hours', () => renderRoute(() => import('./pages/hours.js'), 'renderHours', {}, { skipDataLoad: true }));
registerRoute('/hours/docwise', () => renderRoute(() => import('./pages/hours.js'), 'renderHours', { projectKey: 'DOCW' }, { skipDataLoad: true }));
registerRoute('/contracts/crawford', () => renderRoute(() => import('./pages/hours.js'), 'renderHours', { projectKey: 'CRAWFORD' }, { skipDataLoad: true }));
registerRoute('/contracts/docwise', () => renderRoute(() => import('./pages/hours.js'), 'renderHours', { projectKey: 'DOCW' }, { skipDataLoad: true }));
registerRoute('/gantt', () => renderRoute(() => import('./pages/gantt.js'), 'renderGantt'));
registerRoute('/monitoring/overdue', () => renderRoute(() => import('./pages/cards.js'), 'renderCards', { monitoring: 'overdue' }));
registerRoute('/monitoring/blocked', () => renderRoute(() => import('./pages/cards.js'), 'renderCards', { monitoring: 'blocked' }));
registerRoute('/projects/health', () => renderRoute(() => import('./pages/project-reports.js'), 'renderProjectHealthReport'));
registerRoute('/projects/executive', () => renderRoute(() => import('./pages/project-reports.js'), 'renderProjectExecutiveReport'));
registerRoute('/projects/detailed-report', () => renderRoute(() => import('./pages/project-reports.js'), 'renderProjectDetailedReport'));

// Rotas de detalhe ( redireciona para board com filtro)
registerRoute('/projects/:id', async (params) => {
  try {
    await dataService.ensureLoaded();
  } catch (error) {
    renderDataLoadError(error);
    return;
  }
  const project = dataService.getProjectById(params.id);
  if (project) {
    window.location.hash = `#/board?projectKey=${project.key}`;
  } else {
    window.location.hash = '#/board';
  }
});

registerRoute('/analysts/:id', (params) => {
  window.location.hash = `#/board?analystId=${params.id}`;
});

setNotFound(() => {
  document.getElementById('page-content').innerHTML = `
    <div class="empty-state">
      <h3>Página não encontrada</h3>
      <p>A página que você está procurando não existe ou foi movida.</p>
      <button class="btn btn-primary" onclick="location.hash='#/'">Voltar ao Dashboard</button>
    </div>
  `;
});

// ─── Sistema de Autenticação Opcional ───────────────────

function markAuthenticated(user = null) {
  setCurrentUser(user);
  authCache = {
    authenticated: true,
    checkedAt: Date.now()
  };
}

function setSessionUser(user) {
  setCurrentUser(user);
}

function clearSession() {
  localStorage.removeItem('sessionId');
  setCurrentUser(null);
  authCache = {
    authenticated: false,
    checkedAt: 0
  };
}

// Helper para fetch com timeout
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Guard do router — login OBRIGATÓRIO
async function authGuard(path) {
  path = normalizePath(path);
  // Se é rota pública, permite
  if (publicRoutes.includes(path)) {
    updateLayout(false);
    return true;
  }

  // Verifica se tem sessão local
  const now = Date.now();
  if (
    authCache.authenticated &&
    now - authCache.checkedAt < AUTH_CACHE_TTL_MS
  ) {
    const user = getCurrentUser();
    if (!canAccessRoute(path, user)) {
      window.location.hash = `#${firstAllowedRoute(user)}`;
      return false;
    }
    return true;
  }

  if (!authValidationPromise) {
    authValidationPromise = (async () => {
      try {
        const response = await fetchWithTimeout('/api/auth', {
          method: 'GET',
          credentials: 'include',
          headers: localStorage.getItem('sessionId')
            ? { 'x-session-id': localStorage.getItem('sessionId') }
            : {}
        }, 5000);
        const data = await response.json().catch(() => ({ authenticated: false }));
        if (response.status === 401 || response.status === 403) {
          clearSession();
          return false;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!data.authenticated) {
          clearSession();
          return false;
        }
        setCurrentUser(data.user || null);
        authCache = { authenticated: true, checkedAt: Date.now() };
        if (!canAccessRoute(path, data.user || null)) {
          window.location.hash = `#${firstAllowedRoute(data.user || null)}`;
          return false;
        }
        return true;
      } catch (err) {
        console.warn('[Auth] Validacao indisponivel:', err.message);
        clearSession();
        return false;
      } finally {
        authValidationPromise = null;
      }
    })();
  }

  const authenticated = await authValidationPromise;
  if (!authenticated) window.location.hash = '#/login';
  return authenticated;
}

// ─── Layout do Sistema ──────────────────────────────────

function updateLayout(authenticated) {
  const sidebar = document.getElementById('sidebar');
  const header = document.getElementById('page-header');
  const app = document.getElementById('app');
  
  if (authenticated) {
    sidebar?.classList.remove('hidden');
    sidebar?.removeAttribute('aria-hidden');
    if (sidebar) sidebar.inert = false;
    header?.classList.remove('hidden');
    app?.classList.remove('login-layout');
    document.body.classList.remove('login-only');
  } else {
    sidebar?.classList.add('hidden');
    sidebar?.setAttribute('aria-hidden', 'true');
    if (sidebar) sidebar.inert = true;
    header?.classList.add('hidden');
    app?.classList.add('login-layout');
    document.body.classList.add('login-only');
  }
}

function closeMobileMenu() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('mobile-menu-toggle')?.setAttribute('aria-expanded', 'false');
  document.getElementById('mobile-menu-toggle')?.setAttribute('aria-label', 'Abrir menu');
  document.getElementById('sidebar-backdrop')?.classList.remove('visible');
}

function initMobileMenu() {
  const toggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  toggle?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('open') || false;
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
    backdrop?.classList.toggle('visible', isOpen);
  });
  backdrop?.addEventListener('click', closeMobileMenu);
  window.addEventListener('hashchange', closeMobileMenu);
}

function syncMobileThemeButton() {
  const button = document.getElementById('mobile-theme-toggle');
  if (!button) return;
  const isLight = getTheme() === 'light';
  button.textContent = isLight ? '☀' : '☾';
  button.setAttribute('aria-label', isLight ? 'Ativar tema escuro' : 'Ativar tema claro');
  button.setAttribute('aria-pressed', String(isLight));
}

window.updateLayout = updateLayout;
window.markAuthenticated = markAuthenticated;
window.setSessionUser = setSessionUser;
window.clearSession = clearSession;

// ─── Inicialização ──────────────────────────────────────

async function initApp() {
  captureSupabaseRecoveryState();
  syncMobileThemeButton();
  initMobileMenu();
  document.getElementById('mobile-theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    syncMobileThemeButton();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  window.addEventListener('themechange', syncMobileThemeButton);

  // Define o guard de autenticação
  setAuthGuard(authGuard);
  const currentPath = normalizePath(window.location.hash.replace(/^#\/?/, '/') || '/');

  if (currentPath === '/login') {
    updateLayout(false);
  } else {
    updateLayout(false);
  }

  // O guard faz a unica validacao remota, evitando corridas em reload/navegacao rapida.
  initRouter();
}

// Aguardar DOM
document.addEventListener('DOMContentLoaded', initApp);
