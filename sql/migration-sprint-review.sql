-- P1-1849: append-only profiles, source collections and approved review versions.
CREATE TABLE IF NOT EXISTS public.sprint_review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  kind text NOT NULL CHECK (kind IN ('profile', 'source', 'snapshot', 'baseline', 'render')),
  project_key text NOT NULL,
  board_id text NOT NULL,
  sprint_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  content_hash text NOT NULL,
  request_id uuid,
  UNIQUE (created_by, request_id)
);
CREATE INDEX IF NOT EXISTS sprint_review_context_idx ON public.sprint_review_records(project_key, board_id, sprint_id, kind, revision DESC);
ALTER TABLE public.sprint_review_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sprint_review_records FROM anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.sprint_review_records TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sprint_review_records_revision_seq TO service_role;
DROP POLICY IF EXISTS sprint_review_service_read ON public.sprint_review_records;
CREATE POLICY sprint_review_service_read ON public.sprint_review_records FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS sprint_review_service_insert ON public.sprint_review_records;
CREATE POLICY sprint_review_service_insert ON public.sprint_review_records FOR INSERT TO service_role WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.reject_sprint_review_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Sprint Review records are immutable; create a new revision';
END;
$$;
DROP TRIGGER IF EXISTS sprint_review_immutable ON public.sprint_review_records;
CREATE TRIGGER sprint_review_immutable BEFORE UPDATE OR DELETE ON public.sprint_review_records FOR EACH ROW EXECUTE FUNCTION public.reject_sprint_review_mutation();
