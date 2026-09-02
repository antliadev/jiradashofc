// Pure historical domain model, shared by server validation and the review UI.
export const REVIEW_VERSION = '1.1.0';
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
    else if (!text || seen.has(text)) reason = 'empty_or_duplicate';
    if (reason) { excluded.push({ issueKey, commentId: comment.id, reason }); continue; }
    seen.add(text);
    evidence.push({ id: `${issueKey}:comment:${comment.id}`, issueKey, commentId: comment.id, type: 'comment', text: body, author: author.displayName || '', timestamp: comment.created });
  }
  return { evidence, excluded };
}
function checklist(value) {
  if (typeof value !== 'string') return null;
  const lines = value.split('\n').filter(line => /^\s*[-*]?\s*\[[ xX]\]/.test(line));
  if (!lines.length) return null;
  const completed = lines.filter(line => /\[[xX]\]/.test(line)).length;
  return { total: lines.length, completed, pending: lines.length - completed, percent: Math.round(completed / lines.length * 100) };
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
    const statusEvidence = { id: `${issue.key}:status`, issueKey: issue.key, type: 'status_history', fieldId: 'status', timestamp: sprint.completeDate, text: `Status no fechamento: ${REVIEW_STATES[state] || 'Nao mapeado'}` };
    evidence.push(statusEvidence);
    const checklistData = profile.checklistField ? checklist(closing[profile.checklistField]) : null;
    if (checklistData) {
      const checklistEvidence = { id: `${issue.key}:checklist`, issueKey: issue.key, type: 'checklist', fieldId: profile.checklistField, timestamp: sprint.completeDate, text: String(closing[profile.checklistField]) };
      evidence.push(checklistEvidence);
    }
    if (profile.checklistRequired && !checklistData) check('warning', 'checklist_missing', 'Checklist obrigatorio nao analisado.', issue.key);
    const inconsistent = checklistData && ((state === 'done' && checklistData.pending > 0) || (state !== 'done' && checklistData.pending === 0));
    if (inconsistent) check('warning', 'checklist_conflict', 'Checklist e status divergem; o status oficial foi preservado.', issue.key);
    const humanText = comments.evidence.map(e => normalized(e.text)).join('\n');
    const residual = state === 'done' && /\b(falta|pendente|pendencia)\b/.test(humanText);
    if (residual || (state !== 'done' && /\b(resolvido|concluido)\b/.test(humanText))) check('warning', 'comment_conflict', 'Texto humano pode divergir do status; confirme as evidencias.', issue.key);
    const laterSprints = (Array.isArray(issue.fields?.[field]) ? issue.fields[field] : []).filter(s => String(s.id) !== sprintId && timestamp(s.startDate) > cutoff).map(s => ({ id: s.id, name: s.name || String(s.id) }));
    const during = events(issue, 'status').filter(e => e.at >= start && e.at <= cutoff);
    for (const event of during) for (const status of [event.from, event.to]) if (status && !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[status] || '')) unmappedStatusIds.add(String(status));
    if (during.some(e => !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[e.from] || '') || !Object.hasOwn(REVIEW_STATES, profile.statusMap?.[e.to] || ''))) check('error', 'historical_status', 'Status do historico sem mapeamento; bloqueios e retrabalho nao podem ser calculados com seguranca.', issue.key);
    const blocked = state === 'blocked' || profile.statusMap?.[original.status] === 'blocked' || during.some(e => profile.statusMap?.[e.to] === 'blocked');
    const rank = { pending: 0, progress: 1, testing: 2, approval: 3, done: 4 };
    const rework = during.some(e => rank[profile.statusMap?.[e.from]] > rank[profile.statusMap?.[e.to]]);
    const basis = baseline ? original : closing;
    let group = issue.key;
    if (['parent', 'hybrid'].includes(profile.grouping)) group = basis.parent || issue.key;
    if (profile.grouping === 'field') group = String(basis[profile.groupField] || issue.key);
    group = choices.groups?.[issue.key] || group;
    const evidenceIds = [statusEvidence.id, ...comments.evidence.map(e => e.id), ...(checklistData ? [`${issue.key}:checklist`] : [])];
    if (state !== 'done' && !comments.evidence.length) check('warning', 'cause_missing', 'Item nao concluido no fechamento; causa nao registrada.', issue.key);
    items.push({ key: issue.key, title: closing.summary || issue.key, baseline: original, closing, planned: Boolean(baseline), removed: !atEnd, additional: !baseline, state: state || 'unknown', group: String(group), optional: (choices.optionalKeys || []).includes(issue.key), deltas, blocked, rework, checklist: checklistData, inconsistent: Boolean(inconsistent || residual), carryOver: baseline && state !== 'done' && laterSprints.length > 0, laterSprints, evidenceIds, humanComments: comments.evidence.length });
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
    const result = required.length && done === required.length ? 'done' : members.every(item => item.removed) ? 'removed' : done ? 'partial' : members.some(item => item.blocked) ? 'blocked' : 'continuity';
    return { id, title: members[0].group === members[0].key ? members[0].title : members[0].group, planned: members[0].planned, keys: members.map(item => item.key), requiredKeys: required.map(item => item.key), result, progress: required.length ? Math.round(done / required.length * 100) : 0, evidenceIds: members.flatMap(item => item.evidenceIds) };
  });
  const planned = deliveries.filter(item => item.planned), completed = planned.filter(item => item.result === 'done').length;
  if (!planned.length) check('error', 'denominator', 'Baseline vazio: confirme os dados e o agrupamento.');
  const metrics = { planned: planned.length, completed, achievement: planned.length ? Math.round(completed / planned.length * 100) : 0, additional: deliveries.filter(item => !item.planned).length, additionalCompleted: deliveries.filter(item => !item.planned && item.result === 'done').length, removed: eligible.filter(item => item.removed).length, carryOver: eligible.filter(item => item.carryOver).length, replanned: eligible.filter(item => item.deltas.length).length, blocked: eligible.filter(item => item.blocked).length, rework: eligible.filter(item => item.rework).length };
  const ratio = predicate => eligible.length ? eligible.filter(predicate).length / eligible.length * 100 : 0;
  const components = [{ name: 'Historico e baseline', score: preflight.some(p => p.severity === 'error') ? 0 : 100, weight: 30 }, { name: 'Comentarios humanos', score: ratio(i => i.humanComments > 0), weight: 25 }, { name: 'Checklist', score: profile.checklistField && (profile.checklistRequired || eligible.some(i => i.checklist)) ? ratio(i => i.checklist && !i.inconsistent) : null, weight: 15 }, { name: 'Consistencia', score: ratio(i => !i.inconsistent), weight: 20 }, { name: 'Campos', score: ratio(i => i.closing.assignee && i.closing.duedate), weight: 10 }];
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
    const suggestion = ai?.suggestions?.find(s => s.issueKey === item.key);
    return { id: `${item.key}:statement`, issueKey: item.key, factText, text: suggestion?.text || factText, evidenceIds: item.evidenceIds, ...(suggestion ? { suggestion } : {}) };
  });
  return { engineVersion: REVIEW_VERSION, mode, historicalCompleteDate, goalSuggestion: ai?.goalSuggestion || null, unmappedStatusIds: [...unmappedStatusIds], baselineSource: savedBaseline ? 'snapshot' : 'changelog', projectKey, boardId: String(boardId), sprint, profile, choices, items: eligible, deliveries, metrics, confidence, components, classification, preflight, evidence, excludedComments, statements, summary: `${mode === 'current' ? 'Visao reprocessada com dados atuais. ' : ''}${classification}: ${completed} de ${planned.length} entregas principais concluidas (${metrics.achievement}%). Escopo adicional: ${metrics.additional}, apresentado separadamente.` };
}
