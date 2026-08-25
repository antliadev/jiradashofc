-- ============================================================
-- JiraDash Oficial - schema operacional Jira limpo
-- Mantem apenas tabelas necessarias para sync, dashboards e operacao.
-- Nao cria usuarios/sessoes legadas.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TABLE IF NOT EXISTS public.jira_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'default',
  base_url TEXT NOT NULL,
  email TEXT NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  jql TEXT NOT NULL,
  cache_ttl INTEGER DEFAULT 600000,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jira_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL UNIQUE,
  issue_key TEXT NOT NULL,
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
  start_date DATE,
  planned_start_date DATE,
  planned_end_date DATE,
  jira_url TEXT,
  story_points INTEGER DEFAULT 0,
  raw_fields JSONB DEFAULT '{}'::JSONB,
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
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jira_issue_comments (
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

CREATE TABLE IF NOT EXISTS public.jira_issue_changelog (
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

CREATE TABLE IF NOT EXISTS public.jira_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'error')),
  base_url TEXT NOT NULL,
  email_masked TEXT NOT NULL,
  email_encrypted TEXT,
  api_token_encrypted TEXT,
  jql TEXT,
  total_issues INTEGER DEFAULT 0,
  inserted_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  error_message TEXT,
  logs JSONB DEFAULT '[]'::JSONB,
  created_by_session TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jira_worklogs (
  worklog_id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  project_key TEXT NOT NULL,
  author_account_id TEXT,
  author_name TEXT NOT NULL DEFAULT 'Nao informado',
  description TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL,
  time_spent_seconds INTEGER NOT NULL CHECK (time_spent_seconds >= 0),
  jira_created_at TIMESTAMPTZ,
  jira_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jira_project_metadata (
  project_key TEXT PRIMARY KEY,
  project_id TEXT,
  project_name TEXT,
  planned_start_date DATE,
  planned_end_date DATE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jira_connections_active ON public.jira_connections(is_active);
CREATE INDEX IF NOT EXISTS idx_jira_issues_project_key ON public.jira_issues(project_key);
CREATE INDEX IF NOT EXISTS idx_jira_issues_status_name ON public.jira_issues(status_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_assignee_id ON public.jira_issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_jira_issues_synced_at ON public.jira_issues(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_priority_name ON public.jira_issues(priority_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_type_name ON public.jira_issues(type_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_jira_updated_at ON public.jira_issues(jira_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_project_updated ON public.jira_issues(project_key, jira_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_updated_at_desc ON public.jira_issues(jira_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_assignee_updated ON public.jira_issues(assignee_id, jira_updated_at DESC) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_status_updated ON public.jira_issues(status_name, jira_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_priority_updated ON public.jira_issues(priority_name, jira_updated_at DESC) WHERE priority_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_type_updated ON public.jira_issues(type_name, jira_updated_at DESC) WHERE type_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_comment_health ON public.jira_issues(project_key, human_comment_count, comment_count);
CREATE INDEX IF NOT EXISTS idx_jira_issues_block_fields ON public.jira_issues(project_key, blocked_pending_with) WHERE blocked_pending_with IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_start_date ON public.jira_issues(start_date) WHERE start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_planned_start_date ON public.jira_issues(planned_start_date) WHERE planned_start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_planned_end_date ON public.jira_issues(planned_end_date) WHERE planned_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_due_date ON public.jira_issues(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issues_timeline_filters ON public.jira_issues(project_key, assignee_id, status_name, priority_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_raw_fields_gin ON public.jira_issues USING GIN(raw_fields);

CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_id ON public.jira_issue_comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_key ON public.jira_issue_comments(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_jira_updated_at ON public.jira_issue_comments(jira_updated_at DESC) WHERE jira_updated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_id ON public.jira_issue_changelog(issue_id);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_key ON public.jira_issue_changelog(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_field_name ON public.jira_issue_changelog(field_name);
CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_jira_created_at ON public.jira_issue_changelog(jira_created_at DESC) WHERE jira_created_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_status ON public.jira_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_created_at ON public.jira_sync_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_expires_at ON public.jira_sync_jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_jira_worklogs_project_started ON public.jira_worklogs(project_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_worklogs_issue_key ON public.jira_worklogs(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_project_metadata_project_id ON public.jira_project_metadata(project_id);

DROP TRIGGER IF EXISTS set_jira_connections_updated_at ON public.jira_connections;
CREATE TRIGGER set_jira_connections_updated_at
  BEFORE UPDATE ON public.jira_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_jira_sync_jobs_updated_at ON public.jira_sync_jobs;
CREATE TRIGGER set_jira_sync_jobs_updated_at
  BEFORE UPDATE ON public.jira_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_jira_worklogs_updated_at ON public.jira_worklogs;
CREATE TRIGGER set_jira_worklogs_updated_at
  BEFORE UPDATE ON public.jira_worklogs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_jira_project_metadata_updated_at ON public.jira_project_metadata;
CREATE TRIGGER set_jira_project_metadata_updated_at
  BEFORE UPDATE ON public.jira_project_metadata
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issue_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_worklogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_project_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jira connections service role only" ON public.jira_connections;
CREATE POLICY "jira connections service role only" ON public.jira_connections
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira issues service role write" ON public.jira_issues;
CREATE POLICY "jira issues service role write" ON public.jira_issues
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira comments service role write" ON public.jira_issue_comments;
CREATE POLICY "jira comments service role write" ON public.jira_issue_comments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira changelog service role write" ON public.jira_issue_changelog;
CREATE POLICY "jira changelog service role write" ON public.jira_issue_changelog
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira sync jobs service role only" ON public.jira_sync_jobs;
CREATE POLICY "jira sync jobs service role only" ON public.jira_sync_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira worklogs service role write" ON public.jira_worklogs;
CREATE POLICY "jira worklogs service role write" ON public.jira_worklogs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira project metadata service role write" ON public.jira_project_metadata;
CREATE POLICY "jira project metadata service role write" ON public.jira_project_metadata
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.jira_issues IS 'Estado operacional da ultima sincronizacao ativa de tickets Jira.';
COMMENT ON TABLE public.jira_issue_comments IS 'Comentarios Jira persistidos; dados potencialmente sensiveis.';
COMMENT ON TABLE public.jira_worklogs IS 'Apontamentos Jira persistidos para relatorios de horas.';
