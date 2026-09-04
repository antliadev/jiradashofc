export function loginMethodsForBranch(branch) {
  const password = String(branch || '').trim() === 'develop';
  return { password, google: !password };
}

export function currentLoginMethods() {
  const branch = import.meta.env?.RJA_GIT_BRANCH || '';
  return loginMethodsForBranch(branch);
}
