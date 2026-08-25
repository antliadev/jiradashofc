const STORAGE_KEY = 'jira-dashboard-theme';

export function getTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

export function setTheme(theme, { persist = true } = {}) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  if (persist) localStorage.setItem(STORAGE_KEY, resolved);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: resolved } }));
  return resolved;
}

export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
