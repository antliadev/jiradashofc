-- P1-1857: Alocacao de Recursos com persistencia operacional e historico auditavel.
CREATE TABLE IF NOT EXISTS public.resource_allocation_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  client text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('Planejado', 'Em andamento', 'Concluído', 'Suspenso', 'Cancelado')),
  note text NOT NULL DEFAULT '',
  color text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.resource_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  user_name text NOT NULL DEFAULT '',
  user_email text NOT NULL DEFAULT '',
  project_id uuid NOT NULL REFERENCES public.resource_allocation_projects(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  percent numeric(5,2) NOT NULL CHECK (percent > 0 AND percent <= 200),
  role text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.resource_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('project.created', 'project.updated', 'allocation.created', 'allocation.updated')),
  project_id uuid REFERENCES public.resource_allocation_projects(id) ON DELETE SET NULL,
  allocation_id uuid REFERENCES public.resource_allocations(id) ON DELETE SET NULL,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  before jsonb,
  after jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS resource_allocations_project_idx ON public.resource_allocations(project_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS resource_allocations_user_idx ON public.resource_allocations(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS resource_allocation_events_created_idx ON public.resource_allocation_events(created_at DESC);

ALTER TABLE public.resource_allocation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_allocation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.resource_allocation_projects FROM anon, authenticated;
REVOKE ALL ON public.resource_allocations FROM anon, authenticated;
REVOKE ALL ON public.resource_allocation_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.resource_allocation_projects TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.resource_allocations TO service_role;
GRANT SELECT, INSERT ON public.resource_allocation_events TO service_role;

DROP POLICY IF EXISTS resource_allocation_projects_service ON public.resource_allocation_projects;
CREATE POLICY resource_allocation_projects_service ON public.resource_allocation_projects FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS resource_allocations_service ON public.resource_allocations;
CREATE POLICY resource_allocations_service ON public.resource_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS resource_allocation_events_service ON public.resource_allocation_events;
CREATE POLICY resource_allocation_events_service ON public.resource_allocation_events FOR ALL TO service_role USING (true) WITH CHECK (true);
