-- Worklogs do Jira usados pelo relatorio mensal de horas Crawford.
-- Aplicar no Supabase antes de habilitar a nova tela em producao.

CREATE TABLE IF NOT EXISTS jira_worklogs (
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
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jira_worklogs_project_started
  ON jira_worklogs(project_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jira_worklogs_issue_key
  ON jira_worklogs(issue_key);

ALTER TABLE jira_worklogs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE jira_worklogs FROM anon, authenticated;

COMMENT ON TABLE jira_worklogs IS 'Apontamentos Jira persistidos pelo backend para relatorios de horas.';
COMMENT ON COLUMN jira_worklogs.started_at IS 'Inicio do apontamento; competencia calculada em America/Sao_Paulo.';

