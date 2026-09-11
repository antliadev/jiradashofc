export const RJA_HIDDEN_USER_LABELS = Object.freeze([
  'Matheus Ferreira Batista',
  'Aluizio Neto',
  'André de Oliveira Gomes',
  'Renato Francisco da Silva',
  'Petrick Amorim',
  'Tony Araujo',
  'Marcelino Sandroni Dias',
  'Giovana Lima Garcia',
  'leandro.fuzishawa',
  'Valéria Carvalho',
  'Rafael Ribeiro',
  'miguel.oliveira',
  'Daniela Christine',
  'Clayton Ferreira Lima',
  'Yago Domingues',
  'Lucas Ribeiro Penhoela',
  'Renato Mastrobiso',
]);

export function normalizeRjaUserLabel(value) {
  return String(value || '')
    .split('@')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HIDDEN_USER_KEYS = new Set(RJA_HIDDEN_USER_LABELS.map(normalizeRjaUserLabel));

export function isHiddenRjaUser(user = {}) {
  const candidates = [
    user.name,
    user.displayName,
    user.email,
    user.emailAddress,
    user.assignee_name,
    user.assigneeName,
    user.login,
    user.username,
  ];

  return candidates.some(candidate => HIDDEN_USER_KEYS.has(normalizeRjaUserLabel(candidate)));
}
