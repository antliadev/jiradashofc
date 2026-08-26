/**
 * data-service.js — Camada de abstração de dados
 * 
 * Ponto único de acesso aos dados do sistema.
 * Suporta múltiplas fontes: mock, importado, API do Jira.
 * Toda lógica de negócio de consulta centralizada aqui.
 */
import {
  DataSourceType, resolveStatusCategory, StatusCategory,
  isCardOverdue, calculateProjectProgress, calculateProjectHealth,
} from './models.js';
import { buildProjectScheduleSummary } from './schedule-service.js';

const DASHBOARD_DATA_TIMEOUT_MS = 120000;
const DASHBOARD_CACHE_KEY = 'jiraDash.dashboardPayload.v2';
const DASHBOARD_CACHE_TTL_MS = 3 * 60 * 1000;

function jiraFieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(jiraFieldText).filter(Boolean).join(', ');
  if (typeof value !== 'object') return '';
  if (value.type === 'text') return String(value.text || '').trim();
  if (Array.isArray(value.content)) return value.content.map(jiraFieldText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return jiraFieldText(value.value ?? value.displayName ?? value.name ?? value.label ?? value.child);
}

class DataService {
  constructor() {
    this._projects = [];
    this._cards = [];
    this._users = [];
    this._source = DataSourceType.EMPTY;
    this._lastSync = null;
    this._listeners = new Set();
    this._rawJiraData = null;
    this._apiStatus = 'disconnected';
    this._config = null;
    this._apiBase = '/api/jira';
    this._projectMetadata = new Map();
    this._loadPromise = null;
    this._loadError = null;
    this._hasLoaded = false;
    this._version = 0;
    this._rawIssueById = new Map();
    this._derived = null;
  }

  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { this._listeners.forEach(fn => fn()); }
  _invalidateDerived() {
    this._version++;
    this._derived = null;
  }

  _ensureDerived() {
    if (this._derived?.version === this._version) return this._derived;

    const projectById = new Map();
    const projectByKey = new Map();
    const userById = new Map();
    const cardsByProject = new Map();
    const cardsByAssignee = new Map();
    const statusSet = new Set();

    this._projects.forEach(project => {
      projectById.set(project.id, project);
      projectByKey.set(project.key, project);
    });

    this._users.forEach(user => userById.set(user.id, user));

    this._cards.forEach(card => {
      if (!cardsByProject.has(card.projectId)) cardsByProject.set(card.projectId, []);
      cardsByProject.get(card.projectId).push(card);

      if (!cardsByAssignee.has(card.assigneeId)) cardsByAssignee.set(card.assigneeId, []);
      cardsByAssignee.get(card.assigneeId).push(card);

      if (card.status) statusSet.add(card.status);
    });

    this._derived = {
      version: this._version,
      projectById,
      projectByKey,
      userById,
      cardsByProject,
      cardsByAssignee,
      statusOptions: [...statusSet].sort(),
      projectStats: new Map(),
      userStats: new Map(),
      projectsRanked: null,
      usersRanked: null
    };

    return this._derived;
  }

  _setCollections({ projects, cards, users }) {
    this._projects = projects || [];
    this._cards = cards || [];
    this._users = users || [];
    this._invalidateDerived();
  }

  get source() { return this._source; }
  get lastSync() { return this._lastSync; }
  get apiStatus() { return this._apiStatus; }
  get config() { return this._config; }
  get isLoaded() { return this._hasLoaded; }
  get loadError() { return this._loadError; }

  /**
   * Carrega dados do mock (fallback)
   */
  loadMockData() {
    import('./mock-data.js').then(({ MOCK_PROJECTS, MOCK_CARDS, MOCK_USERS }) => {
      this._setCollections({
        projects: [...MOCK_PROJECTS],
        cards: [...MOCK_CARDS],
        users: [...MOCK_USERS]
      });
      this._source = DataSourceType.MOCK;
      this._lastSync = new Date().toISOString();
      this._notify();
    });
  }

  /**
   * Retorna os headers com sessão
   */
  _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId) {
      headers['x-session-id'] = sessionId;
    }
    return headers;
  }

  /**
   * Carrega configuração do Jira (Depreciado - agora stateless)
   */
  async loadConfig() {
    // Agora retornamos apenas um esqueleto para não quebrar o frontend
    // mas sem tentar fazer fetch em endpoint que retornaria 404
    this._config = { source: 'form', isProduction: true };
    this._notify();
    return this._config;
  }

  /**
   * Salva configuração do Jira
   */
  async saveConfig(config) {
    try {
      const response = await fetch(`${this._apiBase}/config`, {
        method: 'POST',
        headers: this._getHeaders(),
        credentials: 'include',
        body: JSON.stringify(config)
      });
      
      // Validar content-type antes de parsear JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[DataService] SaveConfig response not JSON:', text.substring(0, 200));
        throw new Error('Resposta inválida do servidor');
      }
      
      const result = await response.json();
      
      // Se retornou 403 ou message de produção, não é erro crítico
      if (response.status === 403 || result.message?.includes('produção')) {
        // Apenas recarrega configuração
        await this.loadConfig();
        return result;
      }
      
      if (!response.ok) {
        throw new Error(result.error || result.message || 'Erro ao salvar configuração');
      }
      
      this._config = result;
      this._notify();
      return result;
    } catch (error) {
      console.error('[DataService] Erro ao salvar configuração:', error.message);
      throw error;
    }
  }

  /**
   * Testa conexão com o Jira
   */
  async testJiraConnection(credentials) {
    try {
      // Sanitização básica no frontend
      let { baseUrl } = credentials;
      if (baseUrl) {
        baseUrl = baseUrl.trim().toLowerCase();
        if (!baseUrl.startsWith('http')) {
          baseUrl = `https://${baseUrl}`;
        }
        // Remover barra final se existir
        baseUrl = baseUrl.replace(/\/$/, '');
        credentials.baseUrl = baseUrl;
      }

      const response = await fetch(`${this._apiBase}/test-connection`, {
        method: 'POST',
        headers: this._getHeaders(),
        credentials: 'include',
        body: JSON.stringify(credentials)
      });
      
      // Validar content-type antes de parsear JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[DataService] Resposta não é JSON:', text.substring(0, 200));
        throw new Error(`Erro ao testar conexão: resposta inválida do servidor (${response.status})`);
      }
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Erro ao testar conexão');
      }
      
      return result;
    } catch (error) {
      console.error('[DataService] Erro ao testar conexão:', error.message);
      throw error;
    }
  }

  /**
   * Sincroniza dados do Jira
   * NOTA: Agora envia as credenciais do frontend explicitamente,
   * garantindo que não estamos salvando ou usando credenciais em cache.
   * @param {Object} credentials - As credenciais para sincronização
   */
  async syncFromJira(credentials) {
    return this.startJiraSync(credentials);
  }

  /**
   * Inicia sincronizacao no backend usando credenciais fornecidas.
   * @param {Object} credentials - { baseUrl, email, token, jql }
   */
  async startJiraSync(credentials) {
    try {
      // Sanitização básica no frontend
      let { baseUrl } = credentials;
      if (baseUrl) {
        baseUrl = baseUrl.trim().toLowerCase();
        if (!baseUrl.startsWith('http')) {
          baseUrl = `https://${baseUrl}`;
        }
        // Remover barra final
        baseUrl = baseUrl.replace(/\/$/, '');
        credentials.baseUrl = baseUrl;
      }

      const response = await this._fetchWithTimeout(`${this._apiBase}/sync`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify(credentials)
      }, 15000);
      
      // Validar content-type antes de parsear JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[DataService] Resposta não é JSON:', text.substring(0, 200));
        throw new Error(`Erro ao sincronizar: resposta inválida do servidor (${response.status})`);
      }
      
      const result = await response.json();
       
      if (!response.ok) {
        if (response.status === 409 && result.code === 'SYNC_ALREADY_RUNNING' && result.job) {
          return {
            ...result,
            alreadyRunning: true,
            jobId: result.job.id
          };
        }
        throw new Error(result.error || 'Erro ao sincronizar');
      }

      return result;
    } catch (error) {
      console.error('[DataService] Erro ao iniciar sincronizacao:', error.message);
      throw error;
    }
  }

  /**
   * Inicia sincronizacao no backend usando apenas variaveis de ambiente.
   * Nao envia credenciais do frontend — o backend le JIRA_BASE_URL,
   * JIRA_EMAIL e JIRA_API_TOKEN do .env ou ambiente.
   */
  async startJiraSyncFromEnv() {
    try {
      const response = await this._fetchWithTimeout(`${this._apiBase}/sync/start`, {
        method: 'POST',
        headers: this._getHeaders()
        // Sem body — credenciais sao lidas de env vars no servidor
      }, 15000);

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[DataService] Resposta nao e JSON:', text.substring(0, 200));
        throw new Error(`Erro ao sincronizar: resposta invalida do servidor (${response.status})`);
      }

      const result = await response.json();

      if (!response.ok) {
        // 409 = SYNC_ALREADY_RUNNING
        if (response.status === 409 && result.code === 'SYNC_ALREADY_RUNNING' && result.job) {
          return {
            ...result,
            alreadyRunning: true,
            jobId: result.job.id
          };
        }
        throw new Error(result.error || 'Erro ao sincronizar');
      }

      return result;
    } catch (error) {
      console.error('[DataService] Erro ao iniciar sincronizacao via env:', error.message);
      throw error;
    }
  }

  _hasActiveSyncScope(scope = {}) {
    return Object.entries(scope || {}).some(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    });
  }

  async startScopedJiraSync(scope = {}) {
    if (!this._hasActiveSyncScope(scope)) return this.startJiraSyncFromEnv();

    try {
      const response = await this._fetchWithTimeout(`${this._apiBase}/sync/scoped`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({ scope })
      }, 15000);

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[DataService] Resposta nao e JSON:', text.substring(0, 200));
        throw new Error(`Erro ao sincronizar filtro: resposta invalida do servidor (${response.status})`);
      }

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409 && result.code === 'SYNC_ALREADY_RUNNING' && result.job) {
          return {
            ...result,
            alreadyRunning: true,
            jobId: result.job.id
          };
        }
        throw new Error(result.error || 'Erro ao sincronizar filtro');
      }

      return result;
    } catch (error) {
      console.error('[DataService] Erro ao iniciar sincronizacao filtrada:', error.message);
      throw error;
    }
  }

  /**
   * Verifica status da sincronização
   */
  async getSyncStatus(jobId = null) {
    try {
      const url = jobId
        ? `${this._apiBase}/sync/status?jobId=${encodeURIComponent(jobId)}`
        : `${this._apiBase}/sync/status`;

      const response = await this._fetchWithTimeout(url, {
        headers: this._getHeaders()
      }, 8000);
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : {};
      if (response.ok) {
        return result;
      }
      return {
        status: 'error',
        error: result.error || `Falha ao buscar status da sincronizacao (${response.status})`,
        logs: []
      };
    } catch (error) {
      console.error('[DataService] Erro ao buscar status:', error.message);
      return {
        status: 'error',
        error: error.name === 'AbortError'
          ? 'Timeout ao consultar status da sincronizacao.'
          : error.message,
        logs: []
      };
    }
  }

  /**
   * Limpa o cache
   */
  async clearCache() {
    try {
      this._clearDashboardCache();
      const response = await fetch(`${this._apiBase}/cache/clear`, {
        method: 'POST',
        headers: this._getHeaders()
      });
      return await response.json();
    } catch (error) {
      console.error('[DataService] Erro ao limpar cache:', error.message);
      throw error;
}
  }

  /**
   * Fetch com timeout para evitar travamento eterno
   */
  async _fetchWithTimeout(url, options = {}, timeout = 10000) {
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
      if (err.name === 'AbortError') {
        throw new Error(`Tempo limite excedido ao carregar ${url}.`, { cause: err });
      }
      throw err;
    }
  }

  /**
   * Carrega dados do Jira via API interna
   */
  async loadJiraData({ force = false } = {}) {
    try {
      if (force) this._clearDashboardCache();
      if (!force) {
        const cached = this._readDashboardCache();
        if (cached) {
          await this.loadProjectMetadata().catch(error => {
            console.warn('[DataService] Metadata de projetos indisponivel:', error.message);
          });
          this._applyJiraData(cached);
          return cached;
        }
      }

      const response = await this._fetchWithTimeout(`${this._apiBase}/dashboard${force ? '?force=1' : ''}`, {
        headers: this._getHeaders()
      }, DASHBOARD_DATA_TIMEOUT_MS);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Erro ao buscar dados do Jira');
      }
      
      const data = await response.json();
      this._writeDashboardCache(data);
      await this.loadProjectMetadata().catch(error => {
        console.warn('[DataService] Metadata de projetos indisponivel:', error.message);
      });
      this._applyJiraData(data);
      
      return data;
    } catch (error) {
      console.error('[DataService] Erro ao carregar dados do Jira:', error.message);
      this._apiStatus = 'error';
      this._loadError = error;
      
      // NÃO carregar mock automaticamente - deixa vazio se não houver dados
      // O usuário deve sincronizar explicitamente
      if (!this._hasLoaded) {
        this._setCollections({ projects: [], cards: [], users: [] });
        this._source = DataSourceType.EMPTY;
      }
      this._notify();
      
      throw error;
    } finally {
      this._loadPromise = null;
    }
  }

  _applyJiraData(data) {
    this._rawJiraData = data;
    this.transformJiraData(data);
    this._source = DataSourceType.API;
    this._lastSync = data.lastSyncedAt;
    this._apiStatus = 'connected';
    this._loadError = null;
    this._hasLoaded = true;
    this._notify();
  }

  _readDashboardCache() {
    try {
      const raw = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached?.savedAt || !cached?.data) return null;
      if (Date.now() - cached.savedAt > DASHBOARD_CACHE_TTL_MS) return null;
      return cached.data;
    } catch {
      return null;
    }
  }

  _writeDashboardCache(data) {
    try {
      sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        data
      }));
    } catch {
      // ignore cache quota/private mode
    }
  }

  _clearDashboardCache() {
    try {
      sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
    } catch {
      // ignore storage errors
    }
  }

  _metadataStorageKey(projectKey = '') {
    return projectKey ? `jiraDash.projectMetadata.${projectKey}` : 'jiraDash.projectMetadata';
  }

  _loadLocalProjectMetadata() {
    try {
      const raw = localStorage.getItem(this._metadataStorageKey());
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        list.forEach(item => {
          if (item?.projectKey) this._projectMetadata.set(item.projectKey, item);
        });
      }
    } catch {
      // ignore corrupted local fallback
    }
  }

  _persistLocalProjectMetadata() {
    try {
      localStorage.setItem(this._metadataStorageKey(), JSON.stringify([...this._projectMetadata.values()]));
    } catch {
      // ignore storage errors
    }
  }

  async loadProjectMetadata(projectKey = null) {
    this._loadLocalProjectMetadata();

    try {
      const url = projectKey
        ? `${this._apiBase}/project-metadata?projectKey=${encodeURIComponent(projectKey)}`
        : `${this._apiBase}/project-metadata`;
      const response = await this._fetchWithTimeout(url, {
        headers: this._getHeaders(),
      }, 8000);
      if (!response.ok) return [...this._projectMetadata.values()];
      const result = await response.json();
      const list = Array.isArray(result.metadata) ? result.metadata : [];
      list.forEach(item => {
        if (item?.projectKey) this._projectMetadata.set(item.projectKey, item);
      });
      this._persistLocalProjectMetadata();
      return list;
    } catch {
      this._loadLocalProjectMetadata();
      return [...this._projectMetadata.values()];
    }
  }

  getProjectMetadata(projectKey) {
    return this._projectMetadata.get(String(projectKey || '').toUpperCase()) || null;
  }

  async saveProjectMetadata(projectKey, payload = {}) {
    const normalizedKey = String(projectKey || payload.projectKey || '').trim().toUpperCase();
    if (!normalizedKey) throw new Error('Projeto obrigatorio.');

    const project = this.getProjectByKey(normalizedKey) || this.getProjectById(payload.projectId);
    const metadata = {
      projectKey: normalizedKey,
      projectId: project?.id || payload.projectId || null,
      projectName: project?.name || payload.projectName || null,
      plannedStartDate: payload.plannedStartDate || null,
      plannedEndDate: payload.plannedEndDate || null,
      notes: payload.notes || '',
      updatedAt: new Date().toISOString(),
    };

    this._projectMetadata.set(normalizedKey, metadata);
    this._persistLocalProjectMetadata();

    let persistence = 'localStorage';
    try {
      const response = await fetch(`${this._apiBase}/project-metadata`, {
        method: 'PATCH',
        headers: this._getHeaders(),
        body: JSON.stringify(metadata),
      });
      if (response.ok) {
        const result = await response.json();
        persistence = result.persistence || persistence;
        if (result.metadata?.projectKey) {
          this._projectMetadata.set(result.metadata.projectKey, result.metadata);
        }
      }
    } catch (error) {
      console.warn('[DataService] Salvando metadata apenas localmente:', error.message);
    }

    this.transformJiraData(this._rawJiraData || { issues: [], projects: [], analysts: [] });
    this._notify();
    return { metadata: this._projectMetadata.get(normalizedKey), persistence };
  }

  /**
   * Garante reidratacao unica do estado em memoria a partir do backend.
   */
  async ensureLoaded({ force = false } = {}) {
    if (!force && this._hasLoaded) return this._rawJiraData;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = this.loadJiraData({ force });
    return this._loadPromise;
  }

  /**
   * Carrega o acompanhamento mensal de horas de um projeto.
   * A competência usa o formato YYYY-MM e é calculada pelo backend a partir
   * da data efetiva dos worklogs, não da data de criação do ticket.
   */
  async loadHoursDashboard(projectKey = 'CRAWFORD', competence = '') {
    const params = new URLSearchParams({ projectKey });
    if (competence) params.set('competence', competence);

    const response = await this._fetchWithTimeout(
      `${this._apiBase}/hours-dashboard?${params.toString()}`,
      { headers: this._getHeaders() },
      15000
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || `Falha ao carregar horas (${response.status})`);
    }

    return response.json();
  }

  /**
   * Transforma dados brutos do Jira para o formato interno
   */
  transformJiraData(jiraData) {
    const { issues, projects: jiraProjects, analysts: jiraAnalysts } = jiraData;
    const projectByKey = new Map();
    this._rawIssueById = new Map();
    
    // Transformar projetos
    const projects = jiraProjects.map(p => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: '',
      lead: null,
      statusFlow: [],
      createdAt: new Date().toISOString(),
      avatarUrl: p.avatar,
      plannedStartDate: this.getProjectMetadata(p.key)?.plannedStartDate || null,
      plannedEndDate: this.getProjectMetadata(p.key)?.plannedEndDate || null,
      planningNotes: this.getProjectMetadata(p.key)?.notes || '',
      planningUpdatedAt: this.getProjectMetadata(p.key)?.updatedAt || null,
    }));
    projects.forEach(project => projectByKey.set(project.key, project));
    
    // Transformar usuários/analistas
    const users = jiraAnalysts.map(a => ({
      id: a.id,
      displayName: a.name,
      email: a.email || '',
      avatarUrl: a.avatar,
      active: true
    }));
    
    // Adicionar "Não atribuído" como usuário
    const unassignedCount = issues.filter(i => !(i.assignee_id || i.assignee?.id)).length;
    if (unassignedCount > 0) {
      users.push({
        id: 'unassigned',
        displayName: 'Não Atribuído',
        email: '',
        avatarUrl: null,
        active: true
      });
    }
    
    // Transformar cards/issues
    // Formato flat (do banco Supabase): issue.project_key, issue.status_name, etc.
    const cards = issues.map(i => {
      const projectKey  = i.project_key || '';
      const assigneeId  = i.assignee_id || null;
      const statusName  = i.status_name || 'Unknown';
      const priorityName = i.priority_name || null;
      const typeName    = i.type_name || 'Task';
      const createdAt   = i.jira_created_at;
      const updatedAt   = i.jira_updated_at;
      const resolvedAt  = i.jira_resolved_at;
      const dueDate     = i.due_date;
      const plannedStartDate = i.planned_start_date || i.start_date || i.plannedStartDate || i.startDate || null;
      const plannedEndDate = i.planned_end_date || i.plannedEndDate || dueDate || null;
      const storyPoints = Number(i.story_points || i.storyPoints || 0) || 0;
      const parentKey   = i.parent_key || null;
      const parentTitle = i.parent_title || null;
      const issueId     = i.issue_id;
      const issueKey    = i.issue_key;
      const rawFields   = i.raw_fields || i.rawFields || {};
      const blockReason = jiraFieldText(rawFields.customfield_11275) || 'Motivo não informado no Jira';
      const blockedAt   = jiraFieldText(rawFields.customfield_10046)
        || rawFields.statuscategorychangedate
        || updatedAt
        || createdAt;
      this._rawIssueById.set(issueId, i);

      const isInconsistent = !assigneeId || 
                             !priorityName || 
                             !dueDate || 
                             (statusName.toLowerCase().includes('progress') && !assigneeId) ||
                             statusName === 'Unknown';

      return {
        id: issueId,
        key: issueKey,
        projectId: projectByKey.get(projectKey)?.id || projectKey,
        title: i.title || '',
        description: jiraFieldText(rawFields.description),
        assigneeId: assigneeId || 'unassigned',
        status: statusName,
        priority: this.mapPriority(priorityName),
        type: this.mapIssueType(typeName),
        createdAt,
        updatedAt,
        resolvedAt,
        dueDate,
        startDate: plannedStartDate,
        plannedStartDate,
        plannedEndDate,
        dateSource: plannedStartDate ? 'jira' : (plannedEndDate ? 'due_date_only' : 'missing'),
        jiraUrl: i.jira_url || i.jiraUrl || i.issue_url || i.self || null,
        rawFields,
        commentCount: Number(i.comment_count || i.comments_count || 0) || 0,
        humanCommentCount: Number(i.human_comment_count || i.comments_human_count || 0) || 0,
        automationCommentCount: Number(i.automation_comment_count || i.comments_automation_count || 0) || 0,
        lastCommentAt: i.last_comment_at || null,
        lastHumanCommentAt: i.last_human_comment_at || null,
        lastCommentAuthorName: i.last_comment_author_name || null,
        lastHumanCommentAuthorName: i.last_human_comment_author_name || null,
        changelogCount: Number(i.changelog_count || 0) || 0,
        assigneeHistory: i.assignee_history || [],
        statusHistory: i.status_history || [],
        blockReason: i.blocked_reason || blockReason,
        blockedAt,
        actionTaken: i.blocked_action_taken || jiraFieldText(rawFields.customfield_11377) || 'Nenhuma acao registrada',
        pendingWith: i.blocked_pending_with || jiraFieldText(rawFields.customfield_11376) || 'Nao informado',
        integrationWarnings: i.integration_warnings || [],
        sprint: null,
        storyPoints,
        labels: i.labels || [],
        components: i.components || [],
        fixVersions: i.fix_versions || i.fixVersions || [],
        timeEstimated: 0,
        timeSpent: 0,
        epicKey: parentKey,
        parentKey,
        parentTitle,
        isInconsistent
      };
    });
    this._setCollections({ projects, cards, users });
  }

  findProjectIdByKey(key) {
    const project = this._ensureDerived().projectByKey.get(key);
    return project ? project.id : key;
  }

  mapPriority(priorityName) {
    if (!priorityName) return 'medium';
    const name = priorityName.toLowerCase();
    if (name.includes('highest') || name.includes('critic')) return 'highest';
    if (name.includes('high')) return 'high';
    if (name.includes('low')) return 'low';
    if (name.includes('lowest')) return 'lowest';
    return 'medium';
  }

  mapIssueType(typeName) {
    if (!typeName) return 'task';
    const name = typeName.toLowerCase();
    if (name.includes('story')) return 'story';
    if (name.includes('bug') || name.includes('defect')) return 'bug';
    if (name.includes('epic')) return 'epic';
    if (name.includes('subtask') || name.includes('sub-task') || name.includes('subtarefa')) return 'subtask';
    return 'task';
  }

  importData(projects, cards, users) {
    const projectIds = new Set(projects.map(p => p.id));
    const invalid = cards.filter(c => !projectIds.has(c.projectId));
    if (invalid.length > 0) {
      throw new Error(`${invalid.length} card(s) sem projeto válido: ${invalid.map(c=>c.key).join(', ')}`);
    }
    this._setCollections({
      projects: [...projects],
      cards: [...cards],
      users: [...users]
    });
    this._source = DataSourceType.IMPORTED;
    this._lastSync = new Date().toISOString();
    this._notify();
  }

  getProjects() { return [...this._projects]; }
  getProjectById(id) { return this._ensureDerived().projectById.get(id) || null; }
  getProjectByKey(key) { return this._ensureDerived().projectByKey.get(key) || null; }

  getProjectStats(projectId) {
    const derived = this._ensureDerived();
    if (derived.projectStats.has(projectId)) return derived.projectStats.get(projectId);

    const cards = this.getCardsByProject(projectId);
    const total = cards.length;
    const done = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.DONE).length;
    const inProgress = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.IN_PROGRESS).length;
    const blocked = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.BLOCKED).length;
    const todo = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.TODO).length;
    const overdue = cards.filter(isCardOverdue).length;
    const progress = calculateProjectProgress(cards);
    const health = calculateProjectHealth(cards);
    const team = [...new Set(cards.map(c => c.assigneeId).filter(Boolean))];
    const storyPoints = cards.reduce((sum, c) => sum + (c.storyPoints || 0), 0);
    const storyPointsDone = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.DONE)
      .reduce((sum, c) => sum + (c.storyPoints || 0), 0);

    const stats = { total, done, inProgress, blocked, todo, overdue, progress, health, team, storyPoints, storyPointsDone };
    derived.projectStats.set(projectId, stats);
    return stats;
  }

  getProjectsRanked() {
    const derived = this._ensureDerived();
    if (!derived.projectsRanked) {
      derived.projectsRanked = this._projects
      .map(p => ({ ...p, stats: this.getProjectStats(p.id) }))
      .sort((a, b) => b.stats.progress - a.stats.progress);
    }
    return [...derived.projectsRanked];
  }

  getCards(filters = {}) {
    let result = [...this._cards];
    if (filters.projectId) result = result.filter(c => c.projectId === filters.projectId);
    if (filters.assigneeId) result = result.filter(c => c.assigneeId === filters.assigneeId);
    if (filters.status) result = result.filter(c => c.status === filters.status);
    if (filters.statusCategory) result = result.filter(c => resolveStatusCategory(c.status) === filters.statusCategory);
    if (filters.priority) result = result.filter(c => c.priority === filters.priority);
    if (filters.type) result = result.filter(c => c.type === filters.type);
    if (filters.overdue) result = result.filter(isCardOverdue);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q) ||
        (c.labels || []).some(l => l.toLowerCase().includes(q))
      );
    }
    if (filters.sortBy) {
      const dir = filters.sortDir === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        const av = a[filters.sortBy] || '';
        const bv = b[filters.sortBy] || '';
        if (typeof av === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return result;
  }

  getCardsByProject(projectId) { return [...(this._ensureDerived().cardsByProject.get(projectId) || [])]; }
  getCardById(id) { return this._cards.find(c => c.id === id) || null; }

  getUsers() { return [...this._users]; }
  getUserById(id) { return this._ensureDerived().userById.get(id) || null; }
  getStatusOptions(projectId = null) {
    if (!projectId) return [...this._ensureDerived().statusOptions];
    return [...new Set(this.getCardsByProject(projectId).map(card => card.status).filter(Boolean))].sort();
  }

  getUserStats(userId) {
    const derived = this._ensureDerived();
    if (derived.userStats.has(userId)) return derived.userStats.get(userId);

    const cards = derived.cardsByAssignee.get(userId) || [];
    const total = cards.length;
    const done = cards.filter(c => this.isDoneStatus(c.status)).length;

    const canceled = cards.filter(c => this.isCanceledStatus(c.status)).length;
    const inProgress = total - (done + canceled);
    const overdue = cards.filter(isCardOverdue).length;
    const blocked = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.BLOCKED).length;
    const projects = [...new Set(cards.map(c => c.projectId))];
    const storyPoints = cards.reduce((s, c) => s + (c.storyPoints || 0), 0);
    const storyPointsDone = cards.filter(c => resolveStatusCategory(c.status) === StatusCategory.DONE)
      .reduce((s, c) => s + (c.storyPoints || 0), 0);
    const productivity = total > 0 ? Math.round((done / total) * 100) : 0;
    const stats = { total, done, inProgress, overdue, blocked, projects, storyPoints, storyPointsDone, productivity };
    derived.userStats.set(userId, stats);
    return stats;
  }

  getUsersRanked() {
    const derived = this._ensureDerived();
    if (!derived.usersRanked) {
      derived.usersRanked = this._users
      .map(u => ({ ...u, stats: this.getUserStats(u.id) }))
      .sort((a, b) => b.stats.productivity - a.stats.productivity);
    }
    return [...derived.usersRanked];
  }

  getDashboardStats(projectFilter = null) {
    const cards = projectFilter ? this.getCardsByProject(projectFilter) : [...this._cards];
    const total = cards.length;
    const byCategory = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
    const byPriority = { highest: 0, high: 0, medium: 0, low: 0, lowest: 0 };
    let overdue = 0;
    let inconsistent = 0;

    cards.forEach(c => {
      byCategory[resolveStatusCategory(c.status)]++;
      if (byPriority[c.priority] !== undefined) byPriority[c.priority]++;
      if (isCardOverdue(c)) overdue++;
      if (c.isInconsistent) inconsistent++;
    });

    return { 
      totalProjects: this._projects.length, 
      totalCards: total, 
      byCategory, 
      byPriority, 
      overdue, 
      inconsistent,
      inconsistentTickets: cards.filter(c => c.isInconsistent)
    };
  }

  /**
   * Retorna resumo de tickets com problemas para auditoria
   */
  getDataHealthSummary(projectId = null) {
    const cards = projectId ? this.getCardsByProject(projectId) : [...this._cards];
    
    return {
      noAssignee: cards.filter(c => !c.assigneeId || c.assigneeId === 'unassigned'),
      noPriority: cards.filter(c => !c.priority || (c.priority === 'medium' && !this._rawIssueById.get(c.id)?.priority_name)),
      noDueDate: cards.filter(c => !c.dueDate),
      stuckInProgress: cards.filter(c => c.status.toLowerCase().includes('progress') && (!c.assigneeId || c.assigneeId === 'unassigned')),
      unknownStatus: cards.filter(c => c.status === 'Unknown' || resolveStatusCategory(c.status) === StatusCategory.TODO && c.status.toLowerCase().includes('unknown'))
    };
  }

  getStatusDistributionByProject() {
    return this._projects.map(p => {
      const cards = this.getCardsByProject(p.id);
      const dist = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
      cards.forEach(c => dist[resolveStatusCategory(c.status)]++);
      return { project: p, distribution: dist };
    });
  }

  getCardsByStatusGrouped(projectId = null) {
    const cards = projectId ? this.getCardsByProject(projectId) : [...this._cards];
    const statuses = [...new Set(cards.map(c => c.status))];
    return statuses.map(s => ({ status: s, count: cards.filter(c => c.status === s).length }));
  }

  getWorkloadByAnalyst(projectId = null) {
    const cards = projectId ? this.getCardsByProject(projectId) : [...this._cards];
    return this._users.map(u => {
      const userCards = cards.filter(c => c.assigneeId === u.id);
      return { user: u, total: userCards.length, inProgress: userCards.filter(c => resolveStatusCategory(c.status) === StatusCategory.IN_PROGRESS).length };
    }).filter(w => w.total > 0);
  }

  getRawJiraData() {
    return this._rawJiraData;
  }

  getBoardData() {
    if (this._rawJiraData?.board) {
      return this._rawJiraData.board;
    }
    return { columns: [] };
  }

  getMetrics() {
    if (this._rawJiraData?.metrics) {
      return this._rawJiraData.metrics;
    }
    return {};
  }

  async refreshFromJira() {
    try {
      return await this.loadJiraData({ force: true });
    } catch (error) {
      console.error('[DataService] Erro ao fazer refresh:', error);
      return null;
    }
  }

  /**
   * Retorna metadados da última sincronização.
   * Consolida informações de sync de múltiplas fontes.
   */
  getSyncMetadata() {
    const job = this._rawJiraData?.syncJob || null;
    return {
      lastSyncedAt: this._lastSync || this._rawJiraData?.lastSyncedAt || job?.finishedAt || null,
      lastSyncStatus: this._rawJiraData?.lastSyncStatus || job?.status || null,
      totalIssues: this._rawJiraData?.totalIssues || job?.totalIssues || this._cards.length,
      inserted: job?.inserted || 0,
      updated: job?.updated || 0,
      error: job?.error || this._rawJiraData?.lastSyncError || null,
      jobId: job?.id || null
    };
  }

  /**
   * Remove diacríticos (acentos) de uma string para comparação normalizada.
   * @param {string} str - Texto com possíveis acentos
   * @returns {string} Texto sem acentos, em lowercase
   */
  _stripDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Verifica se um status é considerado "concluído".
   * Normaliza acentos para cobrir variações como 'concluído' e 'concluido'.
   */
  isDoneStatus(statusName) {
    if (!statusName) return false;
    const name = this._stripDiacritics(statusName.toLowerCase());
    return (
      name.includes('done') ||
      name.includes('concluido') ||
      name.includes('finalizado') ||
      name.includes('closed') ||
      name.includes('resolved') || name.includes('completed') || name.includes('concluida') || name.includes('completo') || name.includes('completed') || name.includes('concluida') || name.includes('sucesso')
    );
  }

  /**
   * Cria o resumo executivo de um projeto
   */
  buildProjectExecutiveSummary(projectKey) {
    const rawData = this._rawJiraData;
    
    if (!rawData || !rawData.issues) {
      return null;
    }

    // Filtrar apenas issues do projeto selecionado
    const projectIssues = rawData.issues.filter(i => i.project.key === projectKey);
    
    if (projectIssues.length === 0) {
      return null;
    }

    const project = projectIssues[0].project;
    const projectModel = this.getProjectByKey(projectKey) || {
      id: project.id,
      key: project.key,
      name: project.name,
      plannedStartDate: this.getProjectMetadata(projectKey)?.plannedStartDate || null,
      plannedEndDate: this.getProjectMetadata(projectKey)?.plannedEndDate || null,
    };
    const projectCards = this.getCardsByProject(projectModel.id);
    const schedule = buildProjectScheduleSummary(projectModel, projectCards);
    const totals = {
      issues: projectIssues.length,
      done: 0,
      inProgress: 0,
      blocked: 0,
      unassigned: 0,
      notStarted: 0,
      ready4Test: 0,
      validation: 0,
      cancelled: 0,
      datePartial: projectCards.filter(card => card.dateSource === 'due_date_only').length,
    };

    // Contagem por status
    const statusCounts = {};
    const priorityCounts = {};
    
    projectIssues.forEach(issue => {
      const statusName = issue.status.name;
      const statusCategory = issue.status.category?.toLowerCase() || '';
      
      // Contagem totals
      if (this.isDoneStatus(statusName)) {
        totals.done++;
      } else if (statusCategory.includes('block')) {
        totals.blocked++;
      } else if (statusCategory.includes('indeterminate') || statusName.toLowerCase().includes('progress')) {
        totals.inProgress++;
      } else if (statusName.toLowerCase().includes('ready') || statusName.toLowerCase().includes('test') || statusName.toLowerCase().includes('qa')) {
        totals.ready4Test++;
      } else if (statusName.toLowerCase().includes('valida') || statusName.toLowerCase().includes('cliente')) {
        totals.validation++;
      } else if (statusName.toLowerCase().includes('cancel')) {
        totals.cancelled++;
      } else {
        totals.notStarted++;
      }

      // Contagem por status detalhado
      if (!statusCounts[statusName]) {
        statusCounts[statusName] = 0;
      }
      statusCounts[statusName]++;

      // Contagem por prioridade
      if (issue.priority?.name) {
        if (!priorityCounts[issue.priority.name]) {
          priorityCounts[issue.priority.name] = 0;
        }
        priorityCounts[issue.priority.name]++;
      }

      // Não atribuído
      if (!issue.assignee) {
        totals.unassigned++;
      }
    });

    // Calcular percentual de conclusão
    const progressPercent = totals.issues > 0 
      ? Math.round((totals.done / totals.issues) * 100) 
      : 0;

    // Determinar saúde do projeto (semáforo)
    let healthStatus = 'green';
    let healthLabel = 'No prazo';
    
    if (totals.blocked >= 3 || progressPercent < 30) {
      healthStatus = 'red';
      healthLabel = 'Crítico';
    } else if (totals.blocked > 0 || (progressPercent >= 30 && progressPercent < 60)) {
      healthStatus = 'yellow';
      healthLabel = 'Atenção';
    }

    // Breakdown por status
    const statusBreakdown = Object.entries(statusCounts).map(([name, count]) => ({
      name,
      count,
      percent: Math.round((count / totals.issues) * 100)
    })).sort((a, b) => b.count - a.count);

    // Time do projeto
    const teamMap = {};
    projectIssues.forEach(issue => {
      if (issue.assignee) {
        const id = issue.assignee.id;
        if (!teamMap[id]) {
          teamMap[id] = {
            id: issue.assignee.id,
            name: issue.assignee.name,
            avatar: issue.assignee.avatar,
            totalTickets: 0,
            statusMain: null
          };
        }
        teamMap[id].totalTickets++;
        
        // Status principal do analista
        const statusCat = issue.status.category?.toLowerCase() || '';
        if (this.isDoneStatus(issue.status.name)) {
          teamMap[id].statusMain = 'Concluído';
        } else if (statusCat.includes('block')) {
          teamMap[id].statusMain = 'Bloqueado';
        } else if (statusCat.includes('indeterminate')) {
          teamMap[id].statusMain = 'Em progresso';
        }
      }
    });
    const team = Object.values(teamMap).sort((a, b) => b.totalTickets - a.totalTickets);

    // Pontos de acompanhamento
    const risks = [];
    projectIssues.forEach(issue => {
      const statusName = issue.status.name.toLowerCase();
      const priorityName = issue.priority?.name?.toLowerCase() || '';
      const isBlocked = statusName.includes('block');
      const isHighPriority = priorityName.includes('high') || priorityName.includes('critic') || priorityName.includes('alta') || priorityName.includes('crítica');
      const isOld = issue.updatedAt && (Date.now() - new Date(issue.updatedAt).getTime()) > 30 * 24 * 60 * 60 * 1000; // > 30 dias

      if (isBlocked || isHighPriority || (isOld && !this.isDoneStatus(issue.status.name))) {
        let level = 'Baixo';
        let reason = '';

        if (isBlocked) {
          level = 'Alto';
          reason = 'Ticket bloqueado';
        } else if (isHighPriority && !this.isDoneStatus(issue.status.name)) {
          level = 'Alto';
          reason = `Prioridade ${issue.priority?.name || 'Alta'}`;
        } else if (isOld) {
          level = 'Médio';
          reason = 'Sem atualização há mais de 30 dias';
        }

        if (reason) {
          risks.push({
            level,
            key: issue.key,
            title: issue.title,
            reason,
            assignee: issue.assignee?.name || 'Não atribuído'
          });
        }
      }
    });
    risks.sort((a, b) => {
      const levelOrder = { 'Alto': 0, 'Médio': 1, 'Baixo': 2 };
      return levelOrder[a.level] - levelOrder[b.level];
    });

    // Últimas conquistas (tickets concluídos recentemente)
    const achievements = projectIssues
      .filter(i => this.isDoneStatus(i.status.name) && i.resolvedAt)
      .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt))
      .slice(0, 5)
      .map(i => ({
        key: i.key,
        title: i.title,
        resolvedAt: i.resolvedAt
      }));

    // Próximos passos (tickets não concluídos)
    const nextSteps = projectIssues
      .filter(i => !this.isDoneStatus(i.status.name))
      .sort((a, b) => {
        // Prioridade primeiro
        const priorityOrder = { 'Highest': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Lowest': 4 };
        const aPriority = priorityOrder[a.priority?.name] ?? 5;
        const bPriority = priorityOrder[b.priority?.name] ?? 5;
        if (aPriority !== bPriority) return aPriority - bPriority;
        // Depois por data de atualização
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      })
      .slice(0, 5)
      .map(i => ({
        key: i.key,
        title: i.title,
        status: i.status.name,
        priority: i.priority?.name || 'Medium'
      }));

    // Período analisado
    const dates = projectIssues
      .map(i => i.createdAt)
      .filter(Boolean)
      .map(d => new Date(d))
      .sort((a, b) => a - b);
    
    const period = {
      start: dates[0] ? dates[0].toISOString() : null,
      end: dates[dates.length - 1] ? dates[dates.length - 1].toISOString() : null
    };

    // Prioridade predominante
    const predominantPriority = Object.entries(priorityCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // ═══════════════════════════════════════════════
    // FAROL DO PROJETO — Planejamento vs Execução
    // Referência: D-1 (ontem), calculado dinamicamente
    // ═══════════════════════════════════════════════
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999); // Fim do dia de ontem

    let deveriaConcluido = 0;
    let realmenteConcluido = 0;

    projectIssues.forEach(issue => {
      // O campo dueDate pode vir tanto do formato flat (due_date) quanto aninhado (dueDate)
      const dueDate = issue.dueDate || issue.due_date || null;
      if (!dueDate) return;

      const dueDateParsed = new Date(dueDate);
      if (isNaN(dueDateParsed.getTime())) return; // Data inválida — ignorar

      if (dueDateParsed <= yesterday) {
        deveriaConcluido++;
        // Extrair nome do status de forma segura — issue.status pode ser objeto ou string
        const statusName = typeof issue.status === 'object' ? issue.status?.name : (issue.status_name || issue.status || '');
        if (this.isDoneStatus(statusName)) {
          realmenteConcluido++;
        }
      }
    });

    let diferencaPercentual = 0;
    if (deveriaConcluido > 0) {
      const percentualExecucao = (realmenteConcluido / deveriaConcluido) * 100;
      diferencaPercentual = Math.max(0, Math.round((100 - percentualExecucao) * 100) / 100);
    }

    let farolCor = schedule.healthStatus || 'green';
    let farolLabel = farolCor;
    if (schedule.healthStatus === 'green' && diferencaPercentual > 3) {
      farolCor = 'red';
      farolLabel = farolCor;
    } else if (schedule.healthStatus === 'green' && diferencaPercentual > 1) {
      farolCor = 'yellow';
      farolLabel = farolCor;
    }

    const farol = {
      cor: farolCor,
      label: farolLabel,
      deveriaConcluido,
      realmenteConcluido,
      diferencaPercentual,
      dataReferencia: yesterday.toISOString()
    };

    const scheduleRisks = schedule.alerts
      .filter(alert => alert.level === 'critical' || alert.level === 'warning')
      .slice(0, 6)
      .map(alert => ({
        level: alert.level === 'critical' ? 'Alto' : 'Médio',
        key: alert.code,
        title: alert.label,
        reason: 'Cronograma',
        assignee: 'Sistema'
      }));

    // Insights textuais
    const insights = [
      `O projeto possui ${totals.issues} tickets, sendo ${totals.done} concluídos, ${totals.inProgress} em andamento e ${totals.blocked} bloqueados.`
    ];
    
    if (totals.unassigned > 0) {
      insights.push(`${totals.unassigned} tickets sem responsável.`);
    }
    
    if (predominantPriority) {
      insights.push(`Prioridade predominante: ${predominantPriority}.`);
    }
    
    if (rawData.lastSyncedAt) {
      const syncDate = new Date(rawData.lastSyncedAt).toLocaleDateString('pt-BR');
      insights.push(`Última atualização dos dados: ${syncDate}.`);
    }

    return {
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        avatar: project.avatar
      },
      period,
      progressPercent,
      healthStatus,
      healthLabel,
      totals,
      statusBreakdown,
      team,
      risks: [...scheduleRisks, ...risks].slice(0, 8),
      achievements,
      nextSteps,
      insights,
      lastSync: rawData.lastSyncedAt,
      predominantPriority,
      farol,
      schedule,
      deliverables: schedule.deliverables,
      alerts: schedule.alerts
    };
  }


  isCanceledStatus(statusName) {
    if (!statusName) return false;
    const name = this._stripDiacritics(statusName.toLowerCase());
    return (
      name.includes('cancel') ||
      name.includes('rejeit') ||
      name.includes('abandon') ||
      name.includes('abort') ||
      name.includes('descontinuado') ||
      name.includes('ignora')
    );
  }

}

export const dataService = new DataService();
