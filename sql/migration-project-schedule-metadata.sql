-- Jira Dash - metadata manual de cronograma por projeto

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

CREATE INDEX IF NOT EXISTS idx_jira_project_metadata_project_id
  ON public.jira_project_metadata(project_id);

ALTER TABLE public.jira_project_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only - project metadata" ON public.jira_project_metadata;
CREATE POLICY "Service role only - project metadata" ON public.jira_project_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_jira_project_metadata_updated_at ON public.jira_project_metadata;
CREATE TRIGGER set_jira_project_metadata_updated_at
  BEFORE UPDATE ON public.jira_project_metadata
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
