/**
 * api/index.js — Ponto de entrada único para todas as rotas da API Vercel.
 *
 * O runtime Node.js da Vercel utiliza um getter preguiçoso em req.body que
 * pode lançar "Invalid JSON". Sobrescrevemos com um acessor seguro
 * e normalizamos o body antes do processamento pelo Express.
 */
import { waitUntil } from '@vercel/functions';
import { normalizePngBody } from '../lib/binaryRequest.js';

export default async function handler(req, res) {
  try {
    const { default: app } = await import('../server/index.js');
    
    // Expõe o waitUntil da Vercel para as rotas do Express para que possam executar
    // tarefas em segundo plano (ex: sincronização) após o envio da resposta HTTP.
    req.waitUntil = waitUntil;

    // Sobrescreve o getter preguiçoso de body da Vercel com um acessor seguro
    const rawCt = req.headers['content-type'] || '';
    await normalizePngBody(req);
    if (req.method !== 'GET' && req.method !== 'DELETE' && rawCt.startsWith('application/json')) {
      // Lê o corpo bruto da requisição com segurança
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
      } catch {
        // Ignora erros na leitura bruta do body
      }
      
      // String vazia é falsy — trata corpo ausente / vazio como {}
      const parsed = (raw && raw.length > 0) ? JSON.parse(raw) : {};
      
      // Define req.body como uma propriedade simples (sobrescreve o getter da Vercel)
      Object.defineProperty(req, 'body', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      
      // Sinaliza ao body-parser do Express que o corpo já foi tratado.
      // O body-parser verifica req._body e ignora a análise se for verdadeiro.
      // Sem essa flag, ele tentaria ler o stream (já consumido)
      // e falharia com "stream is not readable".
      req._body = true;
    }

    app(req, res);
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}
