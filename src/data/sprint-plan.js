import { fieldAt, sprintIds, textFromJira, timestamp } from './sprint-review.js';

export const PLAN_VERSION = 'plan-rules-1.1';
export const PLAN_STATES = Object.freeze({ draft: 'draft', baseline: 'baseline', current: 'current' });
const ORIGINS = new Set(['carry_over', 'replanned_before_close', 'new_planned']);
const canonical = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function resolvePreviousSprint(sprints, targetId) {
  const target = (sprints || []).find(item => String(item.id) === String(targetId));
  if (!target) return null;
  const targetAt = timestamp(target.startDate);
  if (!Number.isFinite(targetAt)) return null;
  return (sprints || []).filter(item => item.state === 'closed' && Number.isFinite(timestamp(item.completeDate || item.endDate)) && timestamp(item.completeDate || item.endDate) <= targetAt)
    .sort((a, b) => timestamp(b.completeDate || b.endDate) - timestamp(a.completeDate || a.endDate) || Number(b.id) - Number(a.id))[0] || null;
}

export function validatePlanProfile(input = {}) {
  const profile = structuredClone(input);
  if (!profile.sprintField || !/^(customfield_\d+)$/.test(profile.sprintField)) fail('Configure um campo Sprint valido.');
  if (!Array.isArray(profile.eligibleTypes) || !profile.eligibleTypes.length || profile.eligibleTypes.some(id => !/^\d+$/.test(String(id)))) fail('Configure tipos de issue elegiveis.');
  if (!profile.statusMap || !Object.keys(profile.statusMap).length || Object.values(profile.statusMap).some(value => !['pending', 'progress', 'testing', 'approval', 'blocked', 'done', 'cancelled'].includes(value))) fail('Configure o mapeamento canonico de status.');
  if (!['card', 'parent', 'field', 'manual', 'hybrid'].includes(profile.grouping)) fail('Configure um agrupamento valido.');
  if (profile.requireDate && !profile.executiveDateField) fail('Configure o campo de data executiva obrigatorio.');
  if (profile.executiveDateField && !/^(duedate|customfield_\d+)$/.test(profile.executiveDateField)) fail('Campo de data executiva invalido.');
  if (!profile.timezone || !/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(profile.timezone)) fail('Timezone IANA invalido.');
  profile.automation ||= {};
  return profile;
}

function membershipAt(issue, field, sprintId, cutoff) {
  const ids = sprintIds(fieldAt(issue, field, cutoff));
  return ids === null ? null : ids.includes(String(sprintId));
}
function statusAt(issue, cutoff, profile) {
  const raw = fieldAt(issue, 'status', cutoff);
  const id = typeof raw === 'object' ? raw.id : raw;
  return profile.statusMap[String(id)] || profile.statusMap[canonical(id)] || null;
}
function currentStatus(issue, profile) {
  const status = issue.fields?.status;
  return profile.statusMap[String(status?.id ?? status)] || profile.statusMap[canonical(status?.name ?? status)] || null;
}
function everInSprint(issue, field, sprintId, cutoff) {
  if (membershipAt(issue, field, sprintId, cutoff) === true) return true;
  return (issue.changelog?.histories || []).some(history => timestamp(history.created) <= timestamp(cutoff) && (history.items || []).some(item => (item.fieldId === field || item.field === 'Sprint') && [item.from, item.to].some(value => sprintIds(value)?.includes(String(sprintId)))));
}
function eligible(issue, profile) { return profile.eligibleTypes.includes(String(issue.fields?.issuetype?.id)); }
function assignee(issue, cutoff) { return fieldAt(issue, 'assignee', cutoff) || null; }
function displayDate(issue, cutoff, profile) { return profile.executiveDateField ? fieldAt(issue, profile.executiveDateField, cutoff) || null : null; }
function itemSnapshot(issue, cutoff, profile) {
  return { issueKey: issue.key, title: String(issue.fields?.summary || ''), baselineStatus: statusAt(issue, cutoff, profile), assigneeId: assignee(issue, cutoff), displayDate: displayDate(issue, cutoff, profile), group: profile.groupField ? fieldAt(issue, profile.groupField, cutoff) : issue.fields?.parent?.key || null };
}
function automated(comment, rules) {
  const author = comment.author || {};
  if ((rules.allowAccountIds || []).includes(author.accountId)) return false;
  const name = canonical(author.displayName), body = canonical(textFromJira(comment.body));
  return author.accountType === 'app' || comment.isAutomation === true || (rules.accountIds || []).includes(author.accountId) || /automation|automacao|\bbot\b/.test(name) || (rules.names || []).some(value => canonical(value) === name) || (rules.patterns || []).some(value => body.includes(canonical(value)));
}
function evidenceFor(issue, previous, baselineAt, profile) {
  const close = timestamp(previous?.completeDate), baseline = timestamp(baselineAt), seen = new Set();
  return (issue.comments || []).flatMap(comment => {
    const at = timestamp(comment.created), text = textFromJira(comment.body).trim(), duplicate = seen.has(canonical(text));
    if (!text || duplicate || automated(comment, profile.automation || {}) || !Number.isFinite(at) || at > baseline) return [];
    const window = Number.isFinite(close) && at <= close ? 'closure' : Number.isFinite(close) && at > close ? 'planning' : null;
    if (!window) return [];
    seen.add(canonical(text));
    return [{ id: `${issue.key}:comment:${comment.id}`, issueKey: issue.key, commentId: String(comment.id), timestamp: comment.created, window, text, source: 'jira_comment' }];
  });
}
function approvedReviewEvidence(issue, snapshot) {
  const review = snapshot?.review || snapshot?.payload?.review || snapshot;
  return (review?.evidence || []).filter(item => item.issueKey === issue.key && item.provenance !== 'current_only').map(item => ({ id: `review:${snapshot.id || snapshot.contentHash || 'approved'}:${item.id}`, issueKey: issue.key, sourceEvidenceId: item.id, timestamp: item.timestamp, window: 'closure', text: item.text, source: 'approved_review_snapshot' }));
}
function classifyDestination(issue, targetId, profile) {
  const state = currentStatus(issue, profile);
  if (state === 'cancelled' || state === 'done') return state;
  const ids = sprintIds(issue.fields?.[profile.sprintField]);
  if (ids?.some(id => id !== String(targetId))) return 'future_sprint';
  return ids?.length ? 'backlog' : 'unknown';
}
function readiness(items, previousPending, profile, contextOkay) {
  const mapped = items.filter(item => item.baselineStatus).length;
  const responsible = profile.requireAssignee ? items.filter(item => item.assigneeId).length : null;
  const dated = profile.requireDate ? items.filter(item => item.displayDate).length : null;
  const continuities = items.filter(item => item.primaryOrigin !== 'new_planned');
  const explained = continuities.length ? continuities.filter(item => item.evidenceIds.length).length / continuities.length : null;
  const components = [
    { key: 'context', weight: 20, score: contextOkay ? 100 : 0 },
    { key: 'assignees', weight: 20, score: responsible === null ? null : 100 * responsible / Math.max(1, items.length) },
    { key: 'dates', weight: 20, score: dated === null ? null : 100 * dated / Math.max(1, items.length) },
    { key: 'continuities', weight: 20, score: explained === null ? null : 100 * explained },
    { key: 'consistency', weight: 20, score: items.length && mapped === items.length && previousPending.every(item => item.destination !== 'unknown') ? 100 : 50 },
  ];
  const applicable = components.filter(item => Number.isFinite(item.score));
  const weights = applicable.reduce((sum, item) => sum + item.weight, 0);
  const score = weights ? Math.round(applicable.reduce((sum, item) => sum + item.score * item.weight, 0) / weights) : 0;
  return { score, classification: score >= 85 ? 'ready' : score >= 70 ? 'attention' : 'incomplete', components };
}
function deltasFrom(baseline, current) {
  if (!baseline?.items) return [];
  const before = new Map(baseline.items.map(item => [item.issueKey, item])), now = new Map(current.map(item => [item.issueKey, item]));
  const deltas = [];
  for (const [key, item] of now) {
    const old = before.get(key);
    if (!old) { deltas.push({ type: 'added', issueKey: key }); continue; }
    if (old.baselineStatus !== item.currentStatus) deltas.push({ type: 'status_changed', issueKey: key, from: old.baselineStatus, to: item.currentStatus });
    if (String(old.assigneeId || '') !== String(item.currentAssigneeId || '')) deltas.push({ type: 'assignee_changed', issueKey: key, from: old.assigneeId, to: item.currentAssigneeId });
    if (String(old.displayDate || '') !== String(item.currentDisplayDate || '')) deltas.push({ type: 'date_changed', issueKey: key, from: old.displayDate, to: item.currentDisplayDate });
  }
  for (const key of before.keys()) if (!now.has(key)) deltas.push({ type: 'removed', issueKey: key });
  return deltas;
}

export function buildSprintPlan(input = {}) {
  const profile = validatePlanProfile(input.profile);
  const target = input.targetSprint, previous = input.previousSprint || null;
  if (!target || !['future', 'active'].includes(target.state)) fail('Sprint alvo deve ser futura ou ativa.');
  const baselineAt = target.state === 'future' ? input.fetchedAt : target.startDate;
  if (!Number.isFinite(timestamp(baselineAt))) fail('Instante do planejamento invalido.');
  const candidates = (input.issues || []).filter(issue => eligible(issue, profile));
  let targetMembers = candidates.filter(issue => membershipAt(issue, profile.sprintField, target.id, baselineAt) === true);
  if (['parent', 'hybrid'].includes(profile.grouping)) {
    const referencedParents = new Set(targetMembers.map(issue => issue.fields?.parent?.key).filter(Boolean));
    targetMembers = targetMembers.filter(issue => !referencedParents.has(issue.key));
  }
  const evidence = [];
  const completedBeforeStart = [];
  let items = targetMembers.flatMap(issue => {
    const previousAtClose = previous ? membershipAt(issue, profile.sprintField, previous.id, previous.completeDate) : false;
    const previousStatus = previous ? statusAt(issue, previous.completeDate, profile) : null;
    const pendingAtClose = previousAtClose && !['done', 'cancelled'].includes(previousStatus);
    const wasPrevious = previous ? everInSprint(issue, profile.sprintField, previous.id, previous.completeDate) : false;
    const primaryOrigin = pendingAtClose ? 'carry_over' : wasPrevious ? 'replanned_before_close' : 'new_planned';
    if (!ORIGINS.has(primaryOrigin)) fail('Origem primaria invalida.');
    const reviewEvidence = primaryOrigin === 'new_planned' ? [] : approvedReviewEvidence(issue, input.reviewSnapshot);
    const jiraEvidence = primaryOrigin === 'new_planned' ? [] : evidenceFor(issue, previous, baselineAt, profile).filter(item => !reviewEvidence.length || item.window === 'planning');
    const itemEvidence = [...reviewEvidence, ...jiraEvidence];
    evidence.push(...itemEvidence);
    const snapshot = itemSnapshot(issue, baselineAt, profile);
    const current = itemSnapshot(issue, input.fetchedAt, profile);
    const createdBeforePrevious = previous && timestamp(issue.fields?.created) < timestamp(previous.startDate);
    if (snapshot.baselineStatus === 'done' && !(input.mode === 'current' && input.baselineSnapshot?.items?.some(item => item.issueKey === issue.key))) { completedBeforeStart.push({ issueKey: issue.key, reason: 'completed_before_start' }); return []; }
    return [{ ...snapshot, primaryOrigin, secondaryProvenance: primaryOrigin === 'new_planned' ? (createdBeforePrevious ? 'backlog_existing' : 'created_for_sprint') : null, carryOverCount: primaryOrigin === 'carry_over' ? Math.max(1, (sprintIds(issue.fields?.[profile.sprintField]) || []).length - 1) : 0, sprintSequence: primaryOrigin === 'carry_over' ? (sprintIds(issue.fields?.[profile.sprintField]) || []).map(String) : [], evidenceIds: itemEvidence.map(item => item.id), currentStatus: current.baselineStatus, currentAssigneeId: current.assigneeId, currentDisplayDate: current.displayDate, sourcePrecedence: input.reviewSnapshot ? 'review_snapshot+jira' : 'jira_changelog' }];
  });
  if (input.mode === 'current' && input.baselineSnapshot?.items) {
    const baselineByKey = new Map(input.baselineSnapshot.items.map(item => [item.issueKey, item]));
    items = items.map(item => baselineByKey.has(item.issueKey) ? { ...item, ...Object.fromEntries(['baselineStatus', 'assigneeId', 'displayDate', 'group', 'primaryOrigin', 'secondaryProvenance', 'carryOverCount', 'sprintSequence'].map(key => [key, baselineByKey.get(item.issueKey)[key]])) } : item);
  }
  const targetKeys = new Set(targetMembers.map(issue => issue.key));
  const previousPending = previous ? candidates.filter(issue => membershipAt(issue, profile.sprintField, previous.id, previous.completeDate) === true && !['done', 'cancelled'].includes(statusAt(issue, previous.completeDate, profile)) && !targetKeys.has(issue.key)).map(issue => ({ issueKey: issue.key, destination: classifyDestination(issue, target.id, profile) })) : [];
  const errors = [], warnings = [], info = [];
  if (!input.scopeComplete) errors.push({ code: 'incomplete_history', message: 'Historico Jira incompleto.' });
  if (!items.length) errors.push({ code: 'empty_denominator', message: 'Nenhum item elegivel no planejamento.' });
  const unmapped = items.filter(item => !item.baselineStatus).map(item => item.issueKey);
  if (unmapped.length) errors.push({ code: 'unmapped_status', issueKeys: unmapped, message: 'Existem status sem mapeamento canonico.' });
  if (!previous) info.push({ code: 'no_previous_sprint', message: 'Sem sprint anterior identificada.' });
  if (profile.source === 'system_suggested') warnings.push({ code: 'profile_suggested', message: 'Perfil inferido automaticamente a partir do Jira. Revise e salve as regras para padronizar o projeto/board.' });
  if (profile.requireAssignee) for (const item of items.filter(value => !value.assigneeId)) warnings.push({ code: 'missing_assignee', issueKey: item.issueKey, message: 'Item obrigatorio sem responsavel.' });
  if (profile.requireDate) for (const item of items.filter(value => !value.displayDate)) warnings.push({ code: 'missing_date', issueKey: item.issueKey, message: 'Item obrigatorio sem data executiva.' });
  const windowStart = String(target.startDate || '').slice(0, 10), windowEnd = String(target.endDate || '').slice(0, 10);
  for (const item of items.filter(value => value.displayDate && windowStart && windowEnd && (String(value.displayDate).slice(0, 10) < windowStart || String(value.displayDate).slice(0, 10) > windowEnd))) warnings.push({ code: 'date_outside_sprint', issueKey: item.issueKey, message: 'Data executiva fora da janela da sprint.' });
  for (const item of completedBeforeStart) warnings.push({ code: 'completed_before_start', issueKey: item.issueKey, message: 'Item concluido antes do inicio nao foi contado como trabalho previsto.' });
  for (const item of items.filter(value => value.primaryOrigin !== 'new_planned' && !value.evidenceIds.length)) warnings.push({ code: 'continuity_without_cause', issueKey: item.issueKey, message: 'Continuidade sem causa registrada.' });
  for (const pending of previousPending) warnings.push({ code: pending.destination === 'unknown' ? 'previous_pending_unknown_destination' : 'previous_pending_not_absorbed', issueKey: pending.issueKey, message: 'Pendencia anterior nao absorvida.' });
  const readinessResult = readiness(items, previousPending, profile, Boolean(input.scopeComplete && target));
  if (readinessResult.score < 70) warnings.push({ code: 'low_readiness', message: 'Prontidao do Plano incompleta.' });
  const metrics = { planned: items.length, continuities: items.filter(item => item.primaryOrigin !== 'new_planned').length, carryOvers: items.filter(item => item.primaryOrigin === 'carry_over').length, replanned: items.filter(item => item.primaryOrigin === 'replanned_before_close').length, newPlanned: items.filter(item => item.primaryOrigin === 'new_planned').length, multiSprint: items.filter(item => item.carryOverCount >= 2).length, previousPendingNotAbsorbed: previousPending.length, withDate: items.filter(item => item.displayDate).length, withoutAssignee: items.filter(item => !item.assigneeId).length };
  const state = input.mode === 'current' ? PLAN_STATES.current : target.state === 'future' ? PLAN_STATES.draft : PLAN_STATES.baseline;
  const deltas = deltasFrom(input.baselineSnapshot, items);
  return { projectKey: input.projectKey, boardId: String(input.boardId), targetSprint: target, previousSprint: previous, state, baselineAt, timezone: profile.timezone, items, excludedItems: completedBeforeStart, previousPending, deltas, activationDeltas: input.draftSnapshot ? deltasFrom(input.draftSnapshot, items) : [], metrics, readiness: readinessResult, evidence, preflight: { errors, warnings, info, canApprove: errors.length === 0 }, sourcePrecedence: input.reviewSnapshot ? 'review_snapshot+jira' : 'jira_changelog', ruleVersion: PLAN_VERSION, fetchedAt: input.fetchedAt };
}
