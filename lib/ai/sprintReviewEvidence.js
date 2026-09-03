import { createHash } from 'node:crypto';
import { sprintReviewPolicy as policy } from './sprintReviewPolicy.js';

export const evidenceHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'sentence' });

// Relevance ranking only, never a claim of semantic support or causality.
export function relevance(text) {
  return /pendente|falta|bloque|resolvid|proximo passo|pr[oó]ximo passo|impacto|depend|aprova|n[aã]o|talvez|se houver/i.test(text) ? 1 : 0;
}

export function evidenceCandidates(record, issueKey) {
  if (record.type === 'description') return [];
  const sentences = [...segmenter.segment(record.text)].map(s => ({ text: s.segment.trim(), start: s.index + s.segment.indexOf(s.segment.trim()) })).filter(s => s.text);
  // Do not shorten an oversized sentence: that could detach negation or a condition.
  return sentences.flatMap((sentence, index) => sentence.text.length >= 8 && sentence.text.length <= policy.maxQuoteChars ? [{
    id: evidenceHash([issueKey, record.id, sentence.start, sentence.text]),
    evidenceId: record.id, quote: sentence.text, start: sentence.start, end: sentence.start + sentence.text.length,
    contextBefore: sentences[index - 1]?.text || '', contextAfter: sentences[index + 1]?.text || '',
    recordHash: record.contentHash, verification: 'literal_attribution_only',
  }] : []);
}
