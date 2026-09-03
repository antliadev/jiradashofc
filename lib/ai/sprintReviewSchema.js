import { abstentionReasons, passageCategories, sprintReviewPolicy as policy } from './sprintReviewPolicy.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

export function validateExtraction(response, context) {
  const modern = object(response) && Object.hasOwn(response, 'claims');
  const list = modern ? response.claims : response?.suggestions;
  if (!keysOnly(response, modern ? ['claims', 'abstentions', 'goalSuggestion'] : ['suggestions', 'abstentions', 'goalSuggestion'])
    || !Array.isArray(list) || list.length > policy.maxClaims
    || (response.abstentions !== undefined && (!Array.isArray(response.abstentions) || response.abstentions.length > policy.maxClaims))) throw new Error('Resposta de IA fora do formato permitido.');
  const suggestions = [], claims = [], rejected = [], abstentions = [], seen = new Set(), abstained = new Set();
  for (const entry of response.abstentions || []) {
    if (!keysOnly(entry, ['issueKey', 'reason']) || !context.items.some(item => item.issueKey === entry.issueKey) || !abstentionReasons.includes(entry.reason) || abstained.has(entry.issueKey)) throw new Error('Abstencao fora do formato permitido.');
    abstained.add(entry.issueKey);
    abstentions.push({ issueKey: entry.issueKey, reason: entry.reason });
  }
  for (const entry of list) {
    const item = context.items.find(item => item.issueKey === entry?.issueKey);
    const candidate = modern ? item?.candidates?.find(c => c.id === entry.candidateId)
      : item?.candidates?.find(c => c.quote === entry?.quote && entry.text === entry.quote && entry.cause === 'undocumented'
        && Array.isArray(entry.evidenceIds) && entry.evidenceIds.length === 1 && entry.evidenceIds[0] === c.evidenceId);
    const shape = keysOnly(entry, modern ? ['issueKey', 'candidateId', 'category', 'cause'] : ['issueKey', 'text', 'quote', 'evidenceIds', 'cause']);
    const classificationValid = (!entry?.category || passageCategories.includes(entry.category)) && (entry?.cause === undefined || context.causeTaxonomy.includes(entry.cause));
    if (!shape || !classificationValid || !candidate || seen.has(item.issueKey) || abstained.has(item.issueKey) || item.selection.ambiguous) {
      rejected.push({ issueKey: item?.issueKey || null, reason: 'unsupported_or_invalid' }); continue;
    }
    seen.add(item.issueKey);
    // Provenance assertion only: a Jira author's statement is not established truth.
    const text = `Registro Jira (nao validado): "${candidate.quote}"`;
    const claim = { id: candidate.id, issueKey: item.issueKey, type: 'recorded_statement', text, evidenceIds: [candidate.evidenceId], quote: candidate.quote, passage: { start: candidate.start, end: candidate.end, recordHash: candidate.recordHash, contextBefore: candidate.contextBefore, contextAfter: candidate.contextAfter }, verification: 'literal_attribution_only', semanticVerification: 'not_performed', requiresHumanReview: true, contextIncomplete: item.selection.incomplete, classification: { category: entry.category || 'context', cause: entry.cause || 'undocumented', verification: 'unverified_suggestion', confirmed: false }, confirmed: false };
    claims.push(claim);
    suggestions.push({ ...claim, cause: 'undocumented', kind: 'interpretation' });
  }
  for (const item of context.items) if (!seen.has(item.issueKey) && !abstained.has(item.issueKey)) abstentions.push({ issueKey: item.issueKey, reason: item.selection.incomplete ? 'insufficient_context' : item.candidates.length ? 'not_verifiable' : 'missing_evidence' });
  if (response.goalSuggestion != null) rejected.push({ issueKey: null, reason: 'goal_not_verifiable' });
  const goalCandidate = context.items.flatMap(item => item.selection.ambiguous ? [] : item.candidates.map(candidate => ({ ...candidate, issueKey: item.issueKey })))[0];
  const goalSuggestion = context.goal && goalCandidate ? { result: 'insufficient', evidenceIds: [goalCandidate.evidenceId], quote: goalCandidate.quote, confirmed: false, origin: 'deterministic_abstention', reason: 'semantic_verification_unavailable', requiresHumanReview: true } : null;
  return { suggestions, claims, rejected, abstentions, goalSuggestion };
}
