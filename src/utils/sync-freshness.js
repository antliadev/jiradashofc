export const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const AUTO_SYNC_STALE_GRACE_MS = 75 * 60 * 1000;

export function parseSyncDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getSyncFreshness(lastSyncValue, nowValue = new Date()) {
  const lastSyncDate = parseSyncDate(lastSyncValue);
  const nowDate = parseSyncDate(nowValue);

  if (!lastSyncDate || !nowDate) {
    return {
      lastSyncDate,
      ageMs: null,
      isStale: false
    };
  }

  const ageMs = nowDate.getTime() - lastSyncDate.getTime();

  return {
    lastSyncDate,
    ageMs,
    isStale: ageMs > AUTO_SYNC_STALE_GRACE_MS
  };
}
