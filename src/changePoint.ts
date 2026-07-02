const STORAGE_KEY = "conversation-rating-change-point";

export function loadChangePointBatchId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const id = JSON.parse(raw) as unknown;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}

export function saveChangePointBatchId(batchId: string | null): void {
  try {
    if (!batchId) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(batchId));
  } catch {
    /* ignore */
  }
}

/** Default split index: first valid interior day (needs before + after). */
export function defaultChangePointBatchId(
  sortedBatchIds: string[],
  releaseMarkerBatchIds: string[] = []
): string | null {
  if (sortedBatchIds.length < 2) return null;
  for (const batchId of releaseMarkerBatchIds) {
    const idx = sortedBatchIds.indexOf(batchId);
    if (idx > 0 && idx < sortedBatchIds.length) return batchId;
  }
  const mid = Math.floor(sortedBatchIds.length / 2);
  return sortedBatchIds[mid] ?? null;
}

export function resolveChangePointBatchId(
  sortedBatchIds: string[],
  saved: string | null,
  releaseMarkerBatchIds: string[] = []
): string | null {
  if (saved && sortedBatchIds.includes(saved)) {
    const idx = sortedBatchIds.indexOf(saved);
    if (idx > 0 && idx < sortedBatchIds.length) return saved;
  }
  return defaultChangePointBatchId(sortedBatchIds, releaseMarkerBatchIds);
}
