/**
 * api/[...slug].js — Ponto de entrada genérico (catch-all) para rotas da API Vercel.
 *
 * O runtime Node.js da Vercel faz pré-análise de req.body para tipos de conteúdo conhecidos.
 * Porém express.json() do Express tenta ler do stream que já foi consumido.
 * Normalizamos req.body antes de chamar o Express.
 */
import app from '../server/index.js';
import { waitUntil } from '@vercel/functions';

export default function handler(req, res) {
  req.waitUntil = waitUntil;

  // Para requisições JSON não-GET, garante que req.body seja um objeto válido
  // ANTES do middleware express.json() do Express ser executado.
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('application/json')) {
      if (Buffer.isBuffer(req.body)) {
        try { req.body = JSON.parse(req.body.toString('utf8')); } catch { req.body = {}; }
      } else if (typeof req.body === 'string') {
        try { req.body = JSON.parse(req.body); } catch { req.body = {}; }
      } else if (typeof req.body !== 'object' || req.body === null) {
        req.body = {};
      }
      // O body-parser do Express verifica req._body — indica para ignorar a análise
      req._body = true;
    }
  }

  app(req, res);
}
