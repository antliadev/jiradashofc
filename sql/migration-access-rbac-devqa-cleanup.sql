-- ============================================================
-- JiraDash - limpeza dos perfis oficiais de acesso
-- Mantém apenas Diretoria, Gestão e Dev/QA como perfis operacionais.
-- Usuários/grants existentes ficam como Diretoria, exceto Hector, que fica Dev/QA.
-- ============================================================

INSERT INTO public.roles (code, name, description) VALUES
  ('dev_qa', 'Dev/QA', 'Acesso operacional com restrição aos próprios dados nas visões de Analistas.'),
  ('gestao', 'Gestão', 'Acesso gerencial aos módulos operacionais e executivos, sem administração de usuários.'),
  ('diretoria', 'Diretoria', 'Acesso completo, incluindo configuração e Gestão de Acessos.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

UPDATE public.profiles
SET primary_role = CASE
  WHEN lower(coalesce(email, '')) LIKE '%hector%'
    OR lower(coalesce(display_name, '')) LIKE '%hector%'
    THEN 'dev_qa'
  ELSE 'diretoria'
END,
updated_at = now()
WHERE primary_role IS DISTINCT FROM CASE
  WHEN lower(coalesce(email, '')) LIKE '%hector%'
    OR lower(coalesce(display_name, '')) LIKE '%hector%'
    THEN 'dev_qa'
  ELSE 'diretoria'
END;

UPDATE public.access_grants
SET primary_role = CASE
  WHEN lower(coalesce(email, '')) LIKE '%hector%'
    OR lower(coalesce(display_name, '')) LIKE '%hector%'
    THEN 'dev_qa'
  ELSE 'diretoria'
END,
updated_at = now()
WHERE primary_role IS DISTINCT FROM CASE
  WHEN lower(coalesce(email, '')) LIKE '%hector%'
    OR lower(coalesce(display_name, '')) LIKE '%hector%'
    THEN 'dev_qa'
  ELSE 'diretoria'
END;

DELETE FROM public.user_roles ur
USING public.profiles p
WHERE ur.user_id = p.user_id;

INSERT INTO public.user_roles (user_id, role_id)
SELECT p.user_id, r.id
FROM public.profiles p
JOIN public.roles r ON r.code = p.primary_role
WHERE p.primary_role IN ('dev_qa', 'gestao', 'diretoria')
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permissions
WHERE role_id IN (
  SELECT id FROM public.roles WHERE code IN ('full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba')
);

DELETE FROM public.user_roles
WHERE role_id IN (
  SELECT id FROM public.roles WHERE code IN ('full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba')
);

DELETE FROM public.roles
WHERE code IN ('full', 'master', 'visualizacao', 'personalizado', 'desenvolvedor_ba');
