import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NVIDIA_MODEL, getNvidiaRuntimeConfig, NVIDIA_CHAT_ENDPOINT } from '../lib/ai/nvidiaRuntimeConfig.js';

test('NVIDIA runtime config reports production env readiness without exposing secrets', () => {
  const missing = getNvidiaRuntimeConfig({});
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['NVIDIA_API_KEY']);
  assert.equal(missing.model, DEFAULT_NVIDIA_MODEL);
  assert.equal(missing.endpoint, NVIDIA_CHAT_ENDPOINT);
  assert.equal(JSON.stringify(missing).includes('secret'), false);

  const configured = getNvidiaRuntimeConfig({ NVIDIA_API_KEY: 'nvapi-test-secret', NVIDIA_MODEL: 'custom/model' });
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.missing, []);
  assert.equal(configured.model, 'custom/model');
  assert.equal(JSON.stringify(configured).includes('nvapi-test-secret'), false);
});
