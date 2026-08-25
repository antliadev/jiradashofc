-- ============================================================
-- Migração: Adicionar colunas due_date e story_points
-- Execute este SQL no editor SQL do Supabase
-- ============================================================

-- Adicionar coluna due_date se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jira_issues' AND column_name = 'due_date'
  ) THEN
    ALTER TABLE jira_issues ADD COLUMN due_date DATE;
  END IF;
END $$;

-- Adicionar coluna story_points se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jira_issues' AND column_name = 'story_points'
  ) THEN
    ALTER TABLE jira_issues ADD COLUMN story_points INTEGER DEFAULT 0;
  END IF;
END $$;

-- Verificar resultado
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'jira_issues' 
AND column_name IN ('due_date', 'story_points');