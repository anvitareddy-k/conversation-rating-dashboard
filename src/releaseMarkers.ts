import type { LoadedBatch } from "./parsing";
import { setDateInputValue } from "./parsing";

export type ReleaseMarkerSource = "builtin" | "manual";

export type ReleaseMarker = {
  id: string;
  label: string;
  batchId: string;
  source?: ReleaseMarkerSource;
  /** Calendar day this marker is locked to (YYYY-MM-DD), when known. */
  anchorDay?: string;
};

/** First calendar day counted as post-release data for a shipped prompt/model change. */
export type BuiltinReleaseDefinition = {
  id: string;
  label: string;
  /** YYYY-MM-DD — hard-coded release day; marker locks to this date. */
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

function batchDayKey(batch: LoadedBatch): string | null {
  if (!batch.periodDate) return null;
  return setDateInputValue(batch.periodDate);
}

function batchDayTime(batch: LoadedBatch): number | null {
  if (!batch.periodDate) return null;
  const d = batch.periodDate;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatReleaseDayLabel(isoDate: string): string {
  const d = startOfLocalDay(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Marker is usable only when its batch exists and has a calendar date. */
export function isResolvableReleaseMarker(
  marker: ReleaseMarker,
  sortedBatches: LoadedBatch[]
): boolean {
  const batch = sortedBatches.find((b) => b.id === marker.batchId);
  return batch != null && batch.periodDate != null;
}

export function pruneInvalidManualReleaseMarkers(sortedBatches: LoadedBatch[]): void {
  const manual = loadManualReleaseMarkers();
  const valid = manual.filter((m) => isResolvableReleaseMarker(m, sortedBatches));
  if (valid.length !== manual.length) saveManualReleaseMarkers(valid);
}

export function findBatchOnExactDay(
  sortedBatches: LoadedBatch[],
  isoDate: string
): LoadedBatch | null {
  const target = startOfLocalDay(isoDate).getTime();
  for (const batch of sortedBatches) {
    const day = batchDayTime(batch);
    if (day != null && day === target) return batch;
  }
  return null;
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

/**
 * Resolve the calendar day a builtin release should attach to.
 * Only the hard-coded day itself, or the next calendar day if that file is missing
 * (e.g. Jun 10 → Jun 11). Never jumps to a later month.
 */
export function resolveBuiltinAnchorDay(
  allBatchesSorted: LoadedBatch[],
  isoDate: string
): string | null {
  const exact = findBatchOnExactDay(allBatchesSorted, isoDate);
  if (exact) return batchDayKey(exact);

  const release = startOfLocalDay(isoDate);
  const nextDay = new Date(release);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextKey = setDateInputValue(nextDay);
  const next = findBatchOnExactDay(allBatchesSorted, nextKey);
  return next ? nextKey : null;
}

function findBatchByDayKey(
  sortedBatches: LoadedBatch[],
  dayKey: string
): LoadedBatch | null {
  for (const batch of sortedBatches) {
    if (batchDayKey(batch) === dayKey) return batch;
  }
  return null;
}

function visibleRangeMs(sortedBatches: LoadedBatch[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const batch of sortedBatches) {
    const t = batchDayTime(batch);
    if (t == null) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

export function buildBuiltinReleaseMarkers(
  sortedBatches: LoadedBatch[],
  hiddenBuiltinIds: string[] = [],
  /** Full loaded series used to lock builtins to their hard-coded calendar day. */
  allBatchesSorted: LoadedBatch[] = sortedBatches
): ReleaseMarker[] {
  const hidden = new Set(hiddenBuiltinIds);
  const resolveFrom =
    allBatchesSorted.length > 0 ? allBatchesSorted : sortedBatches;
  const visible = visibleRangeMs(sortedBatches);

  return BUILTIN_RELEASE_DEFINITIONS.flatMap((def) => {
    if (hidden.has(def.id)) return [];

    const releaseTime = startOfLocalDay(def.firstPostReleaseDay).getTime();
    const anchorDay = resolveBuiltinAnchorDay(resolveFrom, def.firstPostReleaseDay);
    if (!anchorDay) return [];

    const anchorTime = startOfLocalDay(anchorDay).getTime();

    // Hide when the current view does not include the release / its anchor day
    // (e.g. July-only range must not show a June 10 release).
    if (visible) {
      const releaseInView = releaseTime >= visible.min && releaseTime <= visible.max;
      const anchorInView = anchorTime >= visible.min && anchorTime <= visible.max;
      if (!releaseInView && !anchorInView) return [];
    }

    const batch = findBatchByDayKey(sortedBatches, anchorDay);
    if (!batch) return [];

    return [
      {
        id: `builtin-${def.id}`,
        label: `${def.label} (${formatReleaseDayLabel(def.firstPostReleaseDay)})`,
        batchId: batch.id,
        source: "builtin" as const,
        anchorDay: def.firstPostReleaseDay,
      },
    ];
  });
}

export function resolveReleaseMarkers(
  sortedBatches: LoadedBatch[],
  manualMarkers: ReleaseMarker[],
  hiddenBuiltinIds: string[] = [],
  allBatchesSorted: LoadedBatch[] = sortedBatches
): ReleaseMarker[] {
  const manual = manualMarkers
    .map((m) => ({ ...m, source: "manual" as const }))
    .filter((m) => isResolvableReleaseMarker(m, sortedBatches));
  const manualBatchIds = new Set(manual.map((m) => m.batchId));
  const builtin = buildBuiltinReleaseMarkers(
    sortedBatches,
    hiddenBuiltinIds,
    allBatchesSorted
  ).filter((m) => !manualBatchIds.has(m.batchId));
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
