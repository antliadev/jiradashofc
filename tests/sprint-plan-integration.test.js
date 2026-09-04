import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_ITEMS, canAccessRoute } from '../src/utils/access-control.js';
import { MENU_PERMISSIONS, permissionForJiraRequest } from '../lib/appPermissions.js';

test('Sprint Plan possui rota e permissao independentes da Sprint Review', () => {
  const item = ACCESS_ITEMS.find(entry => entry.id === 'projects.sprint-plan');
  assert.equal(item?.route, '/projects/sprint-plan');
  assert.equal(MENU_PERMISSIONS.includes('projects.sprint-plan'), true);
  assert.equal(permissionForJiraRequest({ path: '/sprint-plan/analyze', method: 'POST' }), 'projects.sprint-plan');
  assert.equal(canAccessRoute('/projects/sprint-plan', { status: 'active', role: 'custom', permissions: ['projects.sprint-review'] }), false);
  assert.equal(canAccessRoute('/projects/sprint-plan', { status: 'active', role: 'custom', permissions: ['projects.sprint-plan'] }), true);
});
