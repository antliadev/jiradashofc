-- ============================================================
-- Verificar e corrigir schema do banco
-- Execute este SQL no editor SQL do Supabase
-- ============================================================

-- 1. Verificar colunas existentes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'jira_issues'
ORDER BY ordinal_position;

-- 2. Adicionar due_date se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jira_issues' AND column_name = 'due_date'
  ) THEN
    ALTER TABLE jira_issues ADD COLUMN due_date DATE;
    RAISE NOTICE 'Coluna due_date adicionada com sucesso';
  ELSE
    RAISE NOTICE 'Coluna due_date já existe';
  END IF;
END $$;

-- 3. Adicionar story_points se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jira_issues' AND column_name = 'story_points'
  ) THEN
    ALTER TABLE jira_issues ADD COLUMN story_points INTEGER DEFAULT 0;
    RAISE NOTICE 'Coluna story_points adicionada com sucesso';
  ELSE
    RAISE NOTICE 'Coluna story_points já existe';
  END IF;
END $$;

-- 4. Verificar resultado final
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'jira_issues' 
AND column_name IN ('due_date', 'story_points');