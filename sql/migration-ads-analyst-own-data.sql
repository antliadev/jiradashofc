-- Antlia Deliverable System: official matrix and own analyst evidence.
-- Keep legacy storage codes compatible with existing sessions and grants.
GRANT USAGE ON SCHEMA app_private TO authenticated;
INSERT INTO public.permissions (code,name,module) VALUES
('dashboard','Dashboard','Dashboard'),
('executive','Home','Home'),
('contracts.crawford','Contratos / Crawford','Contratos Consumo Horas'),
('contracts.docwise','Contratos / Docwise','Contratos Consumo Horas'),
('monitoring.overdue','Monitoramento / Cards em Atraso','Monitoramento de Cards'),
('monitoring.blocked','Monitoramento / Cards Bloqueados','Monitoramento de Cards'),
('gantt','Gantt','Gantt'),
('projects.sprint-plan','Sprint / Sprint Plan','Sprint'),
('projects.sprint-review','Sprint / Sprint Review','Sprint'),
('projects.kanban','Projetos / Issues - Kanban','Projetos'),
('projects.health','Projetos / Saúde dos Cards','Projetos'),
('projects.resource-allocation','Projetos / Alocação de Recursos','Projetos'),
('analysts.general','Analistas / Geral','Analistas'),
('analysts.evolution','Analistas / Evolução','Analistas'),
('analysts.comparative','Analistas / Comparativo','Analistas'),
('data','Configuração / Dados','Configuração'),
('access.users','Gestão de Usuários / Usuários','Gestão de Usuários'),
('access.profiles','Gestão de Usuários / Grupos de Acesso','Gestão de Usuários'),
('access.permissions','Gestão de Usuários / Permissões','Gestão de Usuários'),
('access.manage','Gestão de Acessos','Gestão de Usuários')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,module=EXCLUDED.module;

DELETE FROM public.role_permissions WHERE role_id IN (
 SELECT id FROM public.roles WHERE code IN ('dev_qa','visualizacao','personalizado','custom','desenvolvedor_ba','gestao','master','diretoria','full')
);
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM (VALUES
('dev_qa','dashboard'),
('dev_qa','executive'),
('dev_qa','monitoring.overdue'),
('dev_qa','monitoring.blocked'),
('dev_qa','gantt'),
('dev_qa','projects.kanban'),
('dev_qa','analysts.general'),
('dev_qa','analysts.evolution'),
('visualizacao','dashboard'),
('visualizacao','executive'),
('visualizacao','monitoring.overdue'),
('visualizacao','monitoring.blocked'),
('visualizacao','gantt'),
('visualizacao','projects.kanban'),
('visualizacao','analysts.general'),
('visualizacao','analysts.evolution'),
('personalizado','dashboard'),
('personalizado','executive'),
('personalizado','monitoring.overdue'),
('personalizado','monitoring.blocked'),
('personalizado','gantt'),
('personalizado','projects.kanban'),
('personalizado','analysts.general'),
('personalizado','analysts.evolution'),
('custom','dashboard'),
('custom','executive'),
('custom','monitoring.overdue'),
('custom','monitoring.blocked'),
('custom','gantt'),
('custom','projects.kanban'),
('custom','analysts.general'),
('custom','analysts.evolution'),
('desenvolvedor_ba','dashboard'),
('desenvolvedor_ba','executive'),
('desenvolvedor_ba','monitoring.overdue'),
('desenvolvedor_ba','monitoring.blocked'),
('desenvolvedor_ba','gantt'),
('desenvolvedor_ba','projects.kanban'),
('desenvolvedor_ba','analysts.general'),
('desenvolvedor_ba','analysts.evolution'),
('gestao','dashboard'),
('gestao','executive'),
('gestao','contracts.crawford'),
('gestao','contracts.docwise'),
('gestao','monitoring.overdue'),
('gestao','monitoring.blocked'),
('gestao','gantt'),
('gestao','projects.sprint-plan'),
('gestao','projects.sprint-review'),
('gestao','projects.kanban'),
('gestao','projects.health'),
('gestao','projects.resource-allocation'),
('gestao','analysts.general'),
('gestao','analysts.evolution'),
('gestao','analysts.comparative'),
('master','dashboard'),
('master','executive'),
('master','contracts.crawford'),
('master','contracts.docwise'),
('master','monitoring.overdue'),
('master','monitoring.blocked'),
('master','gantt'),
('master','projects.sprint-plan'),
('master','projects.sprint-review'),
('master','projects.kanban'),
('master','projects.health'),
('master','projects.resource-allocation'),
('master','analysts.general'),
('master','analysts.evolution'),
('master','analysts.comparative'),
('diretoria','dashboard'),
('diretoria','executive'),
('diretoria','contracts.crawford'),
('diretoria','contracts.docwise'),
('diretoria','monitoring.overdue'),
('diretoria','monitoring.blocked'),
('diretoria','gantt'),
('diretoria','projects.sprint-plan'),
('diretoria','projects.sprint-review'),
('diretoria','projects.kanban'),
('diretoria','projects.health'),
('diretoria','projects.resource-allocation'),
('diretoria','analysts.general'),
('diretoria','analysts.evolution'),
('diretoria','analysts.comparative'),
('diretoria','data'),
('diretoria','access.users'),
('diretoria','access.profiles'),
('diretoria','access.permissions'),
('full','dashboard'),
('full','executive'),
('full','contracts.crawford'),
('full','contracts.docwise'),
('full','monitoring.overdue'),
('full','monitoring.blocked'),
('full','gantt'),
('full','projects.sprint-plan'),
('full','projects.sprint-review'),
('full','projects.kanban'),
('full','projects.health'),
('full','projects.resource-allocation'),
('full','analysts.general'),
('full','analysts.evolution'),
('full','analysts.comparative'),
('full','data'),
('full','access.users'),
('full','access.profiles'),
('full','access.permissions'),
('diretoria','access.manage'),
('full','access.manage')
) AS matrix(role_code,permission_code)
JOIN public.roles r ON r.code=matrix.role_code
JOIN public.permissions p ON p.code=matrix.permission_code
ON CONFLICT DO NOTHING;

UPDATE public.roles SET name=CASE
 WHEN code IN ('dev_qa','visualizacao','personalizado','custom','desenvolvedor_ba') THEN 'Desenvolvedor / QA'
 WHEN code IN ('gestao','master') THEN 'Gestão'
 ELSE 'Diretoria' END
WHERE code IN ('dev_qa','visualizacao','personalizado','custom','desenvolvedor_ba','gestao','master','diretoria','full');

CREATE OR REPLACE FUNCTION app_private.app_has_permission(permission_code TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.profiles pr
  JOIN public.roles r ON r.code=pr.primary_role
  JOIN public.role_permissions rp ON rp.role_id=r.id
  JOIN public.permissions p ON p.id=rp.permission_id
  JOIN public.access_grants ag ON lower(ag.email)=lower(pr.email) AND ag.status='active'
  WHERE pr.user_id=(SELECT auth.uid()) AND pr.status='active'
    AND p.code=app_has_permission.permission_code
 );
$$;
REVOKE ALL ON FUNCTION app_private.app_has_permission(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.app_has_permission(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.has_full_analyst_scope()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT (app_private.app_has_permission('analysts.general') OR app_private.app_has_permission('analysts.evolution'))
 AND EXISTS (
  SELECT 1 FROM public.profiles pr WHERE pr.user_id=(SELECT auth.uid()) AND pr.status='active'
  AND pr.primary_role NOT IN ('dev_qa','visualizacao','personalizado','custom','desenvolvedor_ba')
 );
$$;
CREATE OR REPLACE FUNCTION app_private.own_analyst_issue_ids()
RETURNS SETOF TEXT LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT i.issue_id FROM public.jira_issues i
 JOIN public.profiles pr ON lower(trim(i.assignee_email))=lower(trim(pr.email))
 WHERE pr.user_id=(SELECT auth.uid()) AND pr.status='active'
 AND (app_private.app_has_permission('analysts.general') OR app_private.app_has_permission('analysts.evolution'));
$$;
REVOKE ALL ON FUNCTION app_private.has_full_analyst_scope() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION app_private.own_analyst_issue_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.has_full_analyst_scope() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.own_analyst_issue_ids() TO authenticated;

DROP POLICY IF EXISTS "jira comments restricted read" ON public.jira_issue_comments;
CREATE POLICY "jira comments restricted read" ON public.jira_issue_comments FOR SELECT TO authenticated
USING ((SELECT app_private.has_full_analyst_scope()) OR issue_id IN (SELECT app_private.own_analyst_issue_ids()));
DROP POLICY IF EXISTS "jira changelog restricted read" ON public.jira_issue_changelog;
CREATE POLICY "jira changelog restricted read" ON public.jira_issue_changelog FOR SELECT TO authenticated
USING ((SELECT app_private.has_full_analyst_scope()) OR issue_id IN (SELECT app_private.own_analyst_issue_ids()));
DROP FUNCTION IF EXISTS app_private.can_read_analyst_issue(TEXT);
