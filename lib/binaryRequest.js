// Vercel may have consumed the stream before Express sees image uploads.
export async function normalizePngBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('image/png')) return;
  const limit = 4 * 1024 * 1024;
  let body = req.__vc_rawBody || req.__vc_body;
  if (!Buffer.isBuffer(body)) {
    try { if (Buffer.isBuffer(req.body)) body = req.body; } catch { /* Lazy getters can reject binary input. */ }
  }
  if (!Buffer.isBuffer(body)) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) throw Object.assign(new Error('Imagem excede o limite de 4 MB.'), { status: 413 });
      chunks.push(bytes);
    }
    body = Buffer.concat(chunks);
  }
  if (!body.length || body.length > limit) throw Object.assign(new Error('Corpo da imagem invalido ou muito grande.'), { status: body.length ? 413 : 400 });
  Object.defineProperty(req, 'body', { value: body, writable: true, configurable: true, enumerable: true });
  req._body = true;
}
