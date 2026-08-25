/**
 * router.js — SPA Router simples baseado em hash
 * Com sistema de Guards para proteção de rotas
 */

const routes = new Map();
let currentRoute = null;
let notFoundHandler = null;
let authGuard = null;

// ─── Registro de Rotas ─────────────────────────────────────

/**
 * Registra uma rota com seu handler
 */
export function registerRoute(pattern, handler) {
  routes.set(pattern, handler);
}

/**
 * Define o handler para rota não encontrada (404)
 */
export function setNotFound(handler) {
  notFoundHandler = handler;
}

// ─── Sistema de Guards ──────────────────────────────────

/**
 * Define o guard de autenticação
 * O guard recebe a rota destino e retorna:
 * - true: permite acesso
 * - false: bloqueia acesso (redireciona para login)
 */
export function setAuthGuard(guardFn) {
  authGuard = guardFn;
}

/**
 * Verifica se o acesso à rota é permitido
 */
async function checkAccess(path) {
  // Se não há guard definido, permite tudo
  if (!authGuard) return true;
  
  return await authGuard(path);
}

function matchRoute(hash) {
  const path = (hash.replace(/^#\/?/, '/') || '/').split('?')[0];
  
  // Busca direta
  if (routes.has(path)) return { handler: routes.get(path), params: {} };
  
  // Busca com parâmetros
  for (const [pattern, handler] of routes) {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    
    if (patternParts.length !== pathParts.length) continue;
    
    const params = {};
    let match = true;
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }
    
    if (match) return { handler, params };
  }
  
  return null;
}

export function initRouter() {
  const handle = async () => {
    const path = (window.location.hash.replace(/^#\/?/, '/') || '/').split('?')[0];
    
    // ─── GUARD: Verifica autenticação ANTES de qualquer coisa ───
    const hasAccess = await checkAccess(path);
    
    if (!hasAccess) {
      // Guard bloqueou o acesso - não renderiza nada
      console.log('[Router] Access denied, redirecting to login');
      return;
    }
    // ─────────────────────────────────────────────────────────────
    
    const result = matchRoute(window.location.hash || '#/');
    
    if (result) {
      currentRoute = path;
      await result.handler(result.params);
    } else if (notFoundHandler) {
      notFoundHandler();
    }
    
    // Atualizar sidebar ativa (se estiver visível)
    document.querySelectorAll('.nav-item[data-route]').forEach(item => {
      const href = item.getAttribute('data-route');
      const isActive = href === '/'
        ? path === '/'
        : path === href || path.startsWith(`${href}/`);
      item.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.nav-group').forEach(group => {
      const savedExpanded = JSON.parse(localStorage.getItem('rja.sidebar.expanded') || '{}');
      const menu = group.getAttribute('data-menu');
      const hasActiveChild = Boolean(group.querySelector('.nav-subitem.active'));
      group.classList.toggle('active', hasActiveChild);
      if (hasActiveChild) {
        group.classList.add('expanded');
        const toggle = group.querySelector('.nav-parent');
        const submenu = group.querySelector('.nav-submenu');
        toggle?.setAttribute('aria-expanded', 'true');
        if (submenu) submenu.hidden = false;
      } else if (!savedExpanded[menu]) {
        group.classList.remove('expanded');
        const toggle = group.querySelector('.nav-parent');
        const submenu = group.querySelector('.nav-submenu');
        toggle?.setAttribute('aria-expanded', 'false');
        if (submenu) submenu.hidden = true;
      }
    });
  };

  window.addEventListener('hashchange', handle);
  handle(); // Executa na inicialização
}
