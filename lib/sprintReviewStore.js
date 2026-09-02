import { createHash } from 'node:crypto';
import { supabase } from './supabaseServer.js';

export function reviewHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function db() {
  if (!supabase) throw Object.assign(new Error('Supabase nao configurado para armazenar reviews.'), { status: 503 });
  return supabase;
}
function checked(result) {
  if (result.error) throw Object.assign(new Error('Nao foi possivel acessar o armazenamento de reviews. Verifique a migracao Sprint Review e as permissoes do servidor.'), { status: 503 });
  return result.data;
}
export async function insertReviewRecord({ kind, projectKey, boardId, sprintId, actor, payload, requestId }) {
  const hash = reviewHash(payload);
  const sameRequest = previous => {
    if (previous.kind !== kind || previous.project_key !== projectKey || previous.board_id !== String(boardId) || previous.sprint_id !== (sprintId ? String(sprintId) : null) || previous.content_hash !== hash) throw Object.assign(new Error('Operacao repetida com conteudo diferente.'), { status: 409 });
    return previous;
  };
  if (requestId) {
    const previous = checked(await db().from('sprint_review_records').select('*').eq('created_by', actor).eq('request_id', requestId).maybeSingle());
    if (previous) return sameRequest(previous);
  }
  const result = await db().from('sprint_review_records').insert({ kind, project_key: projectKey, board_id: String(boardId), sprint_id: sprintId ? String(sprintId) : null, created_by: actor, payload, content_hash: reviewHash(payload), request_id: requestId || null }).select('*').single();
  if (result.error?.code === '23505' && requestId) return sameRequest(checked(await db().from('sprint_review_records').select('*').eq('created_by', actor).eq('request_id', requestId).single()));
  return checked(result);
}
export async function listReviewRecords({ kind, projectKey, boardId, sprintId, snapshotId, includePayload = false }) {
  let query = db().from('sprint_review_records').select(includePayload ? '*' : 'id, revision, kind, project_key, board_id, sprint_id, created_by, created_at, content_hash').eq('kind', kind).eq('project_key', projectKey).eq('board_id', String(boardId)).order('revision', { ascending: false }).limit(100);
  if (sprintId) query = query.eq('sprint_id', String(sprintId));
  if (snapshotId) query = query.eq('payload->>snapshotId', snapshotId);
  return checked(await query);
}
export async function getReviewRecord(id) {
  return checked(await db().from('sprint_review_records').select('*').eq('id', id).single());
}
export async function latestReviewProfiles() {
  const profiles = new Map();
  for (let offset = 0; ; offset += 500) {
    const rows = checked(await db().from('sprint_review_records').select('*').eq('kind', 'profile').order('revision', { ascending: false }).range(offset, offset + 499));
    for (const row of rows) {
      const key = `${row.project_key}:${row.board_id}`;
      if (!profiles.has(key)) profiles.set(key, row);
    }
    if (rows.length < 500) return [...profiles.values()];
  }
}
