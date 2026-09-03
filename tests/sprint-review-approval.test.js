import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSprintReview } from '../src/data/sprint-review.js';
import { prepareReviewSnapshot, validateReviewChoices } from '../lib/sprintReviewValidation.js';

function fixture() {
  const source = {
    projectKey: 'TEST', boardId: 1, scopeComplete: true,
    sprint: { id: 1, name: 'Sprint 1', state: 'closed', startDate: '2026-08-01T00:00:00Z', completeDate: '2026-08-15T00:00:00Z' },
    profile: { version: 1, timezone: 'UTC', sprintField: 'customfield_1', eligibleTypes: ['1'], statusMap: { '1': 'done' }, grouping: 'card' },
    issues: [{ key: 'TEST-1', historyComplete: true, changelog: { histories: [] }, comments: [], fields: { created: '2026-07-01T00:00:00Z', summary: 'Entrega', status: { id: '1' }, issuetype: { id: '1' }, customfield_1: [{ id: 1 }] } }],
  };
  const choices = { confirmGrouping: true };
  const review = buildSprintReview({ ...source, choices });
  return { source, review, input: { choices, acceptedWarnings: review.preflight.filter(p => p.severity === 'warning').map(p => p.id) } };
}

test('edited statements need renewed human approval and lose automatic support label', () => {
  const { source, review, input } = fixture();
  input.edits = { [review.statements[0].id]: 'Texto revisado pelo responsavel.' };
  assert.throws(() => prepareReviewSnapshot(source, input), /confirme os textos/);
  const saved = prepareReviewSnapshot(source, { ...input, confirmTextEdits: true });
  assert.equal(saved.review.statements[0].kind, 'human_edit');
  assert.equal(saved.review.statements[0].verifiedByAI, false);
  assert.equal(saved.review.metrics.achievement, 100);
  assert.equal(saved.textEditsConfirmed, true);
});

test('unchanged text does not create a human edit or demand redundant confirmation', () => {
  const { source, review, input } = fixture();
  const saved = prepareReviewSnapshot(source, { ...input, edits: { [review.statements[0].id]: review.statements[0].text } });
  assert.notEqual(saved.review.statements[0].editedByHuman, true);
});

test('choices and approval lists reject malformed payloads before processing', () => {
  const { source, input } = fixture();
  for (const invalid of [[], 'invalid', { groups: [] }, { groups: { 'OTHER-1': 'Group' } }, { confirmGrouping: 'yes' }, { optionalKeys: ['OTHER-1'] }]) {
    assert.throws(() => validateReviewChoices(source, invalid));
  }
  assert.throws(() => prepareReviewSnapshot(source, { ...input, acceptedWarnings: 'all' }));
  assert.throws(() => prepareReviewSnapshot(source, { ...input, executiveEdits: { invented: 'Unsupported block' } }));
});

test('goal approval needs a boolean and cannot use current-only descriptions as historical proof', () => {
  const { source, input } = fixture();
  source.sprint.goal = 'Entrega do modulo';
  source.issues[0].fields.description = 'Objetivo cumprido.';
  source.issues[0].fields.updated = '2026-08-20T00:00:00Z';
  assert.throws(() => prepareReviewSnapshot(source, { ...input, goal: { result: 'achieved', confirmed: 'yes', evidenceIds: ['TEST-1:status'] } }), /confirmacao/);
  assert.throws(() => prepareReviewSnapshot(source, { ...input, goal: { result: 'achieved', confirmed: true, evidenceIds: ['TEST-1:description'] } }), /evidencias/);
});

test('executive editing preserves the original text, requires approval and keeps the baseline', () => {
  const { source, input, review } = fixture();
  const executiveEdits = { attention: 'Texto revisado com as evidencias.' };
  assert.throws(() => prepareReviewSnapshot(source, { ...input, executiveEdits }), /confirme os textos/);
  const saved = prepareReviewSnapshot(source, { ...input, executiveEdits, confirmTextEdits: true });
  assert.equal(saved.review.executive.attention.originalText, review.executive.attention.text);
  assert.equal(saved.review.executive.attention.kind, 'human_edit');
  assert.equal(saved.review.metrics.achievement, review.metrics.achievement);
});
