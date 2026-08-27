import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBlockedFields } from '../lib/jiraService.js';

test('resolveBlockedFields usa campos oficiais do Jira quando env nao define override', () => {
  const fields = resolveBlockedFields({
    customfield_11275: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Aguardando cliente' }] }] },
    customfield_11377: 'Contato realizado',
    customfield_11376: { displayName: 'Bruno Alves dos Santos' }
  });

  assert.equal(fields.blocked_reason, 'Aguardando cliente');
  assert.equal(fields.blocked_action_taken, 'Contato realizado');
  assert.equal(fields.blocked_pending_with, 'Bruno Alves dos Santos');
});

test('resolveBlockedFields considera campos legados de pendencia quando existirem', () => {
  const fields = resolveBlockedFields({
    customfield_10101: { value: 'Fornecedor' }
  });

  assert.equal(fields.blocked_pending_with, 'Fornecedor');
});
