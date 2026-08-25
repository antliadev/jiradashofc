CREATE TABLE IF NOT EXISTS public.rja_access_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'active',
  permissions JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rja_access_users_role_check CHECK (role IN ('full', 'master', 'custom')),
  CONSTRAINT rja_access_users_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_rja_access_users_login
  ON public.rja_access_users(LOWER(login));

CREATE INDEX IF NOT EXISTS idx_rja_access_users_status
  ON public.rja_access_users(status);

ALTER TABLE public.rja_access_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only - rja access users" ON public.rja_access_users;
CREATE POLICY "Service role only - rja access users" ON public.rja_access_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
