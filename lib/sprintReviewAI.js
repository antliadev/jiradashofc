import { createHash } from 'node:crypto';
import { passageCategories, sprintReviewPolicy as policy } from './ai/sprintReviewPolicy.js';
import { validateExtraction } from './ai/sprintReviewSchema.js';
import { evidenceCandidates, relevance } from './ai/sprintReviewEvidence.js';
import { reviewDrafts, splitDrafts } from './ai/sprintReviewVerifier.js';

export const REVIEW_AI_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clean = value => String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitido]').replace(/\b(?:Bearer\s+|nvapi-|sk-)[A-Za-z0-9_./+=-]{12,}/g, '[credencial omitida]');

export function buildReviewAIContext(review) {
  const priority = [...review.items].sort((a, b) => Number(a.state === 'done') - Number(b.state === 'done') || a.key.localeCompare(b.key));
  const items = priority.map(item => {
    const evidence = [], omitted = [], candidates = [], ids = new Set();
    let chars = 0;
    // Rank relevance and recency for the budget, keeping each selected record intact.
    const records = (review.evidence || []).filter(e => e.issueKey === item.key && ['comment', 'checklist', 'description'].includes(e.type))
      .sort((a, b) => Number(a.type === 'description') - Number(b.type === 'description') || relevance(String(b.text || '')) - relevance(String(a.text || '')) || String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || String(a.id).localeCompare(String(b.id)));
    for (const record of records) {
      const text = clean(record.text).trim();
      const provenanceKnown = record.provenance !== undefined;
      const validityKnown = record.temporalValidity !== undefined;
      const historicallyValid = (!provenanceKnown || record.provenance === 'historical')
        && (!validityKnown || record.temporalValidity === 'historical_verified')
        && (provenanceKnown || validityKnown || record.type !== 'description');
      const temporalValidity = historicallyValid ? 'historical_verified' : 'unavailable';
      let reason;
      if (typeof record.id !== 'string' || ids.has(record.id)) reason = 'ambiguous_id';
      else if (temporalValidity !== 'historical_verified') reason = 'temporal_unknown';
      else if (!text) reason = 'empty';
      else if (chars + text.length > policy.maxEvidenceChars) reason = 'context_budget';
      ids.add(record.id);
      if (reason) { omitted.push({ id: record.id, reason }); continue; }
      chars += text.length;
      const included = { id: record.id, type: record.type, text, timestamp: record.timestamp || null, provenance: 'historical', temporalValidity, use: record.type === 'description' ? 'scope_only' : 'attributed_record', contentHash: hash(text) };
      evidence.push(included);
      candidates.push(...evidenceCandidates(included, item.key));
    }
    const selectedCandidates = candidates.sort((a, b) => relevance(b.quote) - relevance(a.quote)).slice(0, policy.maxCandidates);
    return { issueKey: item.key, state: item.state, evidence, candidates: selectedCandidates, selection: { considered: records.length, included: evidence.length, omitted, candidatesOmitted: candidates.length - selectedCandidates.length, incomplete: omitted.some(e => e.reason === 'context_budget'), ambiguous: omitted.some(e => e.reason === 'ambiguous_id') } };
  });
  const causeTaxonomy = [...new Set(['undocumented', ...(review.profile?.causeTaxonomy || ['approval', 'external_dependency', 'quality', 'business_definition', 'technical_dependency'])])].filter(c => typeof c === 'string' && c.length <= 100).slice(0, 31);
  return { schemaVersion: policy.schemaVersion, policyVersion: policy.version, goal: clean(review.sprint?.goal), causeTaxonomy, passageCategories, items };
}
export const validateReviewAISuggestions = validateExtraction;

export async function synthesizeSprintReview(review, { apiKey = process.env.NVIDIA_API_KEY, model = process.env.NVIDIA_MODEL || REVIEW_AI_MODEL, fetchImpl = fetch, batch = false, semanticReview = true } = {}) {
  const context = buildReviewAIContext(review);
  const audit = { provider: 'nvidia', model, promptVersion: policy.version, schemaVersion: policy.schemaVersion, instructionsHash: hash(policy.instructions), policyHash: hash(policy), contextHash: hash(context), context };
  const fallback = status => ({ ...audit, status, ...validateExtraction({ claims: [] }, context), coverage: { withEvidence: context.items.filter(i => i.evidence.length).length, processed: 0, generated: 0, complete: false } });
  if (!apiKey) return fallback('unconfigured');
  if (!context.items.some(item => item.candidates.length && !item.selection.ambiguous)) return fallback('no_evidence');
  if (!batch && context.items.length > 8) {
    const results = [], deadline = Date.now() + 120_000;
    let cursor = 0;
    const batches = [];
    for (let i = 0; i < context.items.length; i += 8) batches.push(new Set(context.items.slice(i, i + 8).map(item => item.issueKey)));
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < batches.length && Date.now() < deadline) {
        const index = cursor++, keys = batches[index];
        results[index] = await synthesizeSprintReview({ ...review, items: review.items.filter(item => keys.has(item.key)) }, { apiKey, model, fetchImpl, batch: true, semanticReview });
      }
    }));
    const suggestions = results.flatMap(r => r.suggestions), processed = results.reduce((n, r) => n + r.coverage.processed, 0);
    const covered = new Set(results.flatMap(r => r.context.items.map(i => i.issueKey)));
    const goalSuggestion = validateExtraction({ claims: [] }, context).goalSuggestion;
    return { ...audit, status: suggestions.length ? 'generated' : results.find(r => r.status !== 'no_evidence')?.status || 'no_evidence', suggestions, claims: results.flatMap(r => r.claims), rejected: results.flatMap(r => r.rejected), abstentions: [...results.flatMap(r => r.abstentions), ...context.items.filter(i => !covered.has(i.issueKey)).map(i => ({ issueKey: i.issueKey, reason: 'verification_unavailable' }))], goalSuggestion, batches: results, coverage: { withEvidence: context.items.filter(i => i.evidence.length).length, processed, generated: suggestions.length, complete: processed === context.items.length } };
  }
  const started = Date.now();
  try {
    const response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0, max_tokens: 4096, stream: false, ...(model.startsWith('nvidia/nemotron-') ? { chat_template_kwargs: { enable_thinking: false } } : {}), messages: [{ role: 'system', content: policy.instructions }, { role: 'user', content: JSON.stringify(context) }] }) });
    if (!response.ok) return fallback(response.status === 429 ? 'rate_limited' : 'unavailable');
    const payload = await response.json();
    if (payload.choices?.[0]?.finish_reason !== 'stop') throw new Error('Resposta incompleta.');
    const raw = String(payload.choices[0].message?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const split = splitDrafts(JSON.parse(raw), context);
    const extracted = validateExtraction(split.response, context);
    const result = await reviewDrafts(extracted, split.drafts, { enabled: semanticReview, request: async (instructions, input) => {
      const checked = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0, max_tokens: 2048, stream: false, ...(model.startsWith('nvidia/nemotron-') ? { chat_template_kwargs: { enable_thinking: false } } : {}), messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }] }) });
      if (!checked.ok) throw new Error('Verifier unavailable');
      const payload = await checked.json();
      if (payload.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete verdict');
      return String(payload.choices[0].message?.content || '').trim();
    } });
    // Persist constrained decisions and hashes, never provider reasoning fields.
    return { ...audit, ...result, status: result.suggestions.length ? 'generated' : 'rejected', coverage: { withEvidence: context.items.filter(i => i.evidence.length).length, processed: context.items.length, generated: result.suggestions.length, complete: true }, responseHash: hash(raw), durationMs: Date.now() - started };
  } catch {
    return { ...fallback('unavailable'), durationMs: Date.now() - started };
  }
}
