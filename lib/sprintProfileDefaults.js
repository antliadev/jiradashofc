const canonical = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function inferStatusState(status = {}) {
  const name = canonical(status.name);
  const category = canonical(status.statusCategory?.key || status.statusCategory?.name);
  if (category === 'done' || /\b(done|concluid[oa]|finalizad[oa]|resolvid[oa]|cancelad[oa])\b/.test(name)) return /cancelad[oa]/.test(name) ? 'cancelled' : 'done';
  if (/\b(cancelad[oa]|rejeitad[oa]|descartad[oa]|nao se aplica|n\/a)\b/.test(name)) return 'cancelled';
  if (/\b(bloquead[oa]|blocked|impedid[oa])\b/.test(name)) return 'blocked';
  if (/\b(teste|testes|testing|qa|homologacao)\b/.test(name)) return 'testing';
  if (/\b(aprovacao|aprovar|approval|review)\b/.test(name)) return 'approval';
  if (category === 'indeterminate' || /\b(andamento|progresso|progress|doing|desenvolvimento|execucao)\b/.test(name)) return 'progress';
  return 'pending';
}

function sprintField(fields = []) {
  return fields.find(field => field.schema?.custom?.endsWith(':gh-sprint'))?.id
    || fields.find(field => canonical(field.name) === 'sprint')?.id
    || '';
}

function typeIds(types = []) {
  return types.map(type => String(type.id)).filter(id => /^\d+$/.test(id));
}

function statusMap(types = []) {
  return Object.fromEntries(types.flatMap(type => type.statuses || [])
    .filter(status => /^\d+$/.test(String(status.id)))
    .map(status => [String(status.id), inferStatusState(status)]));
}

export function buildSuggestedReviewProfile({ types = [], fields = [] } = {}) {
  return {
    version: 'system-suggested',
    source: 'system_suggested',
    timezone: 'America/Sao_Paulo',
    logo: 'antlia',
    sprintField: sprintField(fields),
    checklistField: '',
    startField: '',
    groupField: '',
    grouping: 'hybrid',
    checklistRequired: false,
    eligibleTypes: typeIds(types),
    allowParentChildAsDistinct: false,
    statusMap: statusMap(types),
    automation: {
      accountIds: [],
      allowAccountIds: [],
      names: ['Automation for Jira'],
      patterns: ['Mensagem Gerada Automaticamente'],
    },
    thresholds: [90, 70, 50],
    confidenceThresholds: [80, 60],
    criticalPriorityIds: [],
    causeTaxonomy: ['approval', 'external_dependency', 'quality', 'business_definition', 'technical_dependency'],
  };
}

export function buildSuggestedPlanProfile({ types = [], fields = [] } = {}) {
  return {
    version: 'system-suggested',
    source: 'system_suggested',
    timezone: 'America/Sao_Paulo',
    sprintField: sprintField(fields),
    executiveDateField: 'duedate',
    grouping: 'hybrid',
    eligibleTypes: typeIds(types),
    requireAssignee: false,
    requireDate: false,
    statusMap: statusMap(types),
    automation: {
      accountIds: [],
      allowAccountIds: [],
      names: ['Automation for Jira'],
      patterns: ['Mensagem Gerada Automaticamente'],
    },
  };
}
