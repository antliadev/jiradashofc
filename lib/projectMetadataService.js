import { supabase } from './supabaseServer.js';

const TABLE = 'jira_project_metadata';

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isMissingTableError(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /relation .* does not exist/i.test(message)
    || /table .* not found/i.test(message);
}

function mapRow(row) {
  return {
    projectKey: row.project_key,
    projectId: row.project_id || null,
    projectName: row.project_name || null,
    plannedStartDate: row.planned_start_date || null,
    plannedEndDate: row.planned_end_date || null,
    notes: row.notes || '',
    updatedAt: row.updated_at || null,
  };
}

export async function listProjectMetadata(projectKey = null) {
  if (!supabase) {
    return { metadata: [], persistence: 'unconfigured' };
  }

  let query = supabase
    .from(TABLE)
    .select('project_key, project_id, project_name, planned_start_date, planned_end_date, notes, updated_at')
    .order('project_key', { ascending: true });

  if (projectKey) query = query.eq('project_key', String(projectKey).toUpperCase());

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return { metadata: [], persistence: 'missing_table' };
    }
    throw new Error(`Erro ao ler metadata de projetos: ${error.message}`);
  }

  return {
    metadata: (data || []).map(mapRow),
    persistence: 'supabase',
  };
}

export async function upsertProjectMetadata(input) {
  if (!supabase) {
    return { metadata: null, persistence: 'unconfigured' };
  }

  const projectKey = String(input?.projectKey || '').trim().toUpperCase();
  if (!projectKey) throw new Error('projectKey e obrigatorio.');

  const payload = {
    project_key: projectKey,
    project_id: input.projectId || null,
    project_name: input.projectName || null,
    planned_start_date: normalizeDate(input.plannedStartDate),
    planned_end_date: normalizeDate(input.plannedEndDate),
    notes: input.notes || '',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: 'project_key' })
    .select('project_key, project_id, project_name, planned_start_date, planned_end_date, notes, updated_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return { metadata: null, persistence: 'missing_table' };
    }
    throw new Error(`Erro ao salvar metadata do projeto: ${error.message}`);
  }

  return {
    metadata: mapRow(data),
    persistence: 'supabase',
  };
}
