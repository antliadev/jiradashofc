-- ============================================================
-- JiraDash Oficial - Supabase Auth, perfis, permissoes e RLS
-- Aplicar no projeto oficial depois de configurar backups/ambiente.
-- Projeto alvo: vzkiniwjhnhfximpfzuk
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  primary_role TEXT NOT NULL DEFAULT 'visualizacao',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT profiles_role_check CHECK (primary_role IN ('full', 'master', 'visualizacao', 'personalizado'))
);

CREATE TABLE IF NOT EXISTS public.auth_allowed_email_exceptions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'Conta administrativa geral aprovada',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_allowed_email_exceptions_email_check CHECK (position('@' in email) > 1)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_check CHECK (code IN ('full', 'master', 'visualizacao', 'personalizado'))
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.roles (code, name, description) VALUES
  ('full', 'Full', 'Administracao completa do JiraDash.'),
  ('master', 'Master', 'Acesso amplo operacional sem gestao plena de acessos.'),
  ('visualizacao', 'Visualizacao', 'Acesso de leitura aos modulos permitidos.'),
  ('personalizado', 'Personalizado', 'Permissoes atribuidas individualmente.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.permissions (code, name, module) VALUES
  ('dashboard', 'Dashboard', 'dashboard'),
  ('executive', 'Resumo Executivo', 'dashboard'),
  ('contracts.crawford', 'Contratos Crawford', 'contracts'),
  ('contracts.docwise', 'Contratos Docwise', 'contracts'),
  ('monitoring.overdue', 'Cards em Atraso', 'monitoring'),
  ('monitoring.blocked', 'Cards Bloqueados', 'monitoring'),
  ('gantt', 'Gantt', 'planning'),
  ('projects.kanban', 'Projetos Kanban', 'projects'),
  ('projects.health', 'Saude dos Cards', 'projects'),
  ('projects.executive', 'Relatorio Gerencial', 'projects'),
  ('projects.detailed', 'Relatorio Detalhado', 'projects'),
  ('analysts.general', 'Analistas Geral', 'analysts'),
  ('analysts.comparative', 'Analistas Comparativo', 'analysts'),
  ('analysts.evolution', 'Analistas Evolucao', 'analysts'),
  ('data', 'Gestao de Dados', 'admin'),
  ('access.manage', 'Gestao de Acessos', 'admin')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  module = EXCLUDED.module;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'full'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'master'
  AND p.code <> 'access.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'visualizacao'
  AND p.code NOT IN ('data', 'access.manage')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.user_effective_permissions AS
SELECT ur.user_id, p.code AS permission_code
FROM public.user_roles ur
JOIN public.role_permissions rp ON rp.role_id = ur.role_id
JOIN public.permissions p ON p.id = rp.permission_id
UNION
SELECT up.user_id, p.code AS permission_code
FROM public.user_permissions up
JOIN public.permissions p ON p.id = up.permission_id;

CREATE OR REPLACE FUNCTION public.app_has_permission(permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.user_effective_permissions uep ON uep.user_id = pr.user_id
    WHERE pr.user_id = (select auth.uid())
      AND pr.status = 'active'
      AND uep.permission_code = app_has_permission.permission_code
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_antlia_email_domain()
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

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS enforce_profiles_email_domain ON public.profiles;
CREATE TRIGGER enforce_profiles_email_domain
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_antlia_email_domain();

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_status_role ON public.profiles(status, primary_role);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON public.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON public.audit_logs(actor_user_id, created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_allowed_email_exceptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.user_effective_permissions TO authenticated;
GRANT SELECT ON public.profiles, public.roles, public.permissions, public.user_roles, public.role_permissions, public.user_permissions TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.auth_allowed_email_exceptions TO authenticated;

DROP POLICY IF EXISTS "profiles own read" ON public.profiles;
CREATE POLICY "profiles own read" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "profiles own limited update" ON public.profiles;

DROP POLICY IF EXISTS "roles read authenticated" ON public.roles;
CREATE POLICY "roles read authenticated" ON public.roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "permissions read authenticated" ON public.permissions;
CREATE POLICY "permissions read authenticated" ON public.permissions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "user roles read own or admin" ON public.user_roles;
CREATE POLICY "user roles read own or admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "role permissions read authenticated" ON public.role_permissions;
CREATE POLICY "role permissions read authenticated" ON public.role_permissions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "user permissions read own or admin" ON public.user_permissions;
CREATE POLICY "user permissions read own or admin" ON public.user_permissions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "audit logs admin read" ON public.audit_logs;
CREATE POLICY "audit logs admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "email exceptions admin read" ON public.auth_allowed_email_exceptions;
CREATE POLICY "email exceptions admin read" ON public.auth_allowed_email_exceptions
  FOR SELECT TO authenticated
  USING (public.app_has_permission('access.manage'));

ALTER TABLE IF EXISTS public.jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jira_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jira_issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jira_issue_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jira_worklogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jira_sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jira issues authenticated dashboard read" ON public.jira_issues;
CREATE POLICY "jira issues authenticated dashboard read" ON public.jira_issues
  FOR SELECT TO authenticated
  USING (public.app_has_permission('dashboard') OR public.app_has_permission('projects.kanban'));

DROP POLICY IF EXISTS "jira comments restricted read" ON public.jira_issue_comments;
CREATE POLICY "jira comments restricted read" ON public.jira_issue_comments
  FOR SELECT TO authenticated
  USING (public.app_has_permission('projects.detailed') OR public.app_has_permission('analysts.general'));

DROP POLICY IF EXISTS "jira changelog restricted read" ON public.jira_issue_changelog;
CREATE POLICY "jira changelog restricted read" ON public.jira_issue_changelog
  FOR SELECT TO authenticated
  USING (public.app_has_permission('projects.detailed') OR public.app_has_permission('analysts.general'));

DROP POLICY IF EXISTS "jira worklogs contracts read" ON public.jira_worklogs;
CREATE POLICY "jira worklogs contracts read" ON public.jira_worklogs
  FOR SELECT TO authenticated
  USING (public.app_has_permission('contracts.crawford') OR public.app_has_permission('contracts.docwise'));

DROP POLICY IF EXISTS "jira connections service role only" ON public.jira_connections;
CREATE POLICY "jira connections service role only" ON public.jira_connections
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "jira sync jobs service role only" ON public.jira_sync_jobs;
CREATE POLICY "jira sync jobs service role only" ON public.jira_sync_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
