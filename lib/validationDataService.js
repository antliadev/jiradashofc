import { MOCK_CARDS, MOCK_PROJECTS, MOCK_USERS } from '../src/data/mock-data.js';
import { buildDashboardData } from './jiraService.js';
import { passwordLoginAllowed } from './loginMode.js';
import { supabase } from './supabaseServer.js';

const VALIDATION_SYNC_AT = '2026-09-04T12:00:00.000Z';

function validationModeEnabled(env = process.env) {
  return passwordLoginAllowed(env) && !supabase;
}

function priorityName(priority) {
  return ({
    highest: 'Highest',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    lowest: 'Lowest',
  })[priority] || 'Medium';
}

function typeName(type) {
  return ({
    epic: 'Epic',
    story: 'Story',
    task: 'Task',
    bug: 'Bug',
    subtask: 'Sub-task',
  })[type] || 'Task';
}

function statusCategory(status = '') {
  const normalized = status.toLowerCase();
  if (/done|conclu|finalizado|closed|resolved/.test(normalized)) return 'done';
  if (/block|bloq|impedido/.test(normalized)) return 'indeterminate';
  if (/progress|andamento|desenvolvimento|review|revis|testing|teste|qa/.test(normalized)) return 'indeterminate';
  return 'new';
}

function validationIssues() {
  const projects = new Map(MOCK_PROJECTS.map(project => [project.id, project]));
  const users = new Map(MOCK_USERS.map(user => [user.id, user]));

  return MOCK_CARDS.map(card => {
    const project = projects.get(card.projectId) || {};
    const assignee = users.get(card.assigneeId) || {};
    return {
      id: card.id,
      issue_id: card.id,
      issue_key: card.key,
      title: card.title,
      project_id: project.id || card.projectId,
      project_key: project.key || card.projectId,
      project_name: project.name || project.key || card.projectId,
      project_avatar: project.avatarUrl || null,
      status_id: card.status,
      status_name: card.status,
      status_category: statusCategory(card.status),
      type_id: card.type,
      type_name: typeName(card.type),
      type_icon: null,
      priority_id: card.priority,
      priority_name: priorityName(card.priority),
      priority_icon: null,
      assignee_id: assignee.id || null,
      assignee_name: assignee.displayName || null,
      assignee_email: assignee.email || null,
      assignee_avatar: assignee.avatarUrl || null,
      reporter_id: null,
      reporter_name: null,
      reporter_avatar: null,
      creator_id: null,
      creator_name: null,
      creator_avatar: null,
      labels: card.labels || [],
      components: [],
      fix_versions: [],
      parent_key: card.epicKey || null,
      parent_title: null,
      jira_created_at: card.createdAt,
      jira_updated_at: card.updatedAt || card.createdAt,
      jira_resolved_at: /done|conclu|finalizado/i.test(card.status) ? card.updatedAt || card.createdAt : null,
      due_date: card.dueDate,
      start_date: card.createdAt,
      planned_start_date: card.createdAt,
      planned_end_date: card.dueDate,
      jira_url: `https://antliaprojetos.atlassian.net/browse/${encodeURIComponent(card.key)}`,
      story_points: card.storyPoints || 0,
      comment_count: 0,
      human_comment_count: 0,
      automation_comment_count: 0,
      last_comment_at: null,
      last_comment_author_id: null,
      last_comment_author_name: null,
      last_human_comment_at: null,
      last_human_comment_author_id: null,
      last_human_comment_author_name: null,
      changelog_count: 0,
      assignee_history: [],
      status_history: [],
      blocked_reason: /block|bloq/i.test(card.status) ? 'Registro de validacao: item bloqueado para testar filtros e alertas.' : null,
      blocked_action_taken: /block|bloq/i.test(card.status) ? 'Validar tratamento na tela.' : null,
      blocked_pending_with: /block|bloq/i.test(card.status) ? 'Equipe de validacao' : null,
      integration_warnings: ['Dados de validacao: nao usar como evidencia real de Jira.'],
      synced_at: VALIDATION_SYNC_AT,
      created_at: card.createdAt,
    };
  });
}

function withValidationMetadata(data) {
  return {
    ...data,
    dataSource: 'validation-fixture',
    validationMode: true,
    lastSyncedAt: VALIDATION_SYNC_AT,
    lastSyncStatus: 'success',
    syncJob: validationSyncJob(),
    info: 'Dados de validacao carregados porque o Supabase de homologacao nao esta configurado.',
  };
}

export function validationSyncJob() {
  if (!validationModeEnabled()) return null;
  return {
    id: 'develop-validation-fixture',
    status: 'success',
    baseUrl: 'validation-fixture',
    emailMasked: 'admin',
    totalIssues: MOCK_CARDS.length,
    inserted: 0,
    updated: MOCK_CARDS.length,
    error: null,
    logs: ['Dados de validacao ativos no develop porque o Supabase nao esta configurado.'],
    startedAt: VALIDATION_SYNC_AT,
    finishedAt: VALIDATION_SYNC_AT,
    createdAt: VALIDATION_SYNC_AT,
    updatedAt: VALIDATION_SYNC_AT,
  };
}

export function validationDashboardData() {
  if (!validationModeEnabled()) return null;
  return withValidationMetadata(buildDashboardData(validationIssues()));
}

export function validationIssuesPage(filters = {}, options = {}) {
  const data = validationDashboardData();
  if (!data) return null;
  const filtered = data.issues.filter(issue => {
    if (filters.project && issue.project_key !== filters.project) return false;
    if (filters.status && issue.status_name !== filters.status) return false;
    if (filters.assignee && issue.assignee_id !== filters.assignee) return false;
    if (filters.priority && issue.priority_name !== filters.priority) return false;
    if (filters.type && issue.type_name !== filters.type) return false;
    return true;
  });
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(options.offset, 10) || 0, 0);
  return {
    total: filtered.length,
    limit,
    offset,
    issues: filtered.slice(offset, offset + limit),
    dataSource: data.dataSource,
    validationMode: true,
  };
}
