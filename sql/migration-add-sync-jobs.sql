-- ============================================================
-- Adicionar controle duravel de jobs de sincronizacao Jira
-- Execute este SQL no editor SQL do Supabase antes de usar o
-- worker/cron em producao.
-- ============================================================

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

CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_status ON public.jira_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_created_at ON public.jira_sync_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_sync_jobs_expires_at ON public.jira_sync_jobs(expires_at);

ALTER TABLE public.jira_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP POLICY IF EXISTS "Service role only - sync jobs" ON public.jira_sync_jobs;
CREATE POLICY "Service role only - sync jobs" ON public.jira_sync_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can manage non-sensitive sync jobs" ON public.jira_sync_jobs;
CREATE POLICY "Anon can manage non-sensitive sync jobs" ON public.jira_sync_jobs
  FOR ALL
  TO anon
  USING (api_token_encrypted IS NULL AND email_encrypted IS NULL)
  WITH CHECK (api_token_encrypted IS NULL AND email_encrypted IS NULL);

DROP TRIGGER IF EXISTS set_jira_sync_jobs_updated_at ON public.jira_sync_jobs;
CREATE TRIGGER set_jira_sync_jobs_updated_at
  BEFORE UPDATE ON public.jira_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_jira_issues_project_key ON public.jira_issues(project_key);
CREATE INDEX IF NOT EXISTS idx_jira_issues_status_name ON public.jira_issues(status_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_assignee_id ON public.jira_issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_jira_issues_synced_at ON public.jira_issues(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_issues_priority_name ON public.jira_issues(priority_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_type_name ON public.jira_issues(type_name);
CREATE INDEX IF NOT EXISTS idx_jira_issues_jira_updated_at ON public.jira_issues(jira_updated_at DESC);
