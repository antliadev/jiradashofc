-- ============================================================
-- Jira Dashboard — Schema Supabase
-- Execute este SQL no editor SQL do Supabase
-- ============================================================

-- Tabela de conexões do Jira (credenciais criptografadas)
CREATE TABLE IF NOT EXISTS jira_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT DEFAULT 'default',
  base_url TEXT NOT NULL,
  email TEXT NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  jql TEXT NOT NULL,
  cache_ttl INTEGER DEFAULT 600000,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de issues sincronizadas do Jira
-- Chave de upsert: issue_id (ID numérico do Jira) — único e imutável
CREATE TABLE IF NOT EXISTS jira_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL UNIQUE,     -- ID numérico do Jira (ex: "10042") — chave de upsert
  issue_key TEXT NOT NULL,           -- Chave legível (ex: "BLCASH-123")
  title TEXT NOT NULL DEFAULT '',
  status_id TEXT,
  status_name TEXT NOT NULL DEFAULT '',
  status_category TEXT,
  project_id TEXT,
  project_key TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  project_avatar TEXT,
  type_id TEXT,
  type_name TEXT NOT NULL DEFAULT 'Task',
  type_icon TEXT,
  priority_id TEXT,
  priority_name TEXT,
  priority_icon TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  assignee_avatar TEXT,
  assignee_email TEXT,
  reporter_id TEXT,
  reporter_name TEXT,
  reporter_avatar TEXT,
  creator_id TEXT,
  creator_name TEXT,
  creator_avatar TEXT,
  labels JSONB DEFAULT '[]'::JSONB,
  components JSONB DEFAULT '[]'::JSONB,
  fix_versions JSONB DEFAULT '[]'::JSONB,
  parent_key TEXT,
  parent_title TEXT,
  jira_created_at TIMESTAMPTZ,
  jira_updated_at TIMESTAMPTZ,
  jira_resolved_at TIMESTAMPTZ,
  due_date DATE,
  story_points INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  human_comment_count INTEGER DEFAULT 0,
  automation_comment_count INTEGER DEFAULT 0,
  last_comment_at TIMESTAMPTZ,
  last_comment_author_id TEXT,
  last_comment_author_name TEXT,
  last_human_comment_at TIMESTAMPTZ,
  last_human_comment_author_id TEXT,
  last_human_comment_author_name TEXT,
  changelog_count INTEGER DEFAULT 0,
  assignee_history JSONB DEFAULT '[]'::JSONB,
  status_history JSONB DEFAULT '[]'::JSONB,
  blocked_reason TEXT,
  blocked_action_taken TEXT,
  blocked_pending_with TEXT,
  integration_warnings JSONB DEFAULT '[]'::JSONB,
  raw_changelog JSONB DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),    -- quando foi salvo/atualizado no banco
  created_at TIMESTAMPTZ DEFAULT now()   -- primeira vez que entrou no banco
);

CREATE TABLE IF NOT EXISTS jira_issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id TEXT NOT NULL UNIQUE,
  issue_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  author_account_id TEXT,
  author_name TEXT,
  author_email TEXT,
  body_text TEXT,
  is_automation BOOLEAN DEFAULT false,
  jira_created_at TIMESTAMPTZ,
  jira_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jira_issue_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_item_id TEXT NOT NULL UNIQUE,
  history_id TEXT,
  issue_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  author_account_id TEXT,
  author_name TEXT,
  field_name TEXT,
  field_id TEXT,
  field_type TEXT,
  from_value TEXT,
  from_display TEXT,
  to_value TEXT,
  to_display TEXT,
  jira_created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rja_access_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'active',
  permissions JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rja_access_users_role_check CHECK (role IN ('full', 'master', 'custom')),
  CONSTRAINT rja_access_users_status_check CHECK (status IN ('active', 'inactive'))
);

-- Índices para performance nas queries mais frequentes
CREATE INDEX IF NOT EXISTS idx_jira_issues_project_key ON jira_issues(project_key);
CREATE INDEX IF NOT EXISTS idx_jira_issues_status_name ON jira_issues(status_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_assignee_id ON jira_issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_jira_issues_synced_at ON jira_issues(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_priority_name ON jira_issues(priority_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_type_name ON jira_issues(type_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_comment_health ON jira_issues(project_key, human_comment_count, comment_count);
CREATE INDEX IF NOT EXISTS idx_jira_issues_block_fields ON jira_issues(project_key, blocked_pending_with) WHERE blocked_pending_with IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_id ON jira_issue_comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_key ON jira_issue_comments(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_id ON jira_issue_changelog(issue_id);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_key ON jira_issue_changelog(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_field_name ON jira_issue_changelog(field_name);
CREATE INDEX IF NOT EXISTS idx_rja_access_users_login ON rja_access_users(LOWER(login));
CREATE INDEX IF NOT EXISTS idx_rja_access_users_status ON rja_access_users(status);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_issue_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE rja_access_users ENABLE ROW LEVEL SECURITY;

-- Apenas service_role acessa — nunca exposto ao frontend diretamente
DROP POLICY IF EXISTS "Service role only - connections" ON jira_connections;
CREATE POLICY "Service role only - connections" ON jira_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - issues" ON jira_issues;
CREATE POLICY "Service role only - issues" ON jira_issues
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - comments" ON jira_issue_comments;
CREATE POLICY "Service role only - comments" ON jira_issue_comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - changelog" ON jira_issue_changelog;
CREATE POLICY "Service role only - changelog" ON jira_issue_changelog
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - rja access users" ON rja_access_users;
CREATE POLICY "Service role only - rja access users" ON rja_access_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Função para atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_jira_connections_updated_at ON jira_connections;
CREATE TRIGGER set_jira_connections_updated_at
  BEFORE UPDATE ON jira_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
