-- Additive migration. Apply separately; legacy renders remain untouched.
BEGIN;

ALTER TABLE public.sprint_review_records
  ADD CONSTRAINT sprint_review_art_v2_shape CHECK (
    kind <> 'render' OR (payload->'artVersion') IS DISTINCT FROM '2'::jsonb OR
    COALESCE(
      payload->'artVersion' = '2'::jsonb
      AND jsonb_typeof(payload->'snapshotId') = 'string'
      AND payload->>'snapshotId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND jsonb_typeof(payload->'page') = 'number'
      AND payload->>'page' ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'pngHash') = 'string'
      AND payload->>'pngHash' ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(payload->'snapshotHash') = 'string'
      AND payload->>'snapshotHash' ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(payload->'png') = 'string',
      false
    )
  );

CREATE UNIQUE INDEX sprint_review_art_v2_snapshot_page_unique
  ON public.sprint_review_records ((payload->>'snapshotId'), ((payload->>'page')::numeric))
  WHERE kind = 'render' AND payload->'artVersion' = '2'::jsonb;

COMMIT;
