import type { LoadedBatch } from "./parsing";

export type ReleaseMarkerSource = "builtin" | "manual";

export type ReleaseMarker = {
  id: string;
  label: string;
  batchId: string;
  source?: ReleaseMarkerSource;
};

/** First calendar day counted as post-release data for a shipped prompt/model change. */
export type BuiltinReleaseDefinition = {
  id: string;
  label: string;
  /** YYYY-MM-DD — matches the first uploaded day on or after this date. */
  firstPostReleaseDay: string;
};

/** Edit this list when new production releases ship. */
export const BUILTIN_RELEASE_DEFINITIONS: BuiltinReleaseDefinition[] = [
  {
    id: "jun-10-slotfill-fix",
    label: "Slotfill Fix",
    firstPostReleaseDay: "2026-06-10",
  },
];

const MANUAL_STORAGE_KEY = "conversation-rating-release-markers";
const HIDDEN_BUILTIN_STORAGE_KEY = "conversation-rating-hidden-builtin-releases";

function startOfLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function batchDayTime(batch: LoadedBatch): number | null {
  if (!batch.periodDate) return null;
  const d = batch.periodDate;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function findFirstBatchOnOrAfter(
  sortedBatches: LoadedBatch[],
  isoDate: string
): LoadedBatch | null {
  const target = startOfLocalDay(isoDate).getTime();
  for (const batch of sortedBatches) {
    const day = batchDayTime(batch);
    if (day != null && day >= target) return batch;
  }
  return null;
}

export function buildBuiltinReleaseMarkers(
  sortedBatches: LoadedBatch[],
  hiddenBuiltinIds: string[] = []
): ReleaseMarker[] {
  const hidden = new Set(hiddenBuiltinIds);
  return BUILTIN_RELEASE_DEFINITIONS.flatMap((def) => {
    if (hidden.has(def.id)) return [];
    const batch = findFirstBatchOnOrAfter(sortedBatches, def.firstPostReleaseDay);
    if (!batch) return [];
    return [
      {
        id: `builtin-${def.id}`,
        label: def.label,
        batchId: batch.id,
        source: "builtin" as const,
      },
    ];
  });
}

export function resolveReleaseMarkers(
  sortedBatches: LoadedBatch[],
  manualMarkers: ReleaseMarker[],
  hiddenBuiltinIds: string[] = []
): ReleaseMarker[] {
  const manual = manualMarkers.map((m) => ({ ...m, source: "manual" as const }));
  const manualBatchIds = new Set(manual.map((m) => m.batchId));
  const builtin = buildBuiltinReleaseMarkers(sortedBatches, hiddenBuiltinIds).filter(
    (m) => !manualBatchIds.has(m.batchId)
  );
  return [...builtin, ...manual].sort(
    (a, b) =>
      sortedBatches.findIndex((batch) => batch.id === a.batchId) -
      sortedBatches.findIndex((batch) => batch.id === b.batchId)
  );
}

export function loadManualReleaseMarkers(): ReleaseMarker[] {
  try {
    const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ReleaseMarker =>
          m != null &&
          typeof m === "object" &&
          typeof (m as ReleaseMarker).id === "string" &&
          typeof (m as ReleaseMarker).label === "string" &&
          typeof (m as ReleaseMarker).batchId === "string"
      )
      .map((m) => ({ ...m, source: "manual" as const }));
  } catch {
    return [];
  }
}

/** @deprecated Use loadManualReleaseMarkers */
export function loadReleaseMarkers(): ReleaseMarker[] {
  return loadManualReleaseMarkers();
}

export function saveManualReleaseMarkers(markers: ReleaseMarker[]): void {
  try {
    const manualOnly = markers
      .filter((m) => m.source !== "builtin")
      .map(({ id, label, batchId }) => ({ id, label, batchId }));
    localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(manualOnly));
  } catch {
    /* ignore quota errors */
  }
}

/** @deprecated Use saveManualReleaseMarkers */
export function saveReleaseMarkers(markers: ReleaseMarker[]): void {
  saveManualReleaseMarkers(markers);
}

export function loadHiddenBuiltinReleaseIds(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_BUILTIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveHiddenBuiltinReleaseIds(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_BUILTIN_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota errors */
  }
}

export function createReleaseMarker(label: string, batchId: string): ReleaseMarker {
  return {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim(),
    batchId,
    source: "manual",
  };
}

export function markerBatchIndex(marker: ReleaseMarker, batchIds: string[]): number {
  return batchIds.indexOf(marker.batchId);
}

export function builtinReleaseIdFromMarkerId(markerId: string): string | null {
  return markerId.startsWith("builtin-") ? markerId.slice("builtin-".length) : null;
}
