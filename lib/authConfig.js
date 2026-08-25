const DEFAULT_ALLOWED_DOMAIN = 'antlia.com.br';

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function envList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

export const authConfig = {
  provider: (process.env.AUTH_PROVIDER || 'supabase').trim().toLowerCase(),
  allowedDomain: (process.env.AUTH_ALLOWED_DOMAIN || DEFAULT_ALLOWED_DOMAIN).trim().toLowerCase().replace(/^@/, ''),
  adminExceptionEmails: envList('AUTH_ADMIN_EXCEPTION_EMAILS'),
  requireEmailConfirmation: envFlag('AUTH_REQUIRE_EMAIL_CONFIRMATION', true),
  requireApiAuth: envFlag('AUTH_REQUIRE_API_AUTH', true),
};

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return false;
  if (authConfig.adminExceptionEmails.includes(normalized)) return true;
  return normalized.endsWith(`@${authConfig.allowedDomain}`);
}

export function assertAllowedEmail(email) {
  if (isAllowedEmail(email)) return normalizeEmail(email);
  const error = new Error(`Acesso permitido apenas para emails @${authConfig.allowedDomain}.`);
  error.status = 403;
  error.code = 'AUTH_DOMAIN_NOT_ALLOWED';
  throw error;
}
