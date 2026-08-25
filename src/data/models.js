/**
 * models.js — Modelos de domínio do sistema
 * 
 * Hierarquia: Projeto → Cards → Status → Analistas
 * Todos os cards OBRIGATORIAMENTE pertencem a um projeto.
 * 
 * Esses modelos servem como contrato entre todas as camadas
 * e preparam a integração futura com a API do Jira.
 */

// ─── Enums ────────────────────────────────────────────

export const CardPriority = Object.freeze({
  HIGHEST: 'highest',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  LOWEST: 'lowest',
});

export const CardType = Object.freeze({
  STORY: 'story',
  BUG: 'bug',
  TASK: 'task',
  EPIC: 'epic',
  SUBTASK: 'subtask',
});

export const DataSourceType = Object.freeze({
  MOCK: 'mock',
  IMPORTED: 'imported',
  API: 'api',
  EMPTY: 'empty',  // Sem dados - usuário precisa sincronizar
});

export const ProjectHealth = Object.freeze({
  HEALTHY: 'healthy',
  AT_RISK: 'at_risk',
  CRITICAL: 'critical',
});

// ─── Normalização de Status ───────────────────────────

export const StatusCategory = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  BLOCKED: 'blocked',
});

/**
 * Mapeia status customizados do Jira para categorias normalizadas.
 * Futuramente, cada projeto poderá ter seu próprio mapeamento.
 */
export const DEFAULT_STATUS_MAP = {
  'backlog': StatusCategory.TODO,
  'to do': StatusCategory.TODO,
  'a fazer': StatusCategory.TODO,
  'open': StatusCategory.TODO,
  'novo': StatusCategory.TODO,
  'tarefas pendentes': StatusCategory.TODO,
  'in progress': StatusCategory.IN_PROGRESS,
  'em andamento': StatusCategory.IN_PROGRESS,
  'em desenvolvimento': StatusCategory.IN_PROGRESS,
  'in review': StatusCategory.IN_PROGRESS,
  'em revisão': StatusCategory.IN_PROGRESS,
  'em revisao': StatusCategory.IN_PROGRESS,
  'code review': StatusCategory.IN_PROGRESS,
  'testing': StatusCategory.IN_PROGRESS,
  'testes': StatusCategory.IN_PROGRESS,
  'em teste': StatusCategory.IN_PROGRESS,
  'aguardando pr / aprovação': StatusCategory.IN_PROGRESS,
  'aguardando pr / aprovacao': StatusCategory.IN_PROGRESS,
  'qa': StatusCategory.IN_PROGRESS,
  'done': StatusCategory.DONE,
  'concluído': StatusCategory.DONE,
  'concluido': StatusCategory.DONE,
  'closed': StatusCategory.DONE,
  'finalizado': StatusCategory.DONE,
  'resolved': StatusCategory.DONE,
  'blocked': StatusCategory.BLOCKED,
  'bloqueado': StatusCategory.BLOCKED,
  'impedido': StatusCategory.BLOCKED,
  'on hold': StatusCategory.BLOCKED,
  'aguardando': StatusCategory.BLOCKED,
};

// ─── Fábricas de Entidades ────────────────────────────

/**
 * Cria um objeto Projeto validado
 */
export function createProject({
  id,
  key,
  name,
  description = '',
  lead = null,
  statusFlow = [],
  createdAt = new Date().toISOString(),
  avatarUrl = null,
} = {}) {
  if (!id || !key || !name) {
    throw new Error('Projeto requer id, key e name');
  }
  return Object.freeze({
    id,
    key: key.toUpperCase(),
    name,
    description,
    lead,
    statusFlow,
    createdAt,
    avatarUrl,
  });
}

/**
 * Cria um objeto Card/Issue validado.
 * projectId é OBRIGATÓRIO — regra crítica do sistema.
 */
export function createCard({
  id,
  key,
  projectId,
  title,
  description = '',
  assigneeId = null,
  status = 'To Do',
  priority = CardPriority.MEDIUM,
  type = CardType.TASK,
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
  dueDate = null,
  sprint = null,
  storyPoints = 0,
  labels = [],
  timeEstimated = 0,
  timeSpent = 0,
  epicKey = null,
} = {}) {
  if (!id || !key || !projectId || !title) {
    throw new Error('Card requer id, key, projectId e title');
  }
  return Object.freeze({
    id,
    key,
    projectId,
    title,
    description,
    assigneeId,
    status,
    priority,
    type,
    createdAt,
    updatedAt,
    dueDate,
    sprint,
    storyPoints,
    labels,
    timeEstimated,
    timeSpent,
    epicKey,
  });
}

/**
 * Cria um objeto Analista/Usuário validado
 */
export function createUser({
  id,
  displayName,
  email = '',
  avatarUrl = null,
  active = true,
} = {}) {
  if (!id || !displayName) {
    throw new Error('Usuário requer id e displayName');
  }
  return Object.freeze({
    id,
    displayName,
    email,
    avatarUrl,
    active,
  });
}

// ─── Utilitários de Status ────────────────────────────

/**
 * Resolve a categoria normalizada de um status.
 * @param {string} status - Status original do card
 * @param {Object} customMap - Mapa customizado do projeto (opcional)
 * @returns {string} StatusCategory
 */
export function resolveStatusCategory(status, customMap = {}) {
  const normalized = status.toLowerCase().trim();
  return customMap[normalized] || DEFAULT_STATUS_MAP[normalized] || StatusCategory.TODO;
}

/**
 * Verifica se um card está atrasado.
 * Normaliza datas para início do dia UTC para evitar erros de timezone.
 */
export function isCardOverdue(card) {
  if (!card.dueDate) return false;
  const category = resolveStatusCategory(card.status);
  if (category === StatusCategory.DONE) return false;
  
  // Normalizar para startOfDay UTC — evita que timezone do browser mude o dia
  const due = new Date(card.dueDate);
  if (isNaN(due.getTime())) return false;
  const dueDay = new Date(Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()));
  
  const now = new Date();
  const todayDay = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  
  return dueDay < todayDay;
}

/**
 * Calcula o progresso de um projeto baseado nos cards
 */
export function calculateProjectProgress(cards) {
  if (!cards || cards.length === 0) return 0;
  const done = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.DONE).length;
  return Math.round((done / cards.length) * 100);
}

/**
 * Determina a saúde de um projeto
 */
export function calculateProjectHealth(cards) {
  if (!cards || cards.length === 0) return ProjectHealth.HEALTHY;
  
  const overdueCount = cards.filter(isCardOverdue).length;
  const blockedCount = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.BLOCKED).length;
  const total = cards.length;
  
  const overdueRate = overdueCount / total;
  const blockedRate = blockedCount / total;
  
  if (overdueRate > 0.3 || blockedRate > 0.2) return ProjectHealth.CRITICAL;
  if (overdueRate > 0.15 || blockedRate > 0.1) return ProjectHealth.AT_RISK;
  return ProjectHealth.HEALTHY;
}
