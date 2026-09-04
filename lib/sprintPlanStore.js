import { createHash } from 'node:crypto';
import { supabase } from './supabaseServer.js';

export const planHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const database = client => {
  const resolved = client || supabase;
  if (!resolved) throw Object.assign(new Error('Supabase nao configurado para armazenar planos.'), { status: 503 });
  return resolved;
};
const checked = result => {
  if (result.error) throw Object.assign(new Error('Nao foi possivel acessar o armazenamento do Sprint Plan. Verifique a migration e as permissoes do servidor.'), { status: 503 });
  return result.data;
};
export async function insertPlanRecord({ kind, projectKey, boardId, sprintId, actor, payload, requestId }, client) {
  if (!['profile', 'source', 'draft', 'baseline', 'snapshot'].includes(kind)) throw Object.assign(new Error('Tipo de registro de plano invalido.'), { status: 400 });
  const hash = planHash(payload), db = database(client);
  const same = previous => {
    if (!previous || previous.kind !== kind || previous.project_key !== projectKey || previous.board_id !== String(boardId) || previous.sprint_id !== String(sprintId || '') || previous.content_hash !== hash) throw Object.assign(new Error('Operacao repetida com conteudo diferente.'), { status: 409 });
    return previous;
  };
  if (requestId) {
    const previous = checked(await db.from('sprint_plan_records').select('*').eq('created_by', actor).eq('request_id', requestId).maybeSingle());
    if (previous) return same(previous);
  }
  const result = await db.from('sprint_plan_records').insert({ kind, project_key: projectKey, board_id: String(boardId), sprint_id: String(sprintId || ''), created_by: actor, payload, content_hash: hash, request_id: requestId || null }).select('*').single();
  if (result.error?.code === '23505' && requestId) return same(checked(await db.from('sprint_plan_records').select('*').eq('created_by', actor).eq('request_id', requestId).single()));
  return checked(result);
}
export async function listPlanRecords({ kind, projectKey, boardId, sprintId, includePayload = false }, client) {
  let query = database(client).from('sprint_plan_records').select(includePayload ? '*' : 'id, revision, kind, project_key, board_id, sprint_id, created_by, created_at, content_hash').eq('kind', kind).eq('project_key', projectKey).eq('board_id', String(boardId)).order('revision', { ascending: false }).limit(100);
  if (sprintId) query = query.eq('sprint_id', String(sprintId));
  return checked(await query);
}
export async function getPlanRecord(id, client) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw Object.assign(new Error('Registro de plano invalido.'), { status: 400 });
  return checked(await database(client).from('sprint_plan_records').select('*').eq('id', id).single());
}
