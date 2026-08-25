-- ============================================================
-- Jira Dashboard - Hardening RLS para backend com service_role
-- NAO aplicar antes de configurar SUPABASE_SERVICE_ROLE_KEY ou
-- SUPABASE_SECRET_KEY no backend local/Vercel.
-- ============================================================

ALTER TABLE public.jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can manage non-sensitive sync jobs" ON public.jira_sync_jobs;
DROP POLICY IF EXISTS "Allow anon" ON public.jira_connections;
DROP POLICY IF EXISTS "Allow anon" ON public.jira_issues;
DROP POLICY IF EXISTS "Allow anon" ON public.jira_sync_jobs;
DROP POLICY IF EXISTS "Allow anon" ON public.user_sessions;

DROP POLICY IF EXISTS "Service role only - connections" ON public.jira_connections;
CREATE POLICY "Service role only - connections" ON public.jira_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - issues" ON public.jira_issues;
CREATE POLICY "Service role only - issues" ON public.jira_issues
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - sync jobs" ON public.jira_sync_jobs;
CREATE POLICY "Service role only - sync jobs" ON public.jira_sync_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role only - sessions" ON public.user_sessions;
CREATE POLICY "Service role only - sessions" ON public.user_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
