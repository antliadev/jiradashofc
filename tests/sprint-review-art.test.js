import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { encode } from 'fast-png';
import { buildReviewArtManifest, collectReviewArt, validateReviewPng } from '../lib/sprintReviewArt.js';
import { insertReviewArt, listReviewRecords } from '../lib/sprintReviewStore.js';

const image = value => Buffer.from(encode({ width: 2400, height: 1350, channels: 1, data: new Uint8Array(2400 * 1350).fill(value) }));
const png = image(0), differentPng = image(1);
const sha = data => createHash('sha256').update(data).digest('hex');
const snapshot = { id: '11111111-1111-1111-1111-111111111111', kind: 'snapshot', content_hash: 'a'.repeat(64), project_key: 'TEST', board_id: '1', sprint_id: '2', payload: { templateVersion: 'test-v1', renderManifest: { pageCount: 2 } } };
function render(page, data = png, extra = {}) {
  return { id: `render-${page}`, kind: 'render', project_key: 'TEST', board_id: '1', sprint_id: '2', payload: { artVersion: 2, snapshotId: snapshot.id, snapshotHash: snapshot.content_hash, templateVersion: 'test-v1', page, png: data.toString('base64'), pngHash: sha(data), ...extra } };
}
const conflict = fn => assert.throws(fn, { status: 409 });

function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, 4, 'latin1');
  data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
function idatData() {
  const parts = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat(parts);
}
const withIdat = (...parts) => Buffer.concat([png.subarray(0, 33), ...parts.map(data => chunk('IDAT', data)), chunk('IEND', Buffer.alloc(0))]);
const withMetadata = (type, data) => Buffer.concat([png.subarray(0, 33), chunk(type, data), png.subarray(33)]);

test('rejects iCCP including a small first stream followed by an 8 MiB profile', () => {
  const first = deflateSync(Buffer.from('profile'));
  const compressed = Buffer.concat([first, deflateSync(Buffer.alloc(8 * 1024 * 1024))]);
  assert.equal(inflateSync(compressed).length, 7);
  for (const stream of [first, compressed]) {
    const payload = withMetadata('iCCP', Buffer.concat([Buffer.from('ICC\0\0'), stream]));
    assert.ok(payload.length < 4 * 1024 * 1024);
    assert.throws(() => validateReviewPng(payload), { status: 400 });
  }
});

test('rejects concatenated IDAT streams within one chunk or across chunks', () => {
  const first = idatData();
  for (const extra of [deflateSync(Buffer.alloc(8 * 1024 * 1024)), deflateSync(Buffer.alloc(0)), Buffer.from([0])]) {
    const compressed = Buffer.concat([first, extra]);
    const checked = inflateSync(compressed, { info: true });
    assert.equal(checked.buffer.length, (2400 + 1) * 1350);
    assert.equal(checked.engine.bytesWritten, first.length);
    for (const payload of [withIdat(compressed), withIdat(first, extra)]) {
      assert.throws(() => validateReviewPng(payload), { status: 400 });
    }
  }
});

test('accepts a single zlib stream split across multiple IDAT chunks with valid CRCs', () => {
  const compressed = idatData(), split = Math.floor(compressed.length / 2);
  const payload = withIdat(compressed.subarray(0, split), compressed.subarray(split));
  assert.equal(validateReviewPng(payload).hash, sha(payload));
});

test('rejects compressed text, unknown critical chunks and non-ASCII chunk aliases', () => {
  for (const type of ['zTXt', 'iTXt', 'ABCD', 'vpAg', '\u00c9HDR']) {
    assert.throws(() => validateReviewPng(withMetadata(type, Buffer.alloc(0))), { status: 400 });
  }
});

test('RGB and RGBA canvas images retain real decode and CRC validation', () => {
  for (const channels of [3, 4]) {
    const payload = Buffer.from(encode({ width: 2400, height: 1350, channels, data: new Uint8Array(2400 * 1350 * channels) }));
    assert.equal(validateReviewPng(payload).hash, sha(payload));
    payload[payload.length - 1] ^= 1;
    assert.throws(() => validateReviewPng(payload), { status: 400 });
  }
});

test('PNG is really decoded and hash is computed from bytes', () => {
  assert.deepEqual(validateReviewPng(png), { width: 2400, height: 1350, byteLength: png.length, hash: sha(png) });
});

test('rejects forged 24-byte PNG, truncation, CRC corruption and trailing bytes', () => {
  const forged = Buffer.alloc(24);
  png.copy(forged, 0, 0, 24);
  const corrupted = Buffer.from(png);
  corrupted[29] ^= 1;
  for (const invalid of [forged, png.subarray(0, -1), png.subarray(0, png.length / 2), corrupted, Buffer.concat([png, Buffer.from([0])]), null, 'png']) {
    assert.throws(() => validateReviewPng(invalid), { status: 400 });
  }
});

test('rejects oversized PNG before decoding and wrong dimensions', () => {
  assert.throws(() => validateReviewPng(Buffer.alloc(4 * 1024 * 1024 + 1)), { status: 413 });
  const wrongSize = Buffer.from(encode({ width: 1, height: 1, channels: 1, data: new Uint8Array(1) }));
  assert.throws(() => validateReviewPng(wrongSize), { status: 400 });
});

test('manifest requires frozen pageCount and every expected page', () => {
  conflict(() => buildReviewArtManifest({ ...snapshot, payload: {} }, []));
  conflict(() => buildReviewArtManifest(snapshot, []));
  conflict(() => buildReviewArtManifest(snapshot, [render(1)]));
  conflict(() => buildReviewArtManifest(snapshot, [render(1), render(3)]));
  conflict(() => buildReviewArtManifest(snapshot, [render(0), render(2)]));
});

test('complete manifest has ordered byte hashes, stable across record ordering and IDs', () => {
  const first = buildReviewArtManifest(snapshot, [render(2, differentPng), render(1)]);
  const second = buildReviewArtManifest(snapshot, [{ ...render(1), id: 'another-id' }, render(2, differentPng)]);
  assert.deepEqual(first, second);
  assert.equal(first.complete, true);
  assert.equal(first.semanticIntegrity, false);
  assert.deepEqual(first.pages, [{ page: 1, hash: sha(png) }, { page: 2, hash: sha(differentPng) }]);
  assert.notEqual(first.hash, buildReviewArtManifest(snapshot, [render(1), render(2)]).hash);
});

test('v2 duplicates are rejected even with identical bytes', () => {
  conflict(() => buildReviewArtManifest(snapshot, [render(1), { ...render(1), id: 'duplicate' }, render(2)]));
});

test('identical legacy duplicates collapse deterministically without choosing latest', () => {
  const old = { ...render(1, png, { artVersion: undefined, pngHash: undefined }), id: 'a', revision: 1 };
  const newer = { ...old, id: 'z', revision: 99 };
  assert.equal(collectReviewArt(snapshot, [newer, old]).get(1).record.id, 'a');
  assert.deepEqual(buildReviewArtManifest(snapshot, [newer, old, render(2)]), buildReviewArtManifest(snapshot, [old, render(2)]));
});

test('divergent legacy copies require a new version regardless of order', () => {
  const old = render(1, png, { artVersion: undefined });
  const newer = render(1, differentPng, { artVersion: undefined });
  for (const records of [[old, newer], [newer, old], [old, render(1, differentPng)]]) {
    conflict(() => collectReviewArt(snapshot, records));
    conflict(() => buildReviewArtManifest(snapshot, [...records, render(2)]));
  }
});

test('rejects substituted content, snapshot, template, context and malformed stored PNG', () => {
  for (const extra of [{ pngHash: 'b'.repeat(64) }, { snapshotId: 'other' }, { snapshotHash: 'b'.repeat(64) }, { templateVersion: 'other' }, { png: 'AAAA' }, { artVersion: 3 }]) {
    conflict(() => buildReviewArtManifest(snapshot, [render(1, png, extra), render(2)]));
  }
  conflict(() => buildReviewArtManifest(snapshot, [{ ...render(1), project_key: 'OTHER' }, render(2)]));
});

function fakeSupabase(initial = [], { concurrentInserts = 0, insertError = null, serverPageSize = 100 } = {}) {
  const rows = [...initial], ranges = [];
  let insertAttempts = 0, release;
  const gate = concurrentInserts ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  return {
    rows, ranges,
    get insertAttempts() { return insertAttempts; },
    from(table) {
      assert.equal(table, 'sprint_review_records');
      let insert, ascending, range, limit;
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order(key, options) { assert.equal(key, 'revision'); ascending = options.ascending; return query; },
        limit(value) { limit = value; return query; },
        range(start, end) { range = [start, end]; ranges.push(range); return query; },
        insert(value) { insert = value; return query; },
        async single() {
          insertAttempts++;
          if (insertAttempts === concurrentInserts) release();
          await gate;
          if (insertError) return { data: null, error: insertError };
          if (rows.some(row => row.kind === 'render' && row.payload.artVersion === 2 && row.payload.snapshotId === insert.payload.snapshotId && row.payload.page === insert.payload.page)) return { data: null, error: { code: '23505' } };
          const row = { ...insert, id: `stored-${rows.length + 1}`, revision: rows.length + 1 };
          rows.push(row);
          return { data: row, error: null };
        },
        then(resolve, reject) {
          let selected = rows.filter(row => filters.every(([key, value]) => (key === 'payload->>snapshotId' ? row.payload.snapshotId : row[key]) === value));
          selected.sort((a, b) => ascending ? a.revision - b.revision : b.revision - a.revision);
          if (range) selected = selected.slice(range[0], Math.min(range[1] + 1, range[0] + serverPageSize));
          if (limit) selected = selected.slice(0, limit);
          return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}
const upload = (data = png, page = 1) => ({ snapshot, page, data, actor: 'authenticated-user' });

test('storage retry is idempotent, different content returns 409 without replacing rows', async () => {
  const client = fakeSupabase();
  const first = await insertReviewArt(upload(), client);
  assert.equal((await insertReviewArt(upload(), client)).id, first.id);
  await assert.rejects(insertReviewArt(upload(differentPng), client), { status: 409 });
  assert.equal(client.rows.length, 1);
  assert.equal(client.insertAttempts, 1);
  assert.equal(first.payload.pngHash, sha(png));
});

test('concurrent identical writes converge after UNIQUE violation', async () => {
  const client = fakeSupabase([], { concurrentInserts: 2 });
  const results = await Promise.all([insertReviewArt(upload(), client), insertReviewArt({ ...upload(), actor: 'second-actor' }, client)]);
  assert.equal(client.insertAttempts, 2);
  assert.equal(client.rows.length, 1);
  assert.equal(results[0].id, results[1].id);
});

test('concurrent different writes keep one winner and reject the other with 409', async () => {
  const client = fakeSupabase([], { concurrentInserts: 2 });
  const results = await Promise.allSettled([insertReviewArt(upload(), client), insertReviewArt(upload(differentPng), client)]);
  assert.equal(client.insertAttempts, 2);
  assert.equal(client.rows.length, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
});

test('storage reads every art record beyond 100 even with a smaller server page cap', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ ...render(1, png, { artVersion: undefined }), id: `legacy-${i}`, revision: i + 1 }));
  const client = fakeSupabase(rows, { serverPageSize: 37 });
  const all = await listReviewRecords({ kind: 'render', projectKey: 'TEST', boardId: '1', sprintId: '2', snapshotId: snapshot.id, includePayload: true }, client);
  assert.equal(all.length, 205);
  assert.equal(new Set(all.map(row => row.id)).size, 205);
  assert.deepEqual(client.ranges.at(-1), [205, 304]);
});

test('legacy conflict beyond record 100 blocks insertion without deleting anything', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ ...render(1, i === 100 ? differentPng : png, { artVersion: undefined }), id: `legacy-${i}`, revision: i + 1 }));
  const client = fakeSupabase(rows);
  await assert.rejects(insertReviewArt(upload(png, 2), client), { status: 409 });
  assert.equal(client.insertAttempts, 0);
  assert.equal(client.rows.length, 101);
});

test('identical legacy upload returns existing record; storage errors remain 503', async () => {
  const legacy = render(1, png, { artVersion: undefined, pngHash: undefined });
  const client = fakeSupabase([legacy]);
  assert.equal((await insertReviewArt(upload(), client)).id, legacy.id);
  assert.equal(client.insertAttempts, 0);
  await assert.rejects(insertReviewArt(upload(), fakeSupabase([], { insertError: { code: '42501' } })), { status: 503 });
});
