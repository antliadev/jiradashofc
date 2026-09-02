import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { normalizePngBody } from '../lib/binaryRequest.js';

test('binary upload works with an untouched stream or a Vercel pre-parsed Buffer', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const req = Readable.from([bytes]); req.headers = { 'content-type': 'image/png' };
  Object.defineProperty(req, 'body', { configurable: true, get() { throw new Error('Invalid JSON'); } });
  await normalizePngBody(req);
  assert.deepEqual(req.body, bytes);
  assert.equal(req._body, true);
  const parsed = { headers: { 'content-type': 'image/png' }, body: bytes };
  await normalizePngBody(parsed);
  assert.deepEqual(parsed.body, bytes);
});
test('binary normalization rejects oversized images and leaves JSON alone', async () => {
  const oversized = { headers: { 'content-type': 'image/png' }, body: Buffer.alloc(4 * 1024 * 1024 + 1) };
  await assert.rejects(() => normalizePngBody(oversized), error => error.status === 413);
  const json = { headers: { 'content-type': 'application/json' }, body: { value: 1 } };
  await normalizePngBody(json);
  assert.deepEqual(json.body, { value: 1 });
});
