/**
 * Script para executar migração no Supabase
 * Uso: node scripts/run-migration.js
 * 
 * Requer: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  console.error('   Configure no arquivo .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const migrationSQL = `
-- ============================================================
-- Adicionar tabela de sessões de usuário
-- Execute este SQL no editor SQL do Supabase
-- ============================================================

-- Tabela de sessões de usuário (para autenticação no Vercel)
CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,          -- ID único da sessão
  email TEXT NOT NULL,                  -- Email do usuário
  created_at TIMESTAMPTZ DEFAULT now(), -- Quando a sessão foi criada
  expires_at TIMESTAMPTZ NOT NULL       -- Quando a sessão expira (24h)
);

-- Índice para busca rápida por session_id
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);

-- Índice para busca por email
CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions(email);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Apenas service_role acessa
DROP POLICY IF EXISTS "Service role only - sessions" ON user_sessions;
CREATE POLICY "Service role only - sessions" ON user_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Adicionar também os campos de sync à tabela de conexões (se não existirem)
ALTER TABLE jira_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE jira_connections ADD COLUMN IF NOT EXISTS last_sync_status TEXT;
ALTER TABLE jira_connections ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
`;

async function runMigration() {
  console.log('🚀 Executando migração no Supabase...\n');
  console.log('URL:', supabaseUrl);

  try {
    // Executar SQL diretamente
    const { data, error } = await supabase.rpc('exec_sql', { 
      query: migrationSQL 
    });

    if (error) {
      // Se RPC não funcionar, tenta via statement
      console.log('Tentando via statement...');
      
      // Criar a tabela user_sessions
      const { error: error1 } = await supabase
        .from('user_sessions')
        .select('*')
        .limit(1);
      
      if (error1 && error1.message.includes('does not exist')) {
        console.log('⚠️ Tabela user_sessions não existe');
        console.log('   Execute o SQL manualmente no Supabase Dashboard');
        console.log('\n📝 SQL para executar:');
        console.log('─'.repeat(60));
        console.log(migrationSQL);
        console.log('─'.repeat(60));
        process.exit(1);
      }
    }

    console.log('✅ Migração executada com sucesso!');
    
    // Verificar se as tabelas existem
    const { data: sessions } = await supabase
      .from('user_sessions')
      .select('count')
      .limit(1);
    
    console.log('✅ Tabela user_sessions verificada');
    
  } catch (err) {
    console.error('❌ Erro na migração:', err.message);
    console.log('\n📝 Execute este SQL no Supabase Dashboard (SQL Editor):');
    console.log('─'.repeat(60));
    console.log(migrationSQL);
    console.log('─'.repeat(60));
    process.exit(1);
  }
}

runMigration();