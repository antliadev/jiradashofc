import { supabase } from './supabaseServer.js';

const PROJECT_COLUMNS = 'id, name, client, start_date, end_date, status, note, color, created_by, created_at, updated_at';
const ALLOCATION_COLUMNS = 'id, user_id, user_name, user_email, project_id, start_date, end_date, percent, role, note, created_by, created_at, updated_at';
const EVENT_COLUMNS = 'id, action, project_id, allocation_id, actor, created_at, before, after';

const db = client => {
  const resolved = client || supabase;
  if (!resolved) throw Object.assign(new Error('Supabase nao configurado para Alocacao de Recursos.'), { status: 503 });
  return resolved;
};

const checked = result => {
  if (result.error) throw Object.assign(new Error('Nao foi possivel acessar Alocacao de Recursos. Verifique a migration e as permissoes do servidor.'), { status: 503, cause: result.error });
  return result.data;
};

function normalizeText(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : text;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function normalizeResourceProject(project = {}, actor = '') {
  const startDate = normalizeDate(project.startDate || project.start_date);
  const endDate = normalizeDate(project.endDate || project.end_date);
  const normalized = {
    id: validUuid(project.id) ? project.id : undefined,
    name: normalizeText(project.name, 180),
    client: normalizeText(project.client, 120),
    start_date: startDate,
    end_date: endDate,
    status: normalizeText(project.status, 40),
    note: normalizeText(project.note, 1000),
    color: normalizeText(project.color, 24) || null,
    created_by: String(actor || '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  const errors = [];
  if (!normalized.name) errors.push('Nome do projeto é obrigatório.');
  if (!normalized.start_date) errors.push('Data de início do projeto é obrigatória.');
  if (!normalized.end_date) errors.push('Data prevista de término do projeto é obrigatória.');
  if (!normalized.status) errors.push('Status do projeto é obrigatório.');
  if (normalized.start_date && normalized.end_date && normalized.end_date < normalized.start_date) errors.push('Data final do projeto não pode ser anterior à inicial.');
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  return normalized;
}

export function normalizeResourceAllocation(allocation = {}, actor = '') {
  const startDate = normalizeDate(allocation.startDate || allocation.start_date);
  const endDate = normalizeDate(allocation.endDate || allocation.end_date);
  const percent = Number(allocation.percent);
  const normalized = {
    id: validUuid(allocation.id) ? allocation.id : undefined,
    user_id: normalizeText(allocation.userId || allocation.user_id, 120),
    user_name: normalizeText(allocation.userName || allocation.user_name, 180),
    user_email: normalizeText(allocation.userEmail || allocation.user_email, 180),
    project_id: String(allocation.projectId || allocation.project_id || '').trim(),
    start_date: startDate,
    end_date: endDate,
    percent,
    role: normalizeText(allocation.role, 120),
    note: normalizeText(allocation.note, 1000),
    created_by: String(actor || '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  const errors = [];
  if (!normalized.user_id) errors.push('Profissional é obrigatório.');
  if (!validUuid(normalized.project_id)) errors.push('Projeto é obrigatório.');
  if (!normalized.start_date) errors.push('Data inicial da alocação é obrigatória.');
  if (!normalized.end_date) errors.push('Data final da alocação é obrigatória.');
  if (!Number.isFinite(percent) || percent <= 0 || percent > 200) errors.push('Percentual de alocação deve estar entre 1 e 200.');
  if (normalized.start_date && normalized.end_date && normalized.end_date < normalized.start_date) errors.push('Data final da alocação não pode ser anterior à inicial.');
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  return normalized;
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    note: row.note,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function allocationFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    projectId: row.project_id,
    startDate: row.start_date,
    endDate: row.end_date,
    percent: Number(row.percent),
    role: row.role,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventFromRow(row) {
  return {
    id: row.id,
    action: row.action,
    projectId: row.project_id,
    allocationId: row.allocation_id,
    actor: row.actor,
    createdAt: row.created_at,
    before: row.before,
    after: row.after,
  };
}

export async function listResourceAllocationState(client) {
  const database = db(client);
  const [projects, allocations, history] = await Promise.all([
    database.from('resource_allocation_projects').select(PROJECT_COLUMNS).order('name', { ascending: true }),
    database.from('resource_allocations').select(ALLOCATION_COLUMNS).order('start_date', { ascending: true }),
    database.from('resource_allocation_events').select(EVENT_COLUMNS).order('created_at', { ascending: false }).limit(200),
  ]);
  return {
    projects: checked(projects).map(projectFromRow),
    allocations: checked(allocations).map(allocationFromRow),
    history: checked(history).map(eventFromRow),
  };
}

export async function upsertResourceProject({ project, actor }, client) {
  const database = db(client);
  const payload = normalizeResourceProject(project, actor);
  const previous = payload.id ? checked(await database.from('resource_allocation_projects').select(PROJECT_COLUMNS).eq('id', payload.id).maybeSingle()) : null;
  const saved = checked(await database.from('resource_allocation_projects').upsert(payload, { onConflict: 'id' }).select(PROJECT_COLUMNS).single());
  checked(await database.from('resource_allocation_events').insert({
    action: previous ? 'project.updated' : 'project.created',
    project_id: saved.id,
    actor,
    before: previous || null,
    after: saved,
  }).select('id').single());
  return projectFromRow(saved);
}

export async function upsertResourceAllocation({ allocation, actor }, client) {
  const database = db(client);
  const payload = normalizeResourceAllocation(allocation, actor);
  const project = checked(await database.from('resource_allocation_projects').select('id').eq('id', payload.project_id).maybeSingle());
  if (!project) throw Object.assign(new Error('Projeto de alocação não encontrado.'), { status: 404 });
  const previous = payload.id ? checked(await database.from('resource_allocations').select(ALLOCATION_COLUMNS).eq('id', payload.id).maybeSingle()) : null;
  const saved = checked(await database.from('resource_allocations').upsert(payload, { onConflict: 'id' }).select(ALLOCATION_COLUMNS).single());
  checked(await database.from('resource_allocation_events').insert({
    action: previous ? 'allocation.updated' : 'allocation.created',
    project_id: saved.project_id,
    allocation_id: saved.id,
    actor,
    before: previous || null,
    after: saved,
  }).select('id').single());
  return allocationFromRow(saved);
}
