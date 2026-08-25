-- ============================================================
-- Jira Dashboard - performance indexes for filtered reads
-- Safe to run multiple times. Does not remove or mutate data.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_jira_issues_project_updated
  ON public.jira_issues(project_key, jira_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jira_issues_updated_at_desc
  ON public.jira_issues(jira_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jira_issues_assignee_updated
  ON public.jira_issues(assignee_id, jira_updated_at DESC)
  WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_status_updated
  ON public.jira_issues(status_name, jira_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jira_issues_priority_updated
  ON public.jira_issues(priority_name, jira_updated_at DESC)
  WHERE priority_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_type_updated
  ON public.jira_issues(type_name, jira_updated_at DESC)
  WHERE type_name IS NOT NULL;
