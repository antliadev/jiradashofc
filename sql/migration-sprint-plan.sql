-- P1 Sprint Plan v1.1: registros imutaveis de perfil, origem, draft e baseline.
CREATE TABLE IF NOT EXISTS public.sprint_plan_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision BIGINT GENERATED ALWAYS AS IDENTITY,
  kind TEXT NOT NULL CHECK (kind IN ('profile', 'source', 'draft', 'baseline', 'snapshot')),
  project_key TEXT NOT NULL,
  board_id TEXT NOT NULL,
  sprint_id TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  request_id UUID,
  UNIQUE (created_by, request_id)
);
CREATE INDEX IF NOT EXISTS sprint_plan_context_idx ON public.sprint_plan_records(project_key, board_id, sprint_id, kind, revision DESC);
ALTER TABLE public.sprint_plan_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sprint_plan_records FROM anon, authenticated;
GRANT SELECT, INSERT ON public.sprint_plan_records TO service_role;
CREATE OR REPLACE FUNCTION public.reject_sprint_plan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Sprint Plan records are immutable; create a new revision'; END $$;
DROP TRIGGER IF EXISTS sprint_plan_immutable ON public.sprint_plan_records;
CREATE TRIGGER sprint_plan_immutable BEFORE UPDATE OR DELETE ON public.sprint_plan_records FOR EACH ROW EXECUTE FUNCTION public.reject_sprint_plan_mutation();
