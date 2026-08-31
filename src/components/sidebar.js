/**
 * sidebar.js — Componente de navegação lateral
 */
import { dataService } from '../data/data-service.js';
import { getTheme, toggleTheme } from '../utils/theme.js';
import { StatusCategory } from '../data/models.js';
import { canAccessPermission } from '../utils/access-control.js';
import { confirmAction, setButtonBusy, showToast } from '../utils/ui-feedback.js';

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  executive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  hours: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M7 3L4 6M17 3l3 3"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  chevron: '<svg class="nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
  gantt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><rect x="6" y="4" width="5" height="4" rx="1"/><rect x="9" y="10" width="8" height="4" rx="1"/><rect x="13" y="16" width="5" height="4" rx="1"/></svg>',
  analysts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  access: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>',
};

const SIDEBAR_COLLAPSED_KEY = 'rja.sidebar.collapsed';

function getCurrentPath() {
  return (window.location.hash.replace(/^#\/?/, '/') || '/').split('?')[0];
}

function activeMenuForPath(currentPath) {
  if (currentPath.startsWith('/contracts')) return 'contracts';
  if (currentPath.startsWith('/monitoring')) return 'monitoring';
  if (currentPath.startsWith('/projects') || currentPath.startsWith('/executive')) return 'projects';
  if (currentPath.startsWith('/analysts')) return 'analysts';
  return '';
}

function getExpandedMenus(currentPath) {
  const activeMenu = activeMenuForPath(currentPath);
  return {
    contracts: activeMenu === 'contracts',
    monitoring: activeMenu === 'monitoring',
    projects: activeMenu === 'projects',
    analysts: activeMenu === 'analysts',
  };
}

function isSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

function getAttentionCounts() {
  if (!dataService?.isLoaded) {
    return { overdue: 0, blocked: 0, total: 0 };
  }

  const overdue = dataService.getCards({ overdue: true }).length;
  const blocked = dataService.getCards({ statusCategory: StatusCategory.BLOCKED }).length;
  return { overdue, blocked, total: overdue + blocked };
}

function counterBadge(value) {
  return `<span class="nav-count" aria-label="${value} registros">${value}</span>`;
}

function navLink({ route, label, icon = '', count = null, permission = null }) {
  if (!canAccessPermission(permission)) return '';
  const counter = Number.isFinite(count) ? counterBadge(count) : '';
  return `
    <button class="nav-item nav-subitem" data-route="${route}" onclick="location.hash='#${route}'" aria-label="Ir para ${label}" title="${label}">
      ${icon}
      <span>${label}</span>
      ${counter}
    </button>
  `;
}

function navGroup({ id, label, icon, expanded, active, count = null, children }) {
  const visibleChildren = children.filter(Boolean);
  if (!visibleChildren.length) return '';
  const counter = Number.isFinite(count) ? counterBadge(count) : '';
  return `
    <div class="nav-group ${expanded ? 'expanded' : ''} ${active ? 'active' : ''}" data-menu="${id}" data-active-menu="${active ? 'true' : 'false'}">
      <button class="nav-item nav-parent" data-nav-toggle="${id}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="submenu-${id}">
        ${icon}
        <span>${label}</span>
        ${counter}
        ${ICONS.chevron}
      </button>
      <div class="nav-submenu" id="submenu-${id}" ${expanded ? '' : 'hidden'}>
        ${visibleChildren.join('')}
      </div>
    </div>
  `;
}

function navButton({ route, label, icon, permission = null }) {
  if (!canAccessPermission(permission)) return '';
  return `<button class="nav-item" data-route="${route}" onclick="location.hash='#${route}'" aria-label="Ir para ${label}" title="${label}">${icon}<span>${label}</span></button>`;
}

export function renderSidebar() {
  const source = dataService?.source || 'empty';
  const sidebar = document.getElementById('sidebar');
  const currentPath = getCurrentPath();
  const activeMenu = activeMenuForPath(currentPath);
  const expandedMenus = getExpandedMenus(currentPath);
  const attentionCounts = getAttentionCounts();
  const sourceLabel = source === 'empty' ? 'Sem dados' : 
                      source === 'mock' ? 'Mock Data' : 
                      source === 'imported' ? 'Importado' : 'API Jira';
  const isLight = getTheme() === 'light';
  const isCollapsed = isSidebarCollapsed();
  document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  sidebar.innerHTML = `
    <div class="sidebar-header" role="banner">
      <div class="sidebar-logo">
        <div class="logo-icon" aria-hidden="true">
          <img src="/antlia-logo.png" alt="">
        </div>
        <div class="sidebar-brand-text">
          <h1>Radar Jira Antlia</h1>
          <span>RJA</span>
        </div>
      </div>
      <button class="sidebar-collapse-toggle" id="sidebar-collapse-toggle" type="button" aria-label="${isCollapsed ? 'Expandir menu' : 'Recolher menu'}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
    </div>
    <nav class="sidebar-nav" role="navigation" aria-label="Menu principal">
      <div class="nav-section" role="heading" aria-level="2">Principal</div>
      ${navButton({ route: '/', label: 'Dashboard', icon: ICONS.dashboard, permission: 'dashboard' })}
      ${navButton({ route: '/home', label: 'Home', icon: ICONS.executive, permission: 'executive' })}
      ${navGroup({
        id: 'contracts',
        label: 'Contratos Consumo Horas',
        icon: ICONS.clock,
        expanded: expandedMenus.contracts,
        active: activeMenu === 'contracts',
        children: [
            navLink({ route: '/contracts/crawford', label: 'Crawford', icon: ICONS.clock, permission: 'contracts.crawford' }),
            navLink({ route: '/contracts/docwise', label: 'Docwise', icon: ICONS.clock, permission: 'contracts.docwise' }),
        ],
      })}
      ${navGroup({
        id: 'monitoring',
        label: 'Monitoramento de Cards',
        icon: ICONS.cards,
        expanded: expandedMenus.monitoring,
        active: activeMenu === 'monitoring',
        count: attentionCounts.total,
        children: [
          navLink({ route: '/monitoring/overdue', label: 'Cards com Data em Atraso', icon: ICONS.cards, count: attentionCounts.overdue, permission: 'monitoring.overdue' }),
          navLink({ route: '/monitoring/blocked', label: 'Cards Bloqueados', icon: ICONS.cards, count: attentionCounts.blocked, permission: 'monitoring.blocked' }),
        ],
      })}
      ${navButton({ route: '/gantt', label: 'Gantt', icon: ICONS.gantt, permission: 'gantt' })}
      ${navGroup({
        id: 'projects',
        label: 'Projetos',
        icon: ICONS.projects,
        expanded: expandedMenus.projects,
        active: activeMenu === 'projects',
        children: [
          navLink({ route: '/projects', label: 'Issues - Kanban', icon: ICONS.board, permission: 'projects.kanban' }),
          navLink({ route: '/projects/health', label: 'Saude Detalhamento Cards Projetos', icon: ICONS.dashboard, permission: 'projects.health' }),
          navLink({ route: '/projects/executive', label: 'Relatorio Gerencial - Clientes', icon: ICONS.executive, permission: 'projects.executive' }),
          navLink({ route: '/projects/detailed-report', label: 'Relatorio Gerencial Detalhado - Clientes', icon: ICONS.executive, permission: 'projects.detailed' }),
        ],
      })}
      ${navGroup({
        id: 'analysts',
        label: 'Analistas',
        icon: ICONS.analysts,
        expanded: expandedMenus.analysts,
        active: activeMenu === 'analysts',
        children: [
          navLink({ route: '/analysts/general', label: 'Geral', icon: ICONS.analysts, permission: 'analysts.general' }),
          navLink({ route: '/analysts/evolution', label: 'Evolucao', icon: ICONS.gantt, permission: 'analysts.evolution' }),
          navLink({ route: '/analysts/comparative', label: 'Comparativo', icon: ICONS.dashboard, permission: 'analysts.comparative' }),
        ],
      })}
      <div class="nav-section" role="heading" aria-level="2">Configuração</div>
      ${navButton({ route: '/data', label: 'Dados', icon: ICONS.data, permission: 'data' })}
      ${navButton({ route: '/access', label: 'Gestao de Acessos', icon: ICONS.access, permission: 'access.manage' })}
    </nav>
    <div class="sidebar-footer" role="contentinfo">
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="${isLight ? 'Ativar tema escuro' : 'Ativar tema claro'}" aria-pressed="${isLight}">
        <span class="theme-toggle-icon" aria-hidden="true">${isLight ? '☀' : '☾'}</span>
        <span>${isLight ? 'Tema claro' : 'Tema escuro'}</span>
        <span class="theme-toggle-hint">Alternar</span>
      </button>
      <div class="data-source-badge" aria-label="Fonte de dados atual">
        <span class="dot ${source}" aria-hidden="true"></span>
        <span>Fonte: <strong>${sourceLabel}</strong></span>
      </div>
      <button class="btn btn-secondary sidebar-logout" id="logout-button" type="button">Sair</button>
    </div>
  `;

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    renderSidebar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.getElementById('sidebar-collapse-toggle')?.addEventListener('click', () => {
    const collapsed = !isSidebarCollapsed();
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    renderSidebar();
  });

  document.getElementById('logout-button')?.addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Sair do JiraDash?',
      message: 'Sua sessão será encerrada neste dispositivo.',
      confirmLabel: 'Sair'
    });
    if (!confirmed) return;
    const logoutButton = document.getElementById('logout-button');
    setButtonBusy(logoutButton, true, 'Saindo...');
    try {
      await fetch('/api/auth', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // Se a sessão já tiver expirado ou a API falhar, seguimos para limpar o estado local.
    }
    window.clearSession?.();
    window.updateLayout?.(false);
    window.history.replaceState({}, '', `${window.location.pathname}#/login`);
    window.location.hash = '#/login';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    showToast('Sessão encerrada.', 'success');
  });

  const setGroupExpanded = (group, expanded) => {
    const button = group.querySelector('[data-nav-toggle]');
    const submenu = group.querySelector('.nav-submenu');
    button?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    group.classList.toggle('expanded', expanded);
    if (submenu) submenu.hidden = !expanded;
  };

  sidebar.querySelectorAll('.nav-group').forEach(group => {
    group.addEventListener('mouseenter', () => setGroupExpanded(group, true));
    group.addEventListener('focusin', () => setGroupExpanded(group, true));
    group.addEventListener('mouseleave', () => {
      if (group.dataset.activeMenu !== 'true') setGroupExpanded(group, false);
    });
    group.addEventListener('focusout', event => {
      if (group.dataset.activeMenu !== 'true' && !group.contains(event.relatedTarget)) {
        setGroupExpanded(group, false);
      }
    });
  });
}
