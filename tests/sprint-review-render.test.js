import test from 'node:test';
import assert from 'node:assert/strict';
import { executiveBlocks, formatReviewDate, renderSprintSlides, sprintSlidePages } from '../src/utils/sprint-review-render.js';

const fixture = () => ({
  projectKey: 'TEST', sprint: { id: 4, name: 'Sprint 4', startDate: '2026-08-17', completeDate: '2026-08-22T15:10:56Z' },
  profile: { timezone: 'America/Sao_Paulo' }, metrics: { completed: 5, planned: 6, achievement: 83, additional: 0 },
  confidence: 86, classification: 'Meta parcialmente atingida',
  deliveries: ['Documentação', 'Preparação', 'Infraestrutura', 'CI mínima', 'Quality Gates', 'Banco e pacote'].map((title, i) => ({
    id: String(i), title, planned: true, keys: [`TEST-${i}`], result: i < 5 ? 'done' : 'continuity',
    plannedDates: ['2026-08-17'], closingDates: ['2026-08-18'], evidenceIds: [`e-${i}`],
  })), statements: [],
});

test('six deliveries and all executive blocks share one slide', () => {
  const review = fixture(), pages = sprintSlidePages(review);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].rows.length, 6);
  assert.equal(pages[0].blocks.length, 5);
  const html = renderSprintSlides({ review });
  assert.match(html, /17\/08\/2026/);
  assert.match(html, /18\/08\/2026/);
  assert.match(html, /Principal conquista/);
  assert.match(html, /Próximo passo/);
  assert.match(html, /Justificativa/);
});
test('fallback preserves unknown causes and does not infer subsequent sprint', () => {
  const review = fixture();
  const blocks = executiveBlocks(review);
  assert.match(blocks.justification.text, /Causa não registrada/);
  assert.doesNotMatch(blocks.nextStep.text, /Sprint 5/);
  delete review.deliveries[0].plannedDates;
  assert.equal(sprintSlidePages(review)[0].rows[0].plannedDate, 'Não informado');
});
test('long content continues without losing or duplicating deliveries or executive text', () => {
  const review = fixture();
  review.deliveries.push({ ...review.deliveries[0], id: 'extra', planned: false });
  const text = 'Justificativa com contexto e evidências. '.repeat(15);
  review.executive = { justification: { id: 'custom', text, evidenceIds: ['e-5'], kind: 'fact' } };
  const pages = sprintSlidePages(review);
  assert.equal(pages.flatMap(p => p.rows).length, 7);
  assert.equal(pages.filter(p => p.type === 'context').flatMap(p => p.blocks).find(b => b.key === 'justification').text, text);
  assert.equal(pages[0].blocks.length, 5);
});
test('dates avoid timezone drift for date-only fields and reject invalid timestamps', () => {
  assert.equal(formatReviewDate('2026-08-17'), '17/08/2026');
  assert.equal(formatReviewDate('invalid'), 'Não informado');
});
test('Jira and executive text are escaped in the generated markup', () => {
  const review = fixture(); review.deliveries[0].title = '<script>alert(1)</script>';
  review.executive = { highlight: { text: '<img src=x onerror=alert(1)>', evidenceIds: [] } };
  const html = renderSprintSlides({ review });
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});
test('confirmed goal remains separate from the baseline and classification controls palette', () => {
  const review = fixture(); review.goalAssessment = { confirmed: true, result: 'not_achieved' };
  const html = renderSprintSlides({ review });
  assert.match(html, /Goal confirmado: Não atingido/);
  assert.match(html, /sr-severity-partial/);
  assert.match(html, /83%/);
  review.goalAssessment.confirmed = false;
  assert.doesNotMatch(renderSprintSlides({ review }), /Goal confirmado/);
});
test('overflow details are preserved in continuation when not repeated delivery facts', () => {
  const review = fixture();
  const details = [{ id: 'context1', text: 'Contexto humano completo. '.repeat(12), evidenceIds: ['e-1'], kind: 'interpretation' }, { id: 'context2', text: 'Outro contexto humano completo. '.repeat(12), evidenceIds: ['e-2'], kind: 'interpretation' }];
  review.executive = { justification: { text: 'Resumo longo. '.repeat(30), details, overflow: true, evidenceIds: ['e-1', 'e-2'] } };
  const pages = sprintSlidePages(review);
  assert.deepEqual(pages.filter(p => p.type === 'context').flatMap(p => p.blocks).map(b => b.text), details.map(d => d.text));
  assert.equal(pages[0].blocks.length, 5);
});
