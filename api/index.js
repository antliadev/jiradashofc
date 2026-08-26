/**
 * api/index.js — Single entry point for all Vercel API routes.
 *
 * Vercel's Node.js runtime uses a lazy getter on req.body that
 * can throw "Invalid JSON". We override it with a safe accessor
 * and normalize the body before Express processes it.
 */
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  try {
    const { default: app } = await import('../server/index.js');
    
    // Expose Vercel's waitUntil to Express routes so they can run
    // background tasks (e.g. sync jobs) after the HTTP response is sent.
    req.waitUntil = waitUntil;

    // Override Vercel's lazy body getter with a safe one
    const rawCt = req.headers['content-type'] || '';
    if (req.method !== 'GET' && req.method !== 'DELETE' && rawCt.startsWith('application/json')) {
      // Read the raw body safely
      let raw = null;
      try {
        raw = req.__vc_rawBody || req.__vc_body || null;
        if (!raw) {
          raw = await new Promise((resolve) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            req.on('error', () => resolve(null));
            setTimeout(() => resolve(null), 100);
          });
        }
      } catch {}
      
      // Empty string is falsy — treat missing / empty body as {}
      const parsed = (raw && raw.length > 0) ? JSON.parse(raw) : {};
      
      // Set req.body as a plain property (overrides Vercel's getter)
      Object.defineProperty(req, 'body', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      
      // Signal to Express's body-parser that body is already handled.
      // body-parser checks req._body and skips parsing if true.
      // Without this flag, it will try to read the (already-consumed)
      // stream and fail with "stream is not readable".
      req._body = true;
    }

    app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}
