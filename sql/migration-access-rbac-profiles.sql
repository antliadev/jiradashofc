-- ============================================================
-- JiraDash - RBAC por Perfis de Acesso
-- Substitui a matriz operacional antiga por perfis centralizados:
-- Dev/QA, Gestão e Diretoria.
-- ============================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (primary_role ~ '^[a-z0-9_.-]{2,60}$');

ALTER TABLE public.access_grants DROP CONSTRAINT IF EXISTS access_grants_role_check;
ALTER TABLE public.access_grants
  ADD CONSTRAINT access_grants_role_check
  CHECK (primary_role ~ '^[a-z0-9_.-]{2,60}$');

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_code_check;
ALTER TABLE public.roles
  ADD CONSTRAINT roles_code_check
  CHECK (code ~ '^[a-z0-9_.-]{2,60}$');

INSERT INTO public.roles (code, name, description) VALUES
  ('dev_qa', 'Dev/QA', 'Acesso operacional com restrição aos próprios dados nas visões de Analistas.'),
  ('gestao', 'Gestão', 'Acesso gerencial aos módulos operacionais e executivos, sem administração de usuários.'),
  ('diretoria', 'Diretoria', 'Acesso completo, incluindo configuração e Gestão de Acessos.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.permissions (code, name, module) VALUES
  ('dashboard', 'Dashboard', 'dashboard'),
  ('executive', 'Home', 'home'),
  ('contracts.crawford', 'Contratos Consumo Horas / Crawford', 'contracts'),
  ('contracts.docwise', 'Contratos Consumo Horas / Docwise', 'contracts'),
  ('monitoring.overdue', 'Monitoramento de Cards / Cards com Data em Atraso', 'monitoring'),
  ('monitoring.blocked', 'Monitoramento de Cards / Cards Bloqueados', 'monitoring'),
  ('gantt', 'Gantt', 'planning'),
  ('projects.sprint-plan', 'Sprint / Sprint Plan', 'sprint'),
  ('projects.sprint-review', 'Sprint / Sprint Review', 'sprint'),
  ('projects.kanban', 'Projetos / Issues - Kanban', 'projects'),
  ('projects.health', 'Projetos / Saúde Detalhamento Cards Projetos', 'projects'),
  ('projects.resource-allocation', 'Projetos / Alocação de Recursos', 'projects'),
  ('analysts.general', 'Analistas / Geral', 'analysts'),
  ('analysts.evolution', 'Analistas / Evolução', 'analysts'),
  ('analysts.comparative', 'Analistas / Comparativo', 'analysts'),
  ('data', 'Configuração / Dados', 'admin'),
  ('access.users', 'Gestão de Usuários / Usuários', 'admin'),
  ('access.profiles', 'Gestão de Usuários / Grupos de Acesso', 'admin'),
  ('access.permissions', 'Gestão de Usuários / Permissões', 'admin'),
  ('access.manage', 'Gestão de Acessos', 'admin')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  module = EXCLUDED.module;

DELETE FROM public.role_permissions
WHERE role_id IN (
  SELECT id FROM public.roles WHERE code IN ('dev_qa', 'gestao', 'diretoria')
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'dashboard',
  'executive',
  'monitoring.overdue',
  'monitoring.blocked',
  'gantt',
  'projects.kanban',
  'analysts.general',
  'analysts.evolution'
)
WHERE r.code = 'dev_qa'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'dashboard',
  'executive',
  'contracts.crawford',
  'contracts.docwise',
  'monitoring.overdue',
  'monitoring.blocked',
  'gantt',
  'projects.sprint-plan',
  'projects.sprint-review',
  'projects.kanban',
  'projects.health',
  'projects.resource-allocation',
  'analysts.general',
  'analysts.evolution',
  'analysts.comparative'
)
WHERE r.code = 'gestao'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'diretoria'
ON CONFLICT DO NOTHING;

UPDATE public.profiles
SET primary_role = CASE primary_role
  WHEN 'full' THEN 'diretoria'
  WHEN 'master' THEN 'gestao'
  WHEN 'visualizacao' THEN 'dev_qa'
  WHEN 'personalizado' THEN 'dev_qa'
  WHEN 'desenvolvedor_ba' THEN 'dev_qa'
  ELSE primary_role
END
WHERE primary_role IN ('full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba');

UPDATE public.access_grants
SET primary_role = CASE primary_role
  WHEN 'full' THEN 'diretoria'
  WHEN 'master' THEN 'gestao'
  WHEN 'visualizacao' THEN 'dev_qa'
  WHEN 'personalizado' THEN 'dev_qa'
  WHEN 'desenvolvedor_ba' THEN 'dev_qa'
  ELSE primary_role
END
WHERE primary_role IN ('full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba');

DELETE FROM public.user_roles ur
USING public.profiles p
WHERE ur.user_id = p.user_id
  AND p.primary_role IN ('dev_qa', 'gestao', 'diretoria');

INSERT INTO public.user_roles (user_id, role_id)
SELECT p.user_id, r.id
FROM public.profiles p
JOIN public.roles r ON r.code = p.primary_role
WHERE p.primary_role IN ('dev_qa', 'gestao', 'diretoria')
ON CONFLICT DO NOTHING;
