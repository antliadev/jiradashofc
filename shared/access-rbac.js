export const ACCESS_LEVEL = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  PARTIAL: 'partial',
});

export const ACCESS_PROFILES = Object.freeze([
  {
    code: 'desenvolvedor_ba',
    name: 'Desenvolvedor / BA',
    description: 'Acesso operacional com restrição aos próprios dados nas visões de Analistas.',
  },
  {
    code: 'gestao',
    name: 'Gestão',
    description: 'Acesso gerencial aos módulos operacionais e executivos, sem administração de usuários.',
  },
  {
    code: 'diretoria',
    name: 'Diretoria',
    description: 'Acesso completo, incluindo configuração e Gestão de Acessos.',
  },
]);

export const LEGACY_PROFILE_ALIASES = Object.freeze({
  custom: 'desenvolvedor_ba',
  personalizado: 'desenvolvedor_ba',
  visualizacao: 'desenvolvedor_ba',
  master: 'gestao',
  full: 'diretoria',
});

export const ACCESS_MODULES = Object.freeze([
  { code: 'dashboard', module: 'Dashboard', submodule: '—', label: 'Dashboard', route: '/', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'executive', module: 'Home', submodule: '—', label: 'Home', route: '/home', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'contracts.crawford', module: 'Contratos Consumo Horas', submodule: 'Crawford', label: 'Contratos / Crawford', route: '/contracts/crawford', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'contracts.docwise', module: 'Contratos Consumo Horas', submodule: 'Docwise', label: 'Contratos / Docwise', route: '/contracts/docwise', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'monitoring.overdue', module: 'Monitoramento de Cards', submodule: 'Cards com Data em Atraso', label: 'Monitoramento / Cards em Atraso', route: '/monitoring/overdue', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'monitoring.blocked', module: 'Monitoramento de Cards', submodule: 'Cards Bloqueados', label: 'Monitoramento / Cards Bloqueados', route: '/monitoring/blocked', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'gantt', module: 'Gantt', submodule: '—', label: 'Gantt', route: '/gantt', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'projects.sprint-plan', module: 'Sprint', submodule: 'Sprint Plan', label: 'Sprint / Sprint Plan', route: '/projects/sprint-plan', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'projects.sprint-review', module: 'Sprint', submodule: 'Sprint Review', label: 'Sprint / Sprint Review', route: '/projects/sprint-review', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'projects.kanban', module: 'Projetos', submodule: 'Issues - Kanban', label: 'Projetos / Issues - Kanban', route: '/projects', levels: { desenvolvedor_ba: ACCESS_LEVEL.ALLOW, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'projects.health', module: 'Projetos', submodule: 'Saúde / Detalhamento Cards Projetos', label: 'Projetos / Saúde dos Cards', route: '/projects/health', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'projects.resource-allocation', module: 'Projetos', submodule: 'Alocação de Recursos', label: 'Projetos / Alocação de Recursos', route: '/projects/resource-allocation', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'analysts.general', module: 'Analistas', submodule: 'Geral', label: 'Analistas / Geral', route: '/analysts/general', levels: { desenvolvedor_ba: ACCESS_LEVEL.PARTIAL, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW }, scope: 'self' },
  { code: 'analysts.evolution', module: 'Analistas', submodule: 'Evolução', label: 'Analistas / Evolução', route: '/analysts/evolution', levels: { desenvolvedor_ba: ACCESS_LEVEL.PARTIAL, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW }, scope: 'self' },
  { code: 'analysts.comparative', module: 'Analistas', submodule: 'Comparativo', label: 'Analistas / Comparativo', route: '/analysts/comparative', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.ALLOW, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'data', module: 'Configuração', submodule: 'Dados', label: 'Configuração / Dados', route: '/data', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.DENY, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'access.users', module: 'Gestão de Usuários', submodule: 'Usuários', label: 'Gestão de Usuários / Usuários', route: '/access', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.DENY, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'access.profiles', module: 'Gestão de Usuários', submodule: 'Grupos de Acesso', label: 'Gestão de Usuários / Grupos de Acesso', route: '/access?tab=profiles', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.DENY, diretoria: ACCESS_LEVEL.ALLOW } },
  { code: 'access.permissions', module: 'Gestão de Usuários', submodule: 'Permissões', label: 'Gestão de Usuários / Permissões', route: '/access?tab=profiles', levels: { desenvolvedor_ba: ACCESS_LEVEL.DENY, gestao: ACCESS_LEVEL.DENY, diretoria: ACCESS_LEVEL.ALLOW } },
]);

export const ACCESS_MANAGE_PERMISSION = 'access.manage';

export function normalizeAccessProfile(role) {
  const code = String(role || '').trim();
  return LEGACY_PROFILE_ALIASES[code] || code || 'desenvolvedor_ba';
}

export function profileByCode(role) {
  const code = normalizeAccessProfile(role);
  return ACCESS_PROFILES.find(profile => profile.code === code) || { code, name: code || 'Perfil', description: '' };
}

export function permissionLevelForProfile(role, permission) {
  const code = normalizeAccessProfile(role);
  if (permission === ACCESS_MANAGE_PERMISSION) return code === 'diretoria' ? ACCESS_LEVEL.ALLOW : ACCESS_LEVEL.DENY;
  return ACCESS_MODULES.find(item => item.code === permission)?.levels?.[code] || ACCESS_LEVEL.DENY;
}

export function permissionsForProfile(role, { includePartial = true } = {}) {
  const code = normalizeAccessProfile(role);
  const permissions = ACCESS_MODULES
    .filter(item => item.levels?.[code] === ACCESS_LEVEL.ALLOW || (includePartial && item.levels?.[code] === ACCESS_LEVEL.PARTIAL))
    .map(item => item.code);
  if (code === 'diretoria') permissions.push(ACCESS_MANAGE_PERMISSION);
  return [...new Set(permissions)];
}

export function canProfileManageAccess(role) {
  return normalizeAccessProfile(role) === 'diretoria';
}

export function hasPartialSelfScope(role, permission) {
  return permissionLevelForProfile(role, permission) === ACCESS_LEVEL.PARTIAL
    && ACCESS_MODULES.find(item => item.code === permission)?.scope === 'self';
}

export function accessLevelSymbol(level) {
  if (level === ACCESS_LEVEL.ALLOW) return 'S';
  if (level === ACCESS_LEVEL.PARTIAL) return 'P';
  return '—';
}
