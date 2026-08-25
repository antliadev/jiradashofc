/**
 * supabaseServer.js - Cliente Supabase para backend.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const keyCandidates = [
  ['service_role', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['secret', process.env.SUPABASE_SECRET_KEY],
  ['anon', process.env.SUPABASE_ANON_KEY],
  ['publishable', process.env.SUPABASE_PUBLISHABLE_KEY]
]
  .map(([type, value]) => [type, (value || '').trim()])
  .filter(([, value]) => value);

function classifySupabaseKey(value) {
  if (/your_|placeholder|service_role_key/i.test(value)) return null;
  if (value.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(value.split('.')[1] || '', 'base64url').toString('utf8'));
      if (payload.role === 'service_role') return 'service_role';
      if (payload.role === 'anon') return 'anon';
    } catch {
      return null;
    }
    return 'legacy';
  }
  if (value.startsWith('sb_secret_')) return 'secret';
  if (value.startsWith('sb_publishable_')) return 'publishable';
  return null;
}

const selectedKey = keyCandidates
  .map(([source, value]) => [source, value, classifySupabaseKey(value)])
  .find(([, , type]) => type);
const supabaseServiceKey = selectedKey?.[1] || '';
export const supabaseKeySource = selectedKey?.[0] || null;
export const supabaseKeyType = selectedKey?.[2] || null;
export const supabaseKeyIsPrivileged = supabaseKeyType === 'service_role' || supabaseKeyType === 'secret';
const serviceKeyLooksInvalid = keyCandidates.length > 0 && !selectedKey;

if (!supabaseUrl) {
  console.error('[Supabase] ERRO: SUPABASE_URL nao configurada');
}

if (!supabaseServiceKey) {
  console.error('[Supabase] ERRO: nenhuma chave Supabase valida configurada');
}

if (serviceKeyLooksInvalid) {
  console.error('[Supabase] ERRO: chave Supabase invalida. Use service_role/secret no backend ou anon/publishable quando as policies permitirem.');
}

export const supabase = (supabaseUrl && supabaseServiceKey && !serviceKeyLooksInvalid)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

export const isConfigured = !!supabase;

export function checkSupabaseConfig() {
  if (!supabaseUrl || !supabaseServiceKey || serviceKeyLooksInvalid) {
    return {
      configured: false,
      error: serviceKeyLooksInvalid
        ? 'Chave Supabase invalida. Defina uma chave valida em SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_ANON_KEY ou SUPABASE_PUBLISHABLE_KEY.'
        : 'Supabase nao configurado. Defina SUPABASE_URL e uma chave Supabase valida.'
    };
  }

  return { configured: true };
}
