-- ============================================================
-- Radar Jira Antlia - Comentarios, historico e campos de bloqueio
-- Seguro para rodar varias vezes. Nao apaga dados existentes.
-- ============================================================

ALTER TABLE public.jira_issues
  ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS human_comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS automation_comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_comment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_comment_author_id TEXT,
  ADD COLUMN IF NOT EXISTS last_comment_author_name TEXT,
  ADD COLUMN IF NOT EXISTS last_human_comment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_human_comment_author_id TEXT,
  ADD COLUMN IF NOT EXISTS last_human_comment_author_name TEXT,
  ADD COLUMN IF NOT EXISTS changelog_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assignee_history JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_action_taken TEXT,
  ADD COLUMN IF NOT EXISTS blocked_pending_with TEXT,
  ADD COLUMN IF NOT EXISTS integration_warnings JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS raw_changelog JSONB DEFAULT '{}'::JSONB;

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

CREATE INDEX IF NOT EXISTS idx_jira_issues_comment_health
  ON public.jira_issues(project_key, human_comment_count, comment_count);

CREATE INDEX IF NOT EXISTS idx_jira_issues_block_fields
  ON public.jira_issues(project_key, blocked_pending_with)
  WHERE blocked_pending_with IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_id
  ON public.jira_issue_comments(issue_id);

CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_issue_key
  ON public.jira_issue_comments(issue_key);

CREATE INDEX IF NOT EXISTS idx_jira_issue_comments_jira_updated_at
  ON public.jira_issue_comments(jira_updated_at DESC)
  WHERE jira_updated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_id
  ON public.jira_issue_changelog(issue_id);

CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_issue_key
  ON public.jira_issue_changelog(issue_key);

CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_field_name
  ON public.jira_issue_changelog(field_name);

CREATE INDEX IF NOT EXISTS idx_jira_issue_changelog_jira_created_at
  ON public.jira_issue_changelog(jira_created_at DESC)
  WHERE jira_created_at IS NOT NULL;

ALTER TABLE public.jira_issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issue_changelog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only - comments" ON public.jira_issue_comments;
CREATE POLICY "Service role only - comments" ON public.jira_issue_comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - changelog" ON public.jira_issue_changelog;
CREATE POLICY "Service role only - changelog" ON public.jira_issue_changelog
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
