import { DEFAULT_STATUS_MAP, isCardOverdue, resolveStatusCategory, StatusCategory } from './models.js';

export const HEALTH_CONFIG_VERSION = '1.1';
export const DEFAULT_HEALTH_CONFIG = Object.freeze({
  weights: Object.freeze({ prazo: 30, execucao: 20, bloqueios: 15, qualidade: 15, escopo: 10, governanca: 10 }),
  staleAfterHours: 48,
  upcomingDays: 2,
  hardCaps: Object.freeze({ overdueCriticalMilestone: 69, overdueWorkdays5: 49, blockedWorkdays3: 69, blockedWorkdays5: 49, overdueProject: 49 }),
  excludedProjectKeys: Object.freeze(['MAR', 'P1']),
});

export const HEALTH_DIMENSIONS = Object.freeze([
  { key: 'prazo', label: 'Prazo', weight: 30 },
  { key: 'execucao', label: 'Execucao', weight: 20 },
  { key: 'bloqueios', label: 'Bloqueios', weight: 15 },
  { key: 'qualidade', label: 'Qualidade', weight: 15 },
  { key: 'escopo', label: 'Escopo', weight: 10 },
  { key: 'governanca', label: 'Governanca', weight: 10 },
]);

const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const toDate = value => value ? new Date(value) : null;
const validDate = value => value instanceof Date && !Number.isNaN(value.getTime());
const cardDone = (card, statusMap) => resolveStatusCategory(String(card.status || ''), statusMap) === StatusCategory.DONE;
const cardBlocked = (card, statusMap) => resolveStatusCategory(String(card.status || ''), statusMap) === StatusCategory.BLOCKED;
const hasDueDate = card => Boolean(card.dueDate || card.plannedEndDate);
const hasOwner = card => Boolean(card.assigneeId && card.assigneeId !== 'unassigned');
const hasPriority = card => Boolean(card.rawPriority || (card.priority && card.priority !== 'medium'));
const cardOverdue = (card, now) => {
  if (card.dueDate && isCardOverdue(card, now)) return true;
  const plannedEnd = toDate(card.plannedEndDate);
  return !cardDone(card) && validDate(plannedEnd) && plannedEnd < now;
};

function normalizedStatus(card, statusMap) {
  const raw = String(card.status || '').trim().toLowerCase();
  return statusMap?.[raw] || resolveStatusCategory(String(card.status || ''));
}

function isMappedStatus(card, statusMap) {
  const raw = String(card.status || '').trim().toLowerCase();
  return Boolean(statusMap?.[raw] || DEFAULT_STATUS_MAP[raw]);
}

export function businessDaysBetween(start, end = new Date()) {
  const from = toDate(start);
  const until = toDate(end);
  if (!validDate(from) || !validDate(until) || until <= from) return 0;
  let days = 0;
  const cursor = new Date(from);
  cursor.setHours(12, 0, 0, 0);
  while (cursor < until) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function statusAge(card, now) {
  const history = Array.isArray(card.statusHistory) ? card.statusHistory : [];
  const latest = [...history].reverse().find(item => item.to || item.toValue || item.status);
  return businessDaysBetween(latest?.at || latest?.createdAt || latest?.date || card.updatedAt, now);
}

function criticality(card) {
  const value = String(card.priority || card.criticality || '').toLowerCase();
  if (value.includes('highest') || value.includes('critical') || value.includes('crit')) return 1.5;
  if (value.includes('high')) return 1.25;
  return 1;
}

function cardRisks(card, now, config) {
  if (cardDone(card, config.statusMap)) return {};
  const end = toDate(card.plannedEndDate || card.dueDate);
  const daysToDue = validDate(end) ? Math.ceil((end - now) / 86400000) : null;
  const age = statusAge(card, now);
  const raw = card.rawFields || card.raw_fields || {};
  const reopened = Number(card.reopenCount || raw.reopen_count || raw.reopened_count || 0);
  return {
    prazo: cardOverdue(card, now) ? 100 : daysToDue !== null && daysToDue <= config.upcomingDays ? 70 : daysToDue === null ? 35 : 0,
    execucao: normalizedStatus(card, config.statusMap) === StatusCategory.TODO ? 45 : 0,
    bloqueios: cardBlocked(card, config.statusMap) ? (age > 5 ? 100 : age > 3 ? 80 : 60) : 0,
    qualidade: card.type === 'bug' ? 75 : reopened > 0 ? Math.min(100, 40 + reopened * 15) : 0,
    escopo: !hasDueDate(card) ? 45 : 0,
    governanca: Math.min(100, (!hasOwner(card) ? 55 : 0) + (!hasPriority(card) ? 35 : 0) + (card.changelogCount === 0 ? 10 : 0)),
    meta: { overdue: cardOverdue(card, now), daysToDue, statusAge: age, criticality: criticality(card) },
  };
}

export function classifyProjectHealth(score, hasCards = true, confidence = 100, hardCap = null) {
  if (!hasCards || confidence < 60) return { key: 'unknown', label: 'Sem dados suficientes' };
  const effective = hardCap === null ? score : Math.min(score, hardCap);
  if (confidence < 80) return { key: effective >= 50 ? 'attention' : 'risk', label: effective >= 50 ? 'Atencao' : 'Em risco' };
  if (effective >= 85) return { key: 'healthy', label: 'Saudavel' };
  if (effective >= 70) return { key: 'attention', label: 'Atencao' };
  if (effective >= 50) return { key: 'risk', label: 'Em risco' };
  return { key: 'critical', label: 'Critico' };
}

export function calculateConfidence(cards = [], metadata = {}, config = DEFAULT_HEALTH_CONFIG) {
  if (!cards.length) return { score: 0, level: 'low', components: {} };
  const status = cards.filter(card => isMappedStatus(card, config.statusMap)).length / cards.length;
  const required = cards.filter(card => hasOwner(card) && hasDueDate(card)).length / cards.length;
  const dates = cards.filter(hasDueDate).length / cards.length;
  const history = cards.filter(card => Number(card.changelogCount || 0) > 0 || (card.statusHistory || []).length > 0).length / cards.length;
  const hierarchy = cards.filter(card => card.parentKey || card.epicKey || card.type !== 'subtask').length / cards.length;
  const syncedAt = toDate(metadata.lastSyncedAt);
  const ageHours = validDate(syncedAt) ? (Date.now() - syncedAt.getTime()) / 3600000 : Infinity;
  const freshness = ageHours <= 24 ? 1 : ageHours <= config.staleAfterHours ? 0.5 : 0;
  const components = { statusMapping: status * 25, requiredFields: required * 25, dates: dates * 20, history: history * 10, hierarchy: hierarchy * 10, freshness: freshness * 10 };
  const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0));
  return { score, level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low', components, stale: freshness === 0 };
}

export function calculateCardImpact(card = {}, options = {}) {
  const risks = cardRisks(card, options.now ? toDate(options.now) : new Date(), { ...DEFAULT_HEALTH_CONFIG, ...options });
  const entries = Object.entries(risks).filter(([key]) => key !== 'meta').sort((a, b) => b[1] - a[1]);
  const risk = clamp(Math.max(...entries.map(([, value]) => value), 0) * (risks.meta?.criticality || 1));
  const reasons = entries.filter(([, value]) => value > 0).slice(0, 3).map(([key]) => HEALTH_DIMENSIONS.find(item => item.key === key)?.label || key);
  return { risk, impact: risk, health: 100 - risk, reasons, risks };
}

export function calculateProjectHealth(cards = [], options = {}) {
  const config = { ...DEFAULT_HEALTH_CONFIG, ...options, weights: { ...DEFAULT_HEALTH_CONFIG.weights, ...(options.weights || {}) }, hardCaps: { ...DEFAULT_HEALTH_CONFIG.hardCaps, ...(options.hardCaps || {}) } };
  const now = options.now ? toDate(options.now) : new Date();
  const activeCards = cards.filter(card => !cardDone(card, config.statusMap));
  const confidence = calculateConfidence(cards, options.metadata || {}, config);
  const riskRows = activeCards.map(card => cardRisks(card, now, config));
  const dimensions = HEALTH_DIMENSIONS.map(dimension => {
    const risks = riskRows.map(row => row[dimension.key] || 0);
    const risk = risks.length ? risks.reduce((sum, value) => sum + value, 0) / risks.length : 0;
    const weight = Number(config.weights[dimension.key] ?? dimension.weight);
    return { ...dimension, weight, score: clamp(100 - risk), rawScore: 100 - risk, risk: clamp(risk), impact: Math.round((risk * weight) / 100) };
  });
  const rawScore = cards.length ? dimensions.reduce((sum, dimension) => sum + dimension.rawScore * dimension.weight, 0) / 100 : null;
  const criticalOverdue = activeCards.some(card => cardOverdue(card, now) && criticality(card) > 1);
  const overdueWorkdays5 = activeCards.some(card => cardOverdue(card, now) && businessDaysBetween(card.dueDate || card.plannedEndDate, now) > 5);
  const blockedWorkdays3 = activeCards.some(card => cardBlocked(card, config.statusMap) && statusAge(card, now) > 3);
  const blockedWorkdays5 = activeCards.some(card => cardBlocked(card, config.statusMap) && statusAge(card, now) > 5);
  const projectOverdue = activeCards.length > 0 && activeCards.every(card => cardOverdue(card, now));
  const caps = [];
  if (criticalOverdue) caps.push({ reason: 'Marco critico atrasado', max: config.hardCaps.overdueCriticalMilestone });
  if (overdueWorkdays5) caps.push({ reason: 'Pendencia atrasada ha mais de 5 dias uteis', max: config.hardCaps.overdueWorkdays5 });
  if (blockedWorkdays3) caps.push({ reason: 'Bloqueio ha mais de 3 dias uteis', max: config.hardCaps.blockedWorkdays3 });
  if (blockedWorkdays5) caps.push({ reason: 'Bloqueio ha mais de 5 dias uteis', max: config.hardCaps.blockedWorkdays5 });
  if (projectOverdue) caps.push({ reason: 'Projeto vencido com itens incompletos', max: config.hardCaps.overdueProject });
  const hardCap = caps.length ? Math.min(...caps.map(item => item.max)) : null;
  const score = rawScore === null ? null : Math.min(clamp(rawScore), hardCap ?? 100);
  const impacts = dimensions.filter(item => item.impact > 0).sort((a, b) => b.impact - a.impact);
  return { score, rawScore: rawScore === null ? null : clamp(rawScore), dimensions, impacts, reasons: [...caps.map(cap => cap.reason), ...impacts.slice(0, 3).map(item => `${item.label}: ${item.score}/100`)].slice(0, 5), confidence, hardCap, caps, configVersion: HEALTH_CONFIG_VERSION, classification: classifyProjectHealth(score || 0, cards.length > 0, confidence.score, hardCap) };
}
