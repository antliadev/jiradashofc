-- ============================================================
-- Jira Dashboard - Campos de timeline para Gantt
-- Seguro para rodar varias vezes. Nao apaga dados existentes.
-- ============================================================

ALTER TABLE public.jira_issues
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS planned_start_date DATE,
  ADD COLUMN IF NOT EXISTS planned_end_date DATE,
  ADD COLUMN IF NOT EXISTS jira_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_fields JSONB DEFAULT '{}'::JSONB;

-- Backfill conservador: due_date oficial vira fim planejado quando ainda vazio.
UPDATE public.jira_issues
SET planned_end_date = due_date
WHERE planned_end_date IS NULL
  AND due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_start_date
  ON public.jira_issues(start_date)
  WHERE start_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_planned_start_date
  ON public.jira_issues(planned_start_date)
  WHERE planned_start_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_planned_end_date
  ON public.jira_issues(planned_end_date)
  WHERE planned_end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_due_date
  ON public.jira_issues(due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jira_issues_timeline_filters
  ON public.jira_issues(project_key, assignee_id, status_name, priority_name);

CREATE INDEX IF NOT EXISTS idx_jira_issues_raw_fields_gin
  ON public.jira_issues USING GIN(raw_fields);
