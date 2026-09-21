import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRINT_PLAN_STITCH_PROVENANCE, renderSprintPlanSlides, sprintPlanPages } from '../src/utils/sprint-plan-render.js';

const items = Array.from({ length: 23 }, (_, index) => ({ issueKey: `DEV-${index + 1}`, title: `Atividade ${index + 1}`, displayName: `DEV-${index + 1} — Atividade ${index + 1}`, primaryOrigin: index < 3 ? 'carry_over' : 'new_planned', addedAfterBaseline: index > 19 }));
const plan = { projectKey: 'DEV', targetSprint: { id: 5, name: 'Sprint 5' }, items, metrics: { planned: 20, currentScope: 23, additionalScope: 3 }, readiness: { score: 90 }, ai: { priorities: [] } };

test('arte do Sprint Plan pagina todos os cards sem ocultar codigo e nome', () => {
  assert.deepEqual(sprintPlanPages(plan).map(page => page.items.length), [10, 10, 3]);
  const html = renderSprintPlanSlides(plan);
  for (const item of items) assert.match(html, new RegExp(`${item.issueKey} — ${item.title}`));
  assert.equal((html.match(/data-plan-slide=/g) || []).length, 3);
});

test('template do Sprint Plan preserva a proveniencia do Stitch', () => {
  assert.deepEqual(SPRINT_PLAN_STITCH_PROVENANCE, {
    projectId: '12038302626029116856',
    screenId: '0399b1de9f944bebac027729e13dac07',
    usage: 'design_time_reference',
  });
});
