import { createHash } from 'node:crypto';
import { DEFAULT_NVIDIA_MODEL, NVIDIA_CHAT_ENDPOINT } from './ai/nvidiaRuntimeConfig.js';

const POLICY_VERSION = 'sprint-plan-ai-1.0';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clean = value => String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitido]').replace(/\b(?:Bearer\s+|nvapi-|sk-)[A-Za-z0-9_./+=-]{12,}/g, '[credencial omitida]').trim();

export function buildPlanAIContext(plan) {
  const evidence = (plan.evidence || []).map(entry => ({ id: entry.id, issueKey: entry.issueKey, source: entry.source, window: entry.window, text: clean(entry.text).slice(0, 1800) }));
  return {
    policyVersion: POLICY_VERSION,
    sprint: { id: plan.targetSprint?.id, name: clean(plan.targetSprint?.name), startDate: plan.targetSprint?.startDate, endDate: plan.targetSprint?.endDate },
    previousSprint: plan.previousSprint ? { id: plan.previousSprint.id, name: clean(plan.previousSprint.name) } : null,
    items: (plan.items || []).map(item => ({ issueKey: item.issueKey, displayName: clean(item.displayName), origin: item.primaryOrigin, addedAfterBaseline: Boolean(item.addedAfterBaseline), date: item.displayDate, evidenceIds: item.evidenceIds || [] })),
    previousPending: (plan.previousPending || []).map(item => ({ issueKey: item.issueKey, displayName: clean(item.displayName), destination: item.destination })),
    evidence,
  };
}

export function validatePlanAISynthesis(response, context) {
  const knownItems = new Map([...context.items, ...context.previousPending].map(item => [item.issueKey, item]));
  const knownEvidence = new Map(context.evidence.map(item => [item.id, item]));
  const priorities = [], seen = new Set();
  for (const entry of Array.isArray(response?.priorities) ? response.priorities : []) {
    const item = knownItems.get(entry?.issueKey);
    const evidenceIds = Array.isArray(entry?.evidenceIds) ? [...new Set(entry.evidenceIds)] : [];
    const supported = evidenceIds.length > 0 && evidenceIds.every(id => knownEvidence.get(id)?.issueKey === entry.issueKey);
    if (!item || seen.has(entry.issueKey) || !supported || !['carry_over', 'commitment', 'new_scope', 'risk'].includes(entry.category)) continue;
    const text = clean(entry.text).slice(0, 280);
    if (!text || /ignore (?:as|the) instru/i.test(text)) continue;
    seen.add(entry.issueKey);
    priorities.push({ issueKey: entry.issueKey, displayName: item.displayName, category: entry.category, text, evidenceIds });
  }
  return { priorities: priorities.slice(0, 12), abstentions: [...knownItems.keys()].filter(issueKey => !seen.has(issueKey)).map(issueKey => ({ issueKey, reason: 'sem_sintese_validada' })) };
}

export async function synthesizeSprintPlan(plan, { apiKey = process.env.NVIDIA_API_KEY, model = process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL, fetchImpl = fetch } = {}) {
  const context = buildPlanAIContext(plan);
  const audit = { provider: 'nvidia', model, policyVersion: POLICY_VERSION, contextHash: hash(context) };
  const fallback = status => ({ ...audit, status, priorities: [], abstentions: context.items.map(item => ({ issueKey: item.issueKey, reason: 'sem_sintese_validada' })) });
  if (!apiKey) return fallback('unconfigured');
  if (!context.evidence.length) return fallback('no_evidence');
  const instructions = 'Analise o planejamento de sprint em pt-BR. Use somente os cards e evidenceIds fornecidos. Retorne JSON estrito {"priorities":[{"issueKey":"...","category":"carry_over|commitment|new_scope|risk","text":"...","evidenceIds":["..."]}]}. Nunca altere metricas, datas ou status. Nao inclua raciocinio interno.';
  try {
    const response = await fetchImpl(NVIDIA_CHAT_ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0, max_tokens: 3072, stream: false, ...(model.startsWith('nvidia/nemotron-') ? { chat_template_kwargs: { enable_thinking: false } } : {}), messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(context) }] }) });
    if (!response.ok) return fallback(response.status === 429 ? 'rate_limited' : 'unavailable');
    const payload = await response.json();
    if (payload.choices?.[0]?.finish_reason !== 'stop') return fallback('unavailable');
    const raw = String(payload.choices[0].message?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const validated = validatePlanAISynthesis(JSON.parse(raw), context);
    return { ...audit, ...validated, status: validated.priorities.length ? 'generated' : 'rejected', responseHash: hash(raw) };
  } catch { return fallback('unavailable'); }
}
