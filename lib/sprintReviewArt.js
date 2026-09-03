import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { decode } from 'fast-png';

const MAX_BYTES = 4 * 1024 * 1024;
const WIDTH = 2400, HEIGHT = 1350;
// No compressed metadata: fast-png can inflate concatenated streams without a size cap.
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'pHYs', 'tEXt', 'sRGB', 'gAMA', 'cHRM']);
const hash = data => createHash('sha256').update(data).digest('hex');
const conflict = () => { throw Object.assign(new Error('Arte inconsistente ou divergente. Crie uma nova versao da review.'), { status: 409 }); };

export function validateReviewPng(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length > MAX_BYTES) throw Object.assign(new Error('PNG excede 4 MB.'), { status: 413 });
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR' || buffer.readUInt32BE(16) !== WIDTH || buffer.readUInt32BE(20) !== HEIGHT) throw new Error('Cabecalho invalido');
    const chunks = [];
    let ended = false, idatEnded = false;
    for (let offset = 8; offset < buffer.length;) {
      if (offset + 12 > buffer.length) throw new Error('Chunk truncado');
      const length = buffer.readUInt32BE(offset), type = buffer.toString('latin1', offset + 4, offset + 8);
      const end = offset + 12 + length;
      if (end > buffer.length || (type === 'IHDR' && offset !== 8)) throw new Error('Chunk invalido');
      if (!PNG_CHUNKS.has(type)) throw new Error('Chunk PNG nao permitido');
      if (type === 'IDAT') {
        if (idatEnded) throw new Error('IDAT fora de ordem');
        chunks.push(buffer.subarray(offset + 8, end - 4));
      } else if (chunks.length) idatEnded = true;
      if (type === 'IEND') {
        if (length !== 0 || end !== buffer.length || !chunks.length) throw new Error('Final invalido');
        ended = true;
      }
      offset = end;
    }
    if (!ended) throw new Error('PNG incompleto');
    const depth = buffer[24], channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[buffer[25]];
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[buffer[25]]?.includes(depth) || buffer[28] > 1) throw new Error('Formato invalido');
    const passes = buffer[28] === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    const expected = passes.reduce((sum, [x, y, dx, dy]) => sum + (Math.ceil(Math.ceil((WIDTH - x) / dx) * channels * depth / 8) + 1) * Math.ceil((HEIGHT - y) / dy), 0);
    const compressed = Buffer.concat(chunks);
    const inflated = inflateSync(compressed, { maxOutputLength: expected, info: true });
    // Node stops at the first zlib stream; pako may continue into appended streams.
    if (inflated.engine.bytesWritten !== compressed.length) throw new Error('Dados adicionais no stream IDAT');
    if (inflated.buffer.length !== expected) throw new Error('Pixels incompletos');
    const decoded = decode(buffer, { checkCrc: true });
    if (decoded.width !== WIDTH || decoded.height !== HEIGHT || !decoded.data.length) throw new Error('Dimensoes invalidas');
    return { width: WIDTH, height: HEIGHT, byteLength: buffer.length, hash: hash(buffer) };
  } catch (cause) {
    throw Object.assign(new Error('Imagem PNG 2400x1350 invalida.', { cause }), { status: 400 });
  }
}

export function reviewArtPageCount(snapshot) {
  const count = snapshot?.payload?.renderManifest?.pageCount;
  if (snapshot?.kind !== 'snapshot' || !snapshot.id || !snapshot.content_hash || !Number.isSafeInteger(count) || count < 1) conflict();
  return count;
}

// Partial sets are allowed only while uploading. All records are checked, including legacy duplicates.
export function collectReviewArt(snapshot, records) {
  const count = reviewArtPageCount(snapshot), pages = new Map(), v2Pages = new Set();
  if (!Array.isArray(records)) conflict();
  for (const record of records) {
    const p = record?.payload;
    if (record?.kind !== 'render' || !p || p.snapshotId !== snapshot.id || p.snapshotHash !== snapshot.content_hash || record.project_key !== snapshot.project_key || record.board_id !== snapshot.board_id || record.sprint_id !== snapshot.sprint_id || p.templateVersion !== snapshot.payload.templateVersion || !Number.isSafeInteger(p.page) || p.page < 1 || p.page > count || (p.artVersion !== undefined && p.artVersion !== 2)) conflict();
    if (typeof p.png !== 'string' || p.png.length > Math.ceil(MAX_BYTES / 3) * 4) conflict();
    const data = Buffer.from(p.png, 'base64');
    if (data.toString('base64') !== p.png) conflict();
    let validated;
    try { validated = validateReviewPng(data); } catch { conflict(); }
    if (p.artVersion === 2 && p.pngHash !== validated.hash) conflict();
    if (p.artVersion === 2) {
      if (v2Pages.has(p.page)) conflict();
      v2Pages.add(p.page);
    }
    const previous = pages.get(p.page);
    if (previous && previous.hash !== validated.hash) conflict();
    // Identical legacy copies collapse deterministically; never choose the latest render.
    if (!previous || String(record.id) < String(previous.record.id)) pages.set(p.page, { record, ...validated });
  }
  return pages;
}

export function buildReviewArtManifest(snapshot, records) {
  const pageCount = reviewArtPageCount(snapshot), collected = collectReviewArt(snapshot, records);
  if (collected.size !== pageCount) throw Object.assign(new Error('Arte incompleta. Envie todas as paginas esperadas.'), { status: 409 });
  const pages = [...collected.entries()].sort(([a], [b]) => a - b).map(([page, value]) => ({ page, hash: value.hash }));
  const content = { artVersion: 2, snapshotId: snapshot.id, snapshotHash: snapshot.content_hash, pageCount, pages };
  return { ...content, complete: true, hash: hash(JSON.stringify(content)), semanticIntegrity: false };
}
