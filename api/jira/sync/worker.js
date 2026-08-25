/**
 * api/jira/sync/worker.js - Protected backend worker for scheduled auto-sync jobs.
 *
 * Configured in Vercel Cron to run every 30 minutes, every day.
 * Calls executeAutoSync to import Jira issues autonomously into Supabase.
 */
import { executeAutoSync } from '../../../lib/syncJobService.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, error: 'Worker nao autorizado.' });
  }

  try {
    const result = await executeAutoSync('vercel-cron', { forceScheduleCheck: true });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[sync-worker] Erro:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}
