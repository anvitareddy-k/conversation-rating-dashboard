export type ReleaseMarker = {
  id: string;
  label: string;
  batchId: string;
};

const STORAGE_KEY = "conversation-rating-release-markers";

export function loadReleaseMarkers(): ReleaseMarker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ReleaseMarker =>
        m != null &&
        typeof m === "object" &&
        typeof (m as ReleaseMarker).id === "string" &&
        typeof (m as ReleaseMarker).label === "string" &&
        typeof (m as ReleaseMarker).batchId === "string"
    );
  } catch {
    return [];
  }
}

export function saveReleaseMarkers(markers: ReleaseMarker[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch {
    /* ignore quota errors */
  }
}

export function createReleaseMarker(label: string, batchId: string): ReleaseMarker {
  return {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim(),
    batchId,
  };
}

export function markerBatchIndex(marker: ReleaseMarker, batchIds: string[]): number {
  return batchIds.indexOf(marker.batchId);
}
