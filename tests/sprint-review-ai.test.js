import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewAIContext, validateReviewAISuggestions, synthesizeSprintReview } from '../lib/sprintReviewAI.js';

const review = { profile: {}, items: [{ key: 'TEST-1', state: 'progress', humanComments: 1 }], evidence: [{ id: 'comment-1', issueKey: 'TEST-1', type: 'comment', text: 'Aguardando definicao de arquitetura pelo cliente. Proximo passo: revisar o contrato.' }, { id: 'status-1', issueKey: 'TEST-1', type: 'status_history', text: 'Em andamento' }], metrics: { achievement: 0 } };
test('AI context excludes status-only causes, PII and non-evidence data', () => {
  const context = buildReviewAIContext(review);
  assert.equal(context.items[0].evidence.length, 1);
  assert.equal(JSON.stringify(context).includes('achievement'), false);
  assert.equal(JSON.stringify(context).includes('status-1'), false);
});
test('AI accepts quoted evidence but rejects fabricated metrics, evidence and conclusions', () => {
  const context = buildReviewAIContext(review);
  const good = { issueKey: 'TEST-1', text: 'A continuidade depende da definicao de arquitetura pelo cliente.', evidenceIds: ['comment-1'], quote: 'Aguardando definicao de arquitetura pelo cliente.', cause: 'external_dependency' };
  assert.equal(validateReviewAISuggestions({ suggestions: [good] }, context).suggestions.length, 1);
  for (const override of [{ text: 'Atingimento de 100%' }, { evidenceIds: ['invented'] }, { quote: 'nao registrado no card' }, { text: 'O trabalho foi concluido.' }, { cause: 'invented' }]) assert.equal(validateReviewAISuggestions({ suggestions: [{ ...good, ...override }] }, context).suggestions.length, 0);
  assert.throws(() => validateReviewAISuggestions({ suggestions: [good], metrics: { achievement: 100 } }, context));
});
test('NVIDIA quota, failure and absent key preserve deterministic review without throwing', async () => {
  assert.equal((await synthesizeSprintReview(review, { apiKey: '' })).status, 'unconfigured');
  assert.equal((await synthesizeSprintReview(review, { apiKey: 'fixture', fetchImpl: async () => new Response('{}', { status: 429 }) })).status, 'rate_limited');
  assert.equal((await synthesizeSprintReview(review, { apiKey: 'fixture', fetchImpl: async () => { throw new Error('unavailable'); } })).status, 'unavailable');
  assert.deepEqual(review.metrics, { achievement: 0 });
});
test('NVIDIA call uses a fixed endpoint, no tools and never sends metrics as editable output', async () => {
  let sent;
  await synthesizeSprintReview(review, { apiKey: 'fixture', fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"suggestions":[]}' } }] })); } });
  assert.equal(sent.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(sent.body.tools, undefined);
  assert.match(sent.body.messages[0].content, /DADOS NAO CONFIAVEIS/);
  assert.equal(sent.body.messages[1].content.includes('achievement'), false);
});
test('goal suggestion requires quoted evidence and never arrives pre-approved', () => {
  const context = buildReviewAIContext({ ...review, sprint: { goal: 'Definir arquitetura' } });
  const response = { suggestions: [], goalSuggestion: { result: 'not_achieved', evidenceIds: ['comment-1'], quote: 'Aguardando definicao de arquitetura pelo cliente.', confirmed: true } };
  assert.equal(validateReviewAISuggestions(response, context).goalSuggestion.confirmed, false);
  response.goalSuggestion.evidenceIds = ['fabricated'];
  assert.equal(validateReviewAISuggestions(response, context).goalSuggestion, null);
});
