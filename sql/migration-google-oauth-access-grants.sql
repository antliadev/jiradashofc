-- ============================================================
-- JiraDash Oficial - Google OAuth allowlist por email
-- Permite liberar acesso antes do primeiro login Google.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.access_grants (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  primary_role TEXT NOT NULL DEFAULT 'visualizacao',
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT access_grants_email_check CHECK (position('@' in email) > 1),
  CONSTRAINT access_grants_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT access_grants_role_check CHECK (primary_role IN ('full', 'master', 'visualizacao', 'personalizado'))
);

CREATE OR REPLACE FUNCTION public.enforce_access_grants_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email = lower(trim(NEW.email));
  IF NEW.email LIKE '%@antlia.com.br' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auth_allowed_email_exceptions e
    WHERE lower(e.email) = NEW.email
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Email fora do dominio permitido';
END;
$$;

DROP TRIGGER IF EXISTS set_access_grants_updated_at ON public.access_grants;
CREATE TRIGGER set_access_grants_updated_at
  BEFORE UPDATE ON public.access_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS enforce_access_grants_email_domain ON public.access_grants;
CREATE TRIGGER enforce_access_grants_email_domain
  BEFORE INSERT OR UPDATE OF email ON public.access_grants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_access_grants_email_domain();

CREATE INDEX IF NOT EXISTS idx_access_grants_status_role ON public.access_grants(status, primary_role);

ALTER TABLE public.access_grants ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.access_grants TO authenticated;

DROP POLICY IF EXISTS "access grants admin read" ON public.access_grants;
CREATE POLICY "access grants admin read" ON public.access_grants
  FOR SELECT TO authenticated
  USING (public.app_has_permission('access.manage'));

-- Escrita desta tabela deve ocorrer pelo backend com chave privilegiada.
