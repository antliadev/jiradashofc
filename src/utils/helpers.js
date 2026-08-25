/**
 * helpers.js — Utilitários genéricos do sistema
 */

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  return `${days}d atrás`;
}

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function priorityLabel(p) {
  const map = { highest: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa', lowest: 'Muito Baixa' };
  return map[p] || p;
}

export function typeLabel(t) {
  const map = { story: 'Story', bug: 'Bug', task: 'Task', epic: 'Epic', subtask: 'Subtask' };
  return map[t] || t;
}

export function healthLabel(h) {
  const map = { healthy: 'Saudável', at_risk: 'Atenção', critical: 'Crítico' };
  return map[h] || h;
}

export function statusCategoryLabel(c) {
  const map = { todo: 'A Fazer', in_progress: 'Em Andamento', done: 'Concluído', blocked: 'Bloqueado' };
  return map[c] || c;
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function paginate(arr, page, perPage = 15) {
  const start = (page - 1) * perPage;
  return { items: arr.slice(start, start + perPage), total: arr.length, totalPages: Math.ceil(arr.length / perPage), page };
}

// Cores por prioridade
export const PRIORITY_COLORS = {
  highest: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', lowest: '#94a3b8',
};

// Cores por categoria de status
export const STATUS_COLORS = {
  todo: '#94a3b8', in_progress: '#3b82f6', done: '#10b981', blocked: '#ef4444',
};

// Cores por saúde
export const HEALTH_COLORS = {
  healthy: '#10b981', at_risk: '#f59e0b', critical: '#ef4444',
};

// Cores do palette de projetos
export const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'];

/**
 * Sanitiza strings para prevenir XSS
 * Remove tags HTML e caracteres especiais perigosos
 */
export function sanitize(str) {
  if (!str) return '';
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#x60;')
    .replace(/on\w+=/gi, '');
}

/**
 * Sanitiza string para uso em titles e tooltips (permite mais caracteres)
 */
export function sanitizeTitle(str) {
  if (!str) return '';
  if (typeof str !== 'string') return String(str);
  // Para titles/tooltips, removemos apenas aspas para evitar quebrar o atributo
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Sanitiza para uso em URLs
 */
export function sanitizeUrl(url) {
  if (!url) return '';
  // Permitir apenas URLs seguras
  const allowedProtocols = ['https:', 'mailto:'];
  try {
    const parsed = new URL(url, window.location.origin);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Monta a URL do ticket no Jira de forma segura
 * @param {Object} card - Objeto do ticket
 * @param {string} baseUrl - URL base do Jira (ex: https://empresa.atlassian.net)
 * @returns {string} URL final ou '#'
 */
export function getJiraIssueUrl(card, baseUrl) {
  if (!card || !card.key) return '#';
  
  // Prioridade 1: Link real vindo da API do Jira
  // No transformJiraData, ja tentamos capturar o self ou issue_url
  if (card.jiraUrl && card.jiraUrl.startsWith('http')) {
    return card.jiraUrl;
  }
  
  // Prioridade 2: Construir com base no baseUrl e na Key
  if (baseUrl && baseUrl.startsWith('http')) {
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${cleanBase}/browse/${card.key}`;
  }
  
  console.warn(`[Jira] Não foi possível resolver a URL para o ticket ${card.key}. BaseUrl ausente.`);
  return '#';
}
