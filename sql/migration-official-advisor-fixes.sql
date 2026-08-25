-- ============================================================
-- JiraDash Oficial - correcoes apos Supabase Advisors
-- ============================================================

CREATE SCHEMA IF NOT EXISTS app_private;

ALTER VIEW public.user_effective_permissions SET (security_invoker = true);

ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION app_private.app_has_permission(permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.app_has_permission(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_antlia_email_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.app_has_permission(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.app_has_permission(TEXT) TO authenticated;

DROP POLICY IF EXISTS "profiles own read" ON public.profiles;
CREATE POLICY "profiles own read" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR app_private.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "user roles read own or admin" ON public.user_roles;
CREATE POLICY "user roles read own or admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR app_private.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "user permissions read own or admin" ON public.user_permissions;
CREATE POLICY "user permissions read own or admin" ON public.user_permissions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR app_private.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "audit logs admin read" ON public.audit_logs;
CREATE POLICY "audit logs admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "email exceptions admin read" ON public.auth_allowed_email_exceptions;
CREATE POLICY "email exceptions admin read" ON public.auth_allowed_email_exceptions
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('access.manage'));

DROP POLICY IF EXISTS "jira issues authenticated dashboard read" ON public.jira_issues;
CREATE POLICY "jira issues authenticated dashboard read" ON public.jira_issues
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('dashboard') OR app_private.app_has_permission('projects.kanban'));

DROP POLICY IF EXISTS "jira comments restricted read" ON public.jira_issue_comments;
CREATE POLICY "jira comments restricted read" ON public.jira_issue_comments
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('projects.detailed') OR app_private.app_has_permission('analysts.general'));

DROP POLICY IF EXISTS "jira changelog restricted read" ON public.jira_issue_changelog;
CREATE POLICY "jira changelog restricted read" ON public.jira_issue_changelog
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('projects.detailed') OR app_private.app_has_permission('analysts.general'));

DROP POLICY IF EXISTS "jira worklogs contracts read" ON public.jira_worklogs;
CREATE POLICY "jira worklogs contracts read" ON public.jira_worklogs
  FOR SELECT TO authenticated
  USING (app_private.app_has_permission('contracts.crawford') OR app_private.app_has_permission('contracts.docwise'));

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON public.role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission_id ON public.user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles(role_id);

DROP INDEX IF EXISTS public.idx_jira_issues_jira_updated_at;
