export function passwordLoginAllowed(env = process.env) {
  if (env.NODE_ENV !== 'production' && env.VERCEL !== '1' && env.VERCEL !== 'true') return true;
  return String(env.VERCEL_GIT_COMMIT_REF || env.RJA_DEPLOY_BRANCH || '').trim() === 'develop';
}
