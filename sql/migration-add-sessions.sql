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