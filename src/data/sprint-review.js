// Pure historical domain model, shared by server validation and the review UI.
export const REVIEW_VERSION = '1.2.0';
export const REVIEW_STATES = { pending: 'Pendente', progress: 'Em andamento', testing: 'Testes', approval: 'Aguardando aprovacao', blocked: 'Bloqueado', done: 'Concluido', cancelled: 'Cancelado / N/A' };
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function timestamp(value) {
  // Dates without an offset are not instants. Never let the server's locale decide.
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}
export function textFromJira(value) {
  if (typeof value === 'string') return value.replace(/\[~[^\]]+\]/g, '').trim();
  if (!value || typeof value !== 'object' || value.type === 'mention') return '';
  return [value.text || '', ...(value.content || []).map(textFromJira)].filter(Boolean).join(' ').trim();
}
export function sprintIds(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    const lists = value.map(sprintIds);
    return lists.some(list => list === null) ? null : [...new Set(lists.flat())];
  }
  if (typeof value === 'object') return /^\d+$/.test(String(value.id)) ? [String(value.id)] : null;
  const raw = String(value).trim();
  if (/^\d+(\s*,\s*\d+)*$/.test(raw)) return raw.split(',').map(id => id.trim());
  const legacy = raw.match(/\bid=(\d+)(?:,|\])/);
  return legacy ? [legacy[1]] : null;
}
function events(issue, field) {
  return (issue.changelog?.histories || []).flatMap((history, index) => (history.items || [])
    .filter(item => item.fieldId === field || normalized(item.field) === normalized(field))
    .map(item => ({ ...item, at: timestamp(history.created), timestamp: history.created, id: history.id, index })))
    .sort((a, b) => a.at - b.at || a.index - b.index);
}
function scalar(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && (value.type === 'doc' || Array.isArray(value.items))) return value;
  if (value && typeof value === 'object') return value.key ?? value.accountId ?? value.id ?? value.value ?? null;
  return value ?? null;
}
export function fieldAt(issue, field, cutoff) {
  let value = scalar(issue.fields?.[field]);
  const time = timestamp(cutoff);
  for (const event of events(issue, field).reverse()) {
    if (event.at > time) value = field === 'parent' ? event.fromString ?? event.from ?? null : event.from ?? event.fromString ?? null;
  }
  return value;
}
export function confidenceScore(components) {
  const applicable = components.filter(c => Number.isFinite(c.score) && c.weight > 0);
  const weight = applicable.reduce((sum, c) => sum + c.weight, 0);
  return weight ? Math.round(applicable.reduce((sum, c) => sum + Math.max(0, Math.min(100, c.score)) * c.weight, 0) / weight) : 0;
}
export function filterReviewComments(comments, sprint, rules = {}, issueKey = '') {
  const evidence = [], excluded = [], seen = new Set();
  const start = timestamp(sprint.startDate), cutoff = timestamp(sprint.completeDate);
  for (const comment of [...comments].sort((a, b) => timestamp(a.created) - timestamp(b.created))) {
    const body = textFromJira(comment.body), text = normalized(body);
    const author = comment.author || {}, at = timestamp(comment.created);
    const allowed = (rules.allowAccountIds || []).includes(author.accountId);
    let reason = '';
    if (!Number.isFinite(at) || at < start || at > cutoff) reason = 'outside_window';
    else if (comment.updated && timestamp(comment.updated) > cutoff) reason = 'edited_after_cutoff';
    else if ((rules.accountIds || []).includes(author.accountId)) reason = 'automation_account';
    else if (!allowed && (author.accountType === 'app' || comment.isAutomation === true || /automation|automacao|\bbot\b/.test(normalized(author.displayName)) || (rules.names || []).some(name => normalized(name) === normalized(author.displayName)))) reason = 'automation_author';
    else if (['mensagem gerada automaticamente', ...(rules.patterns || [])].some(pattern => normalized(pattern) && text.includes(normalized(pattern)))) reason = 'automation_pattern';
    else if (!text || seen.has(text.replace(/[.!?]+$/g, '').trim())) reason = 'empty_or_duplicate';
    if (reason) { excluded.push({ issueKey, commentId: comment.id, reason }); continue; }
    seen.add(text.replace(/[.!?]+$/g, '').trim());
    evidence.push({ id: `${issueKey}:comment:${comment.id}`, issueKey, commentId: comment.id, type: 'comment', text: body, author: author.displayName || '', timestamp: comment.created, provenance: 'historical' });
  }
  return { evidence, excluded };
}
function checklist(value) {
  let states = [];
  if (typeof value === 'string') {
    states = value.split('\n').filter(line => /^\s*[-*]?\s*\[[ xX]\]/.test(line)).map(line => /\[[xX]\]/.test(line));
  } else if (value?.type === 'doc') {
    const visit = node => {
      if (node.type === 'taskItem') states.push(node.attrs?.state === 'DONE' ? true : node.attrs?.state === 'TODO' ? false : null);
      else for (const child of node.content || []) visit(child);
    };
    visit(value);
  } else {
    const entries = Array.isArray(value) ? value : value?.items;
    if (Array.isArray(entries)) states = entries.map(entry => typeof entry?.checked === 'boolean' ? entry.checked : typeof entry?.completed === 'boolean' ? entry.completed : null);
  }
  if (!states.length || states.includes(null)) return null;
  const completed = states.filter(Boolean).length;
  return { total: states.length, completed, pending: states.length - completed, percent: Math.round(completed / states.length * 100) };
}

// Text only raises review flags. It never changes the official workflow state.
function commentSignals(comments) {
  let pending = false, completed = false, blocked = false;
  const pendingIds = new Set(), completionIds = new Set();
  const pendingSubjects = new Map();
  const subject = text => text.replace(/\b(falta|pendente|pendencia|resolvida|resolvido|concluida|concluido|foi|esta|a|o|de|do|da)\b/g, '').replace(/[:,-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const comment of comments) {
    for (const part of comment.text.split(/[.;!\n]+/).map(normalized)) {
      if (/\b(sem pendencias?|nao (ha|existem) pendencias?|todas as pendencias (foram )?resolvidas)\b/.test(part)) {
        pending = false;
        pendingIds.clear();
        pendingSubjects.clear();
      } else if (/\b(resolvida|resolvido|concluida|concluido)\b/.test(part) && !/\bnao\b/.test(part) && pendingSubjects.has(subject(part))) {
        pendingSubjects.delete(subject(part));
        pendingIds.clear();
        for (const id of pendingSubjects.values()) pendingIds.add(id);
        pending = pendingSubjects.size > 0;
      } else if (/\b(falta|pendente|pendencia)\b/.test(part) && !/\b(nao (esta |ha )?pendente|pendencia resolvida)\b/.test(part)) {
        pending = true;
        pendingIds.add(comment.id);
        pendingSubjects.set(subject(part), comment.id);
      }
      if (/\b(nao (foi |esta )?(resolvido|concluido)|ainda nao concluido)\b/.test(part)) {
        completed = false;
        completionIds.clear();
      } else if (/^\s*(?:(?:card|entrega|item|tarefa)\s+(?:(?:foi|esta)\s+)?)?(resolvido|concluido|concluida)\b/.test(part) && !/\b(parcial|parcialmente)\b/.test(part)) {
        completed = true;
        completionIds.add(comment.id);
      }
      if (/\b(bloqueado|bloqueio)\b/.test(part) && !/\b(sem bloqueio|nao (?:ha |existe |houve |esta )?(?:bloqueio|bloqueado)|hipotetic[oa]|possivel|eventual|risco de|pode(?:ria)?|se houver)\b/.test(part)) blocked = true;
    }
  }
  return { pending, completed, blocked, pendingIds: [...pendingIds], completionIds: [...completionIds] };
}

function contextualEvidence(issue, field, cutoff) {
  const time = timestamp(cutoff), history = events(issue, field);
  let value = issue.fields?.[field];
  let historical = issue.historyComplete === true && Number.isFinite(timestamp(issue.fields?.updated)) && timestamp(issue.fields.updated) <= time;
  const later = history.filter(event => event.at > time);
  if (issue.historyComplete === true && later.length && Object.hasOwn(later[0], 'from')) {
    value = later[0].from;
    historical = true;
  } else if (issue.historyComplete === true && !later.length && history.some(event => event.at <= time)) {
    const last = history.filter(event => event.at <= time).at(-1);
    if (Object.hasOwn(last, 'to')) { value = last.to; historical = true; }
  }
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  return { id: `${issue.key}:${field}`, issueKey: issue.key, type: field === 'description' ? 'description' : 'issue_links', fieldId: field, text: field === 'description' ? textFromJira(value) : JSON.stringify(value), value, provenance: historical ? 'historical' : 'current_only', timestamp: historical ? cutoff : issue.fields?.updated || null };
}

function carryOverContext(issue, field, sprint, closingIds, applicable) {
  if (!applicable) return { status: 'not_applicable', destinations: [], complementary: [] };
  const cutoff = timestamp(sprint.completeDate), sprintId = String(sprint.id);
  const history = events(issue, field);
  const metadata = new Map((Array.isArray(issue.fields?.[field]) ? issue.fields[field] : []).filter(s => s && typeof s === 'object').map(s => [String(s.id), s]));
  const candidates = new Set([...(closingIds || []), ...metadata.keys(), ...history.flatMap(e => sprintIds(e.to) || [])]);
  const destinations = [], complementary = [];
  let unknown = issue.historyComplete !== true || closingIds === null;
  for (const id of candidates) {
    if (id === sprintId) continue;
    const data = metadata.get(id);
    const future = timestamp(data?.startDate) > cutoff || (!data?.startDate && data?.state === 'future');
    const associated = closingIds?.includes(id) && issue.historyComplete === true;
    if (future && associated) destinations.push({ id, name: data?.name || id, provenance: 'historical' });
    else if (future) {
      const event = history.find(e => e.at > cutoff && sprintIds(e.to)?.includes(id) && !sprintIds(e.from)?.includes(id));
      complementary.push({ id, name: data?.name || id, provenance: 'current_only', label: 'Associacao posterior ou nao comprovada no fechamento', timestamp: event?.timestamp || null });
      unknown = true;
    } else if (associated && !Number.isFinite(timestamp(data?.startDate))) unknown = true;
  }
  return { status: destinations.length ? 'confirmed' : unknown ? 'unknown' : 'not_identified', destinations, complementary };
}

export function buildSprintReview({ projectKey, boardId, sprint, profile = {}, issues = [], scopeComplete = false, choices = {}, baselineSnapshot = null, ai = null, mode = 'historical', historicalCompleteDate = null }) {
  const preflight = [], items = [], excludedComments = [], evidence = [], unmappedStatusIds = new Set();
  const check = (severity, code, message, issueKey = '') => preflight.push({ id: `${code}:${issueKey}`, severity, code, message, issueKey });
  const start = timestamp(sprint?.startDate), cutoff = timestamp(sprint?.completeDate);
  if (!boardId) check('error', 'board', 'Selecione o board de origem.');
  if (sprint?.state !== 'closed' || !Number.isFinite(start) || !Number.isFinite(cutoff) || start >= cutoff) check('error', 'dates', 'Sprint encerrada com datas e fuso explicitos e obrigatoria.');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: profile.timezone || '' }).format(0); } catch { check('error', 'timezone', 'Configure um timezone IANA valido.'); }
  if (!profile.version || !profile.sprintField || !profile.eligibleTypes?.length) check('error', 'profile', 'Confirme o perfil, campo Sprint e tipos elegiveis.');
  if (!scopeComplete) check('error', 'scope', 'Coleta incompleta: nao e possivel garantir o baseline e os itens removidos.');
  if (mode === 'current') check('warning', 'current_view', 'Visao reprocessada com informacoes atuais. Nao representa o estado no fechamento original e nao substitui a review historica.');
  const ids = new Set(), field = profile.sprintField;
  const savedBaseline = baselineSnapshot && baselineSnapshot.startDate === sprint.startDate ? new Map(baselineSnapshot.items.map(item => [item.key, item.fields])) : null;
  if (savedBaseline) for (const key of savedBaseline.keys()) if (!issues.some(issue => issue.key === key)) check('error', 'baseline_missing_card', 'Card do baseline salvo nao esta mais acessivel; nao e seguro concluir a review.', key);
  const relevantFields = [...new Set(['summary', 'status', 'assignee', 'duedate', 'parent', 'priority', 'issuetype', profile.startField, profile.groupField, profile.checklistField].filter(Boolean))];
  for (const issue of issues) {
    if (ids.has(issue.key)) { check('error', 'duplicate', 'Card duplicado na origem.', issue.key); continue; }
    ids.add(issue.key);
    if (timestamp(issue.fields?.created) > cutoff) continue;
    const history = issue.changelog?.histories || [];
    const membershipEvents = events(issue, field);
    const baselineIds = sprintIds(fieldAt(issue, field, sprint.startDate));
    const closingIds = sprintIds(fieldAt(issue, field, sprint.completeDate));
    const sprintId = String(sprint.id);
    const baseline = savedBaseline ? savedBaseline.has(issue.key) : timestamp(issue.fields?.created) <= start && baselineIds?.includes(sprintId);
    const entered = membershipEvents.some(event => event.at > start && event.at <= cutoff && sprintIds(event.to)?.includes(sprintId));
    const atEnd = closingIds?.includes(sprintId);
    if (!baseline && !entered && !atEnd) {
      if (!issue.historyComplete || baselineIds === null || closingIds === null) check('error', 'membership_unknown', 'Historico nao permite determinar pertencimento a sprint.', issue.key);
      continue;
    }
    if (!baselineIds || !closingIds || membershipEvents.some(event => !sprintIds(event.from) || !sprintIds(event.to))) check('error', 'membership', 'Associacao historica de sprint sem IDs interpretaveis.', issue.key);
    if (issue.historyComplete !== true || history.some(h => !Number.isFinite(timestamp(h.created))) || !Number.isFinite(timestamp(issue.fields?.created))) check('error', 'history', 'Historico incompleto ou sem timestamp confiavel.', issue.key);
    const original = savedBaseline?.get(issue.key) || Object.fromEntries(relevantFields.map(key => [key, fieldAt(issue, key, sprint.startDate)]));
    const closing = Object.fromEntries(relevantFields.map(key => [key, fieldAt(issue, key, sprint.completeDate)]));
    const type = String((baseline ? original : closing).issuetype || '');
    if (profile.eligibleTypes?.length && !profile.eligibleTypes.includes(type)) continue;
    const state = profile.statusMap?.[closing.status];
    if (!Object.hasOwn(REVIEW_STATES, state || '')) { if (closing.status) unmappedStatusIds.add(String(closing.status)); check('error', 'status', `Status ${closing.status || '(ausente)'} sem mapeamento.`, issue.key); }
    const deltas = baseline ? relevantFields.filter(key => !['status', 'summary', 'issuetype', profile.checklistField].includes(key)).flatMap(key => events(issue, key)
      .filter(event => event.at > start && event.at <= cutoff)
      .map(event => ({ field: key, from: event.fromString ?? event.from, to: event.toString ?? event.to, timestamp: event.timestamp, historyId: event.id }))) : [];
    const comments = filterReviewComments(issue.comments || [], sprint, profile.automation, issue.key);
    evidence.push(...comments.evidence);
    excludedComments.push(...comments.excluded);
    const statusEvidence = { id: `${issue.key}:status`, issueKey: issue.key, type: 'status_history', fieldId: 'status', timestamp: sprint.completeDate, provenance: 'historical', text: `Status no fechamento: ${REVIEW_STATES[state] || 'Nao mapeado'}` };
    evidence.push(statusEvidence);
    const scopeEvidence = { id: `${issue.key}:scope`, issueKey: issue.key, type: 'sprint_history', fieldId: field, timestamp: sprint.completeDate, provenance: 'historical', text: `Planejado: ${Boolean(baseline)}; associado no fechamento: ${Boolean(atEnd)}; obrigatorio: ${!(choices.optionalKeys || []).includes(issue.key)}.` };
    evidence.push(scopeEvidence);
    const baselineEvidence = { id: `${issue.key}:baseline`, issueKey: issue.key, type: 'baseline', fieldId: field, timestamp: sprint.startDate, provenance: 'historical', text: `Pertencia ao baseline: ${Boolean(baseline)}.`, value: { planned: Boolean(baseline), sprintIds: baselineIds, fields: original, source: savedBaseline ? 'snapshot' : 'changelog' } };
    const datesEvidence = { id: `${issue.key}:dates`, issueKey: issue.key, type: 'date_history', timestamp: sprint.completeDate, provenance: 'historical', text: 'Datas registradas no baseline e no fechamento.', value: Object.fromEntries([profile.startField, 'duedate'].filter(Boolean).map(key => [key, { baseline: baseline ? original[key] : null, closing: closing[key] }])) };
    evidence.push(baselineEvidence, datesEvidence);
    const contextEvidence = ['description', 'issuelinks'].map(key => contextualEvidence(issue, key, sprint.completeDate)).filter(Boolean);
    evidence.push(...contextEvidence);
    const checklistData = profile.checklistField ? checklist(closing[profile.checklistField]) : null;
    if (checklistData) {
      const checklistEvidence = { id: `${issue.key}:checklist`, issueKey: issue.key, type: 'checklist', fieldId: profile.checklistField, timestamp: sprint.completeDate, provenance: 'historical', text: JSON.stringify(closing[profile.checklistField]) };
      evidence.push(checklistEvidence);
    }
    if (profile.checklistRequired && !checklistData) check('warning', 'checklist_missing', 'Checklist obrigatorio nao analisado.', issue.key);
    const signals = commentSignals(comments.evidence);
    const conflicts = [];
    if (checklistData && ((state === 'done' && checklistData.pending > 0) || (state !== 'done' && checklistData.pending === 0))) conflicts.push({ code: 'checklist_conflict', evidenceIds: [statusEvidence.id, `${issue.key}:checklist`] });
    if ((state === 'done' && signals.pending) || (state !== 'done' && signals.completed)) conflicts.push({ code: 'comment_conflict', evidenceIds: [statusEvidence.id, ...(state === 'done' ? signals.pendingIds : signals.completionIds)] });
    const inconsistent = conflicts.length > 0;
    for (const conflict of conflicts) check('warning', conflict.code, 'Evidencia e status divergem; o status oficial foi preservado. Confirme as evidencias.', issue.key);
    const carryOverDetails = carryOverContext(issue, field, sprint, closingIds, baseline && state !== 'done');
    const laterSprints = carryOverDetails.destinations;
    if (carryOverDetails.status === 'unknown') check('warning', 'carry_over_unknown', 'Destino de continuidade nao comprovado no fechamento.', issue.key);
    if (laterSprints.length) evidence.push({ id: `${issue.key}:carry-over`, issueKey: issue.key, type: 'sprint_history', fieldId: field, timestamp: sprint.completeDate, provenance: 'historical', text: `Associado no fechamento a: ${laterSprints.map(s => s.name).join(', ')}.` });
    const during = events(issue, 'status').filter(e => e.at >= start && e.at <= cutoff);
    for (const event of during) for (const status of [event.from, event.to]) if (status && !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[status] || '')) unmappedStatusIds.add(String(status));
    if (during.some(e => !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[e.from] || '') || !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[e.to] || ''))) check('error', 'historical_status', 'Status do historico sem mapeamento; bloqueios e retrabalho nao podem ser calculados com seguranca.', issue.key);
    const blockedAtClose = state === 'blocked';
    const blocked = blockedAtClose || profile.statusMap?.[original.status] === 'blocked' || during.some(e => [e.from, e.to].some(id => profile.statusMap?.[id] === 'blocked')) || signals.blocked;
    const rank = { pending: 0, progress: 1, testing: 2, approval: 3, done: 4 };
    const rework = during.some(e => rank[profile.statusMap?.[e.from]] > rank[profile.statusMap?.[e.to]]);
    const basis = baseline ? original : closing;
    let group = issue.key;
    if (['parent', 'hybrid'].includes(profile.grouping)) group = basis.parent || issue.key;
    if (profile.grouping === 'field') group = String(basis[profile.groupField] || issue.key);
    group = choices.groups?.[issue.key] || group;
    const evidenceIds = [statusEvidence.id, scopeEvidence.id, baselineEvidence.id, datesEvidence.id, ...comments.evidence.map(e => e.id), ...contextEvidence.filter(e => e.provenance === 'historical').map(e => e.id), ...(checklistData ? [`${issue.key}:checklist`] : []), ...(laterSprints.length ? [`${issue.key}:carry-over`] : [])];
    if (state !== 'done' && !comments.evidence.length) check('warning', 'cause_missing', 'Item nao concluido no fechamento; causa nao registrada.', issue.key);
    items.push({ key: issue.key, title: closing.summary || issue.key, baseline: original, closing, planned: Boolean(baseline), removed: !atEnd, additional: !baseline, state: state || 'unknown', group: String(group), optional: (choices.optionalKeys || []).includes(issue.key), deltas, blocked, blockedOccurred: blocked, blockedAtClose, rework, checklist: checklistData, checklistStatus: checklistData ? 'analyzed' : 'not_applicable', inconsistent, conflicts, carryOver: carryOverDetails.status === 'confirmed', carryOverStatus: carryOverDetails.status, carryOverDetails, laterSprints, contextEvidence, evidenceIds, humanComments: comments.evidence.length });
  }
  // Exclude parent units whenever eligible children represent that same delivery.
  const parentKeys = new Set(items.map(item => (item.planned ? item.baseline : item.closing).parent).filter(Boolean));
  const eligible = profile.allowParentChildAsDistinct ? items : items.filter(item => !parentKeys.has(item.key));
  if (profile.grouping === 'hybrid') {
    const suggestions = new Map();
    for (const item of eligible) {
      if (item.group !== item.key || choices.groups?.[item.key]) continue;
      const title = String((item.planned ? item.baseline : item.closing).summary || '');
      const prefix = title.split(/\s[-\u2013\u2014]\s|:\s/)[0].trim();
      if (prefix.length < 8 || prefix === title) continue;
      const key = normalized(prefix);
      if (!suggestions.has(key)) suggestions.set(key, { title: prefix, members: [] });
      suggestions.get(key).members.push(item);
    }
    for (const suggestion of suggestions.values()) if (suggestion.members.length > 1) {
      for (const item of suggestion.members) { item.group = suggestion.title; item.groupSuggestion = 'shared_title_prefix'; }
    }
  }
  const grouped = new Map();
  for (const item of eligible) {
    const id = `${item.planned ? 'baseline' : 'additional'}:${item.group}`;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(item);
  }
  const deliveries = [...grouped].map(([id, members]) => {
    const required = members.filter(item => !item.optional);
    if (!required.length) check('error', `optional_${id}`, 'Entrega sem cards obrigatorios.');
    const done = required.filter(item => item.state === 'done' && !item.removed).length;
    const result = required.length && done === required.length ? 'done' : required.length && required.every(item => item.removed) ? 'removed' : done ? 'partial' : required.some(item => !item.removed && item.blockedAtClose) ? 'blocked' : 'continuity';
    const dates = phase => [...new Set(members.flatMap(item => [profile.startField, 'duedate'].filter(Boolean).map(key => item[phase][key])).filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)))].sort();
    return { id, title: members[0].group === members[0].key ? members[0].title : members[0].group, planned: members[0].planned, keys: members.map(item => item.key), requiredKeys: required.map(item => item.key), result, plannedDates: members[0].planned ? dates('baseline') : [], closingDates: dates('closing'), progress: required.length ? Math.round(done / required.length * 100) : 0, evidenceIds: members.flatMap(item => item.evidenceIds) };
  });
  const planned = deliveries.filter(item => item.planned), completed = planned.filter(item => item.result === 'done').length;
  if (!planned.length) check('error', 'denominator', 'Baseline vazio: confirme os dados e o agrupamento.');
  const metrics = { planned: planned.length, completed, achievement: planned.length ? Math.round(completed / planned.length * 100) : 0, additional: deliveries.filter(item => !item.planned).length, additionalCompleted: deliveries.filter(item => !item.planned && item.result === 'done').length, removed: eligible.filter(item => item.removed).length, carryOver: eligible.filter(item => item.carryOver).length, carryOverUnknown: eligible.filter(item => item.carryOverStatus === 'unknown').length, replanned: eligible.filter(item => item.deltas.length).length, blocked: eligible.filter(item => item.blocked).length, rework: eligible.filter(item => item.rework).length };
  const ratio = predicate => eligible.length ? eligible.filter(predicate).length / eligible.length * 100 : 0;
  const applicableChecklists = profile.checklistField ? eligible.filter(item => profile.checklistRequired || item.checklist) : [];
  const checklistScore = applicableChecklists.length ? applicableChecklists.filter(item => item.checklist && !item.conflicts.some(conflict => conflict.code === 'checklist_conflict')).length / applicableChecklists.length * 100 : null;
  const components = [{ name: 'Historico e baseline', score: preflight.some(p => p.severity === 'error') ? 0 : 100, weight: 30 }, { name: 'Comentarios humanos', score: ratio(i => i.humanComments > 0), weight: 25 }, { name: 'Checklist', score: checklistScore, weight: 15 }, { name: 'Consistencia', score: ratio(i => !i.inconsistent), weight: 20 }, { name: 'Campos', score: ratio(i => i.closing.assignee && i.closing.duedate), weight: 10 }];
  const confidence = confidenceScore(components);
  if (confidence < (profile.confidenceThresholds?.[1] ?? 60)) check('warning', 'confidence', 'Confianca baixa: revise e confirme antes de exportar.');
  if (!choices.confirmGrouping) check('warning', 'grouping_confirmation', 'Confirme a composicao das entregas principais.');
  if (ai?.status === 'generated') check('warning', 'ai_review', `Revise as ${ai.suggestions.length} interpretacoes sugeridas pela NVIDIA e confirme suas evidencias. A IA nao altera as metricas.`);
  else check('info', 'deterministic', `Sintese deterministica. IA NVIDIA: ${{ unconfigured: 'nao configurada', no_evidence: 'sem evidencias humanas suficientes', rate_limited: 'limite de uso atingido', unavailable: 'indisponivel', rejected: 'resposta rejeitada pela validacao' }[ai?.status] || 'nao solicitada'}. Causas nao sao inferidas.`);
  if (ai?.coverage && !ai.coverage.complete) check('warning', 'ai_partial', 'Parte dos cards permaneceu com texto deterministico. A sintese por IA nao cobriu todas as evidencias.');
  const thresholds = profile.thresholds || [90, 70, 50];
  let classification = metrics.achievement >= thresholds[0] ? 'Meta atingida' : metrics.achievement >= thresholds[1] ? 'Meta parcialmente atingida' : metrics.achievement >= thresholds[2] ? 'Meta abaixo do planejado' : 'Meta nao atingida';
  const criticalPending = eligible.filter(item => item.planned && !item.optional && (item.state !== 'done' || item.removed) && profile.criticalPriorityIds?.includes(String(item.closing.priority)));
  if (criticalPending.length && classification === 'Meta atingida') {
    classification = 'Meta parcialmente atingida';
    check('warning', 'critical_cap', 'A classificacao foi limitada por pendencia critica do baseline. O percentual numerico nao foi alterado.');
  }
  const statements = eligible.map(item => {
    const factText = item.state === 'done' ? `${item.title}: concluido${item.inconsistent ? ' com ressalva' : ''} no fechamento.` : `${item.title}: nao concluido no fechamento; ${item.humanComments ? 'consulte os registros humanos para revisar o contexto.' : 'causa nao registrada.'}`;
    const suggestion = ai?.status === 'generated' ? ai.suggestions?.find(s => s.issueKey === item.key && typeof s.text === 'string' && s.text.trim() && s.evidenceIds?.length && s.evidenceIds.every(id => item.evidenceIds.includes(id))) : null;
    const factEvidenceIds = [...new Set([`${item.key}:status`, ...item.conflicts.flatMap(c => c.evidenceIds)])];
    return { id: `${item.key}:statement`, issueKey: item.key, factText, text: suggestion?.text || factText, kind: suggestion ? 'interpretation' : 'fact', status: suggestion ? 'suggested' : 'deterministic', evidenceIds: suggestion ? [...new Set(suggestion.evidenceIds)] : factEvidenceIds, factEvidenceIds, ...(suggestion ? { suggestion, requiresHumanReview: true, confirmed: false, semanticVerification: suggestion.semanticVerification || 'not_performed', verification: suggestion.verification || 'literal_attribution_only' } : {}) };
  });
  for (const delivery of deliveries) evidence.push({ id: `${delivery.id}:result`, type: 'delivery_result', timestamp: sprint.completeDate, provenance: 'historical', text: `${delivery.title}: ${delivery.result}.`, value: { planned: delivery.planned, keys: delivery.keys, requiredKeys: delivery.requiredKeys, result: delivery.result, plannedDates: delivery.plannedDates, closingDates: delivery.closingDates }, evidenceIds: delivery.keys.flatMap(key => [`${key}:baseline`, `${key}:scope`, `${key}:status`, `${key}:dates`]) });
  const detail = (id, text, evidenceIds, kind = 'fact') => ({ id, text, evidenceIds, kind });
  const block = (id, details, summary, { candidates = [], limit = 210, fallback } = {}) => {
    // Select whole records only. Long names and quotations remain intact in details.
    const oversizedSummary = summary.text.length > limit;
    let selected = oversizedSummary ? fallback : summary;
    let text = selected.text;
    const quote = candidates.find(entry => text.length + entry.text.length + 1 <= limit);
    const requiresHumanReview = oversizedSummary || details.some(entry => entry.requiresHumanReview) || (candidates.length > 0 && !quote);
    if (quote) text += ` ${quote.text}`;
    else if (candidates.length) {
      const notice = ' Registro completo na lista detalhada; requer revisao humana.';
      if (text.length + notice.length <= limit) text += notice;
      else {
        selected = fallback;
        text = fallback.text;
        if (text.length + notice.length <= limit) text += notice;
      }
    }
    return { id: `executive:${id}`, text, evidenceIds: [...new Set([...selected.evidenceIds, ...(quote?.evidenceIds || [])])], kind: quote?.semanticVerification === 'model_reviewed' ? 'interpretation' : quote ? 'synthesis' : selected.kind, overflow: details.some(entry => !text.includes(entry.text)), requiresHumanReview, status: requiresHumanReview ? 'pending_review' : 'deterministic', ...(quote ? { semanticVerification: quote.semanticVerification, verification: quote.verification, confirmed: false } : {}), detailIds: details.map(entry => entry.id), details };
  };
  const deliveryDetails = list => list.map(delivery => detail(`${delivery.id}:detail`, `${delivery.title}: ${{ done: 'concluida', partial: 'parcial', blocked: 'bloqueada no fechamento', removed: 'removida', continuity: 'nao concluida no fechamento' }[delivery.result]}.`, [`${delivery.id}:result`]));
  // A model's support judgment permits interpretation, never upgrades it to a proven fact.
  const quotes = keys => statements.filter(statement => keys.has(statement.issueKey)).flatMap(statement => {
    const suggestion = statement.suggestion, quote = suggestion?.quote;
    if (typeof quote !== 'string' || !quote.trim()) return [];
    const modelReviewed = suggestion.semanticVerification === 'model_reviewed';
    const sources = evidence.filter(record => statement.evidenceIds.includes(record.id) && record.provenance === 'historical' && (record.type === 'comment' || (modelReviewed && ['description', 'checklist'].includes(record.type))) && record.text.includes(quote));
    if (!sources.length) return [];
    const text = modelReviewed ? statement.text : `${statement.issueKey}, registro humano: "${quote}".`;
    return [{ ...detail(statement.id, text, sources.map(source => source.id), 'interpretation'), quote, issueKey: statement.issueKey, classification: suggestion.classification, semanticVerification: modelReviewed ? 'model_reviewed' : 'not_performed', verification: modelReviewed ? 'model_reviewed' : 'literal_attribution_only', requiresHumanReview: true, status: 'pending_review', confirmed: false }];
  });
  const pending = planned.filter(delivery => delivery.result !== 'done');
  const succeeded = deliveries.filter(delivery => delivery.result === 'done').sort((a, b) => Number(b.planned) - Number(a.planned));
  const attentionKeys = new Set([...pending.flatMap(delivery => delivery.keys), ...eligible.filter(item => item.inconsistent).map(item => item.key)]);
  const positiveQuotes = quotes(new Set(succeeded.flatMap(delivery => delivery.keys))).filter(entry => ((entry.semanticVerification === 'model_reviewed' && ['progress', 'resolution'].includes(entry.classification?.category)) || /\b(concluid[oa]|resolvid[oa]|entregue)\b/.test(normalized(entry.text))) && !/\b(nao|falta|pendente|pendencia|parcialmente)\b/.test(normalized(entry.text)));
  const attentionQuotes = quotes(attentionKeys);
  const nextStepQuotes = quotes(new Set(eligible.map(item => item.key))).filter(entry => (entry.semanticVerification === 'model_reviewed' && entry.classification?.category === 'next_step') || /\b(proximo passo|proxima acao)\b/.test(normalized(entry.text)));
  const resultIds = deliveries.map(delivery => `${delivery.id}:result`);
  const numeric = detail('executive:baseline-result', `${completed} de ${planned.length} entregas planejadas concluidas (${metrics.achievement}%). Escopo adicional concluido: ${metrics.additionalCompleted}.`, resultIds);
  const carry = eligible.filter(item => item.carryOver);
  const successDetails = deliveryDetails(succeeded);
  const pendingDetails = deliveryDetails(pending);
  const conflictDetails = eligible.filter(item => item.inconsistent).map(item => detail(`${item.key}:conflict`, `${item.title}: divergencia entre status e evidencia; requer revisao.`, item.conflicts.flatMap(conflict => conflict.evidenceIds)));
  const carryDetails = carry.map(item => detail(`${item.key}:next-step`, `${item.title}: associado no fechamento a ${item.laterSprints.map(s => s.name).join(', ')}.`, [`${item.key}:carry-over`]));
  const summary = (id, text, ids = resultIds) => detail(`${id}:summary`, text, ids);
  const additionalText = metrics.additionalCompleted ? ` Mais ${metrics.additionalCompleted} entrega(s) adicional(is) concluida(s).` : '';
  const highlightSummary = summary('highlight', `${successDetails[0]?.text || 'Nenhuma entrega concluida no fechamento.'}${additionalText}`);
  const attentionDetails = [...pendingDetails, ...conflictDetails];
  const attentionSummary = summary('attention', attentionDetails.length ? `${attentionDetails[0].text}${attentionDetails.length > 1 ? ` Outros pontos de atencao: ${attentionDetails.length - 1}.` : ''}` : 'Sem entregas planejadas pendentes ou conflitos identificados.');
  const mainAchievement = deliveryDetails(succeeded.filter(delivery => delivery.planned))[0];
  const achievementSummary = summary('achievement', `${mainAchievement?.text || 'Nenhuma entrega planejada concluida.'} Atingimento: ${metrics.achievement}%.`);
  const destinations = new Set(carry.flatMap(item => item.laterSprints.map(destination => destination.id)));
  const nextSummary = summary('next-step', carry.length ? `${carry[0].title}: associado no fechamento a ${carry[0].laterSprints[0].name}.${destinations.size > 1 ? ` Outros destinos: ${destinations.size - 1}.` : ''}` : nextStepQuotes.length ? 'Proximo passo registrado:' : 'Sem proximo passo ou destino comprovado nas evidencias selecionadas.', carry.map(item => `${item.key}:carry-over`));
  const reasonQuotes = attentionQuotes.filter(entry => (entry.semanticVerification === 'model_reviewed' && entry.classification?.cause && entry.classification.cause !== 'undocumented') || /\b(porque|devido|motivo|causa|por falta)\b/.test(normalized(entry.text)));
  const justificationSummary = summary('justification', `${numeric.text}${pending.length && !reasonQuotes.length ? ' Causa nao registrada nas evidencias selecionadas.' : ''}`);
  const executive = {
    highlight: block('highlight', [...positiveQuotes, ...successDetails, highlightSummary], highlightSummary, { candidates: positiveQuotes, fallback: summary('highlight', `${succeeded.length} entrega(s) concluida(s).${additionalText} Entrega principal na lista detalhada.`) }),
    attention: block('attention', [...attentionQuotes, ...attentionDetails, attentionSummary], attentionSummary, { candidates: attentionQuotes, fallback: summary('attention', `${attentionDetails.length} ponto(s) de atencao. Consulte a lista detalhada.`) }),
    justification: block('justification', [numeric, ...attentionQuotes, ...positiveQuotes, ...pendingDetails, ...successDetails], justificationSummary, { candidates: reasonQuotes, fallback: summary('justification', `${completed} de ${planned.length} entregas planejadas concluidas (${metrics.achievement}%).`) }),
    achievement: block('achievement', [achievementSummary, ...positiveQuotes, ...deliveryDetails(succeeded.filter(delivery => delivery.planned))], achievementSummary, { candidates: positiveQuotes, limit: 160, fallback: summary('achievement', `${completed} entrega(s) planejada(s) concluida(s); atingimento: ${metrics.achievement}%. Principal conquista na lista detalhada.`) }),
    nextStep: block('next-step', [...nextStepQuotes, ...carryDetails, nextSummary], nextSummary, { candidates: nextStepQuotes, limit: 160, fallback: summary('next-step', destinations.size ? `Continuidade associada a ${destinations.size} destino(s). Consulte a lista detalhada.` : 'Proximo passo na lista detalhada.', carry.map(item => `${item.key}:carry-over`)) }),
  };
  return { engineVersion: REVIEW_VERSION, mode, historicalCompleteDate, goalSuggestion: ai?.goalSuggestion || null, unmappedStatusIds: [...unmappedStatusIds], baselineSource: savedBaseline ? 'snapshot' : 'changelog', projectKey, boardId: String(boardId), sprint, profile, choices, items: eligible, deliveries, metrics, confidence, components, classification, preflight, evidence, excludedComments, statements, executive, summary: `${mode === 'current' ? 'Visao reprocessada com dados atuais. ' : ''}${classification}: ${completed} de ${planned.length} entregas principais concluidas (${metrics.achievement}%). Escopo adicional: ${metrics.additional}, apresentado separadamente.` };
}
