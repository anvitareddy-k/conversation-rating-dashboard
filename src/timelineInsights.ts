import type { LoadedBatch, PickableTagKind, RatingRow, TagKind } from "./parsing";
import { isLowRated } from "./parsing";
import {
  computeTagTimeline,
  computeTimelineReleaseOverlays,
  topTagsAcrossBatches,
  type TimelinePoint,
  type TimelineReleaseOverlay,
} from "./analytics";

const SIGNIFICANT_PP = 0.5;
const INFER_DISCOVERY_MIN_PP = 3;
const MAX_SHIFTS = 12;
const MAX_INFERRED = 4;

export type InferredDiscoveryLink = {
  discoveryTag: string;
  beforePct: number;
  afterPct: number;
  deltaPct: number;
};

/** Significant move for a tag within a timeline window, with inferred discovery context. */
export type TimelineTagShift = {
  tag: string;
  kind: TagKind;
  beforePct: number;
  afterPct: number;
  deltaPct: number;
  direction: "up" | "down" | "flat";
  significant: boolean;
  inferredDiscoveryTags: InferredDiscoveryLink[];
};

/** Day-over-day jump on the selected tag's plotted timeline. */
export type TimelinePeriodChange = {
  fromBatchId: string;
  toBatchId: string;
  fromLabel: string;
  toLabel: string;
  fromPct: number;
  toPct: number;
  deltaPct: number;
  direction: "up" | "down";
  significant: boolean;
  inferredDiscoveryTags: InferredDiscoveryLink[];
};

export type TimelineInsightWindow = {
  id: string;
  label: string;
  scope: "release" | "change_point" | "day_over_day";
  splitBatchId?: string;
  beforeLabel?: string;
  afterLabel?: string;
  increases: TimelineTagShift[];
  decreases: TimelineTagShift[];
  periodChanges: TimelinePeriodChange[];
};

/** Aggregated timeline insights — significant shifts + inferred discovery tags. */
export type TimelineInsights = {
  windows: TimelineInsightWindow[];
  selectedTagShifts: TimelineTagShift[];
};

function poolRows(batches: LoadedBatch[], lowScoreOnly: boolean): RatingRow[] {
  const rows = batches.flatMap((b) => b.rows);
  return lowScoreOnly ? rows.filter(isLowRated) : rows;
}

function batchesBeforeIndex(sorted: LoadedBatch[], idx: number): LoadedBatch[] {
  return sorted.slice(0, idx);
}

function batchesFromIndex(sorted: LoadedBatch[], idx: number): LoadedBatch[] {
  return sorted.slice(idx);
}

function directionFromDelta(delta: number): "up" | "down" | "flat" {
  if (Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "up" : "down";
}

function avgPct(points: TimelinePoint[]): number | null {
  if (!points.length) return null;
  return points.reduce((s, p) => s + p.pct, 0) / points.length;
}

function rowsForTagInBatches(
  batches: LoadedBatch[],
  tag: string,
  kind: TagKind,
  lowScoreOnly: boolean
): RatingRow[] {
  return poolRows(batches, lowScoreOnly).filter((r) => {
    if (kind === "qa") return r.qaTags.includes(tag);
    if (kind === "category") return r.categoryTags.includes(tag);
    if (kind === "discovery") return r.discoveryTags.includes(tag);
    return false;
  });
}

/** Discovery categories whose share among tag sessions shifted most between windows. */
export function inferDiscoveryTags(
  beforeBatches: LoadedBatch[],
  afterBatches: LoadedBatch[],
  focusTag: string,
  focusKind: TagKind,
  lowScoreOnly: boolean
): InferredDiscoveryLink[] {
  if (focusKind !== "qa") return [];

  const beforeRows = rowsForTagInBatches(beforeBatches, focusTag, "qa", lowScoreOnly);
  const afterRows = rowsForTagInBatches(afterBatches, focusTag, "qa", lowScoreOnly);
  if (!beforeRows.length && !afterRows.length) return [];

  const discoveryUniverse = new Set<string>();
  for (const r of [...beforeRows, ...afterRows]) {
    for (const d of r.discoveryTags) discoveryUniverse.add(d);
  }

  const links: InferredDiscoveryLink[] = [];
  for (const discoveryTag of discoveryUniverse) {
    const beforePct = beforeRows.length
      ? (100 * beforeRows.filter((r) => r.discoveryTags.includes(discoveryTag)).length) /
        beforeRows.length
      : 0;
    const afterPct = afterRows.length
      ? (100 * afterRows.filter((r) => r.discoveryTags.includes(discoveryTag)).length) /
        afterRows.length
      : 0;
    const deltaPct = afterPct - beforePct;
    if (Math.abs(deltaPct) < INFER_DISCOVERY_MIN_PP) continue;
    links.push({ discoveryTag, beforePct, afterPct, deltaPct });
  }

  links.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return links.slice(0, MAX_INFERRED);
}

function buildTagShift(
  tag: string,
  kind: TagKind,
  beforeBatches: LoadedBatch[],
  afterBatches: LoadedBatch[],
  lowScoreOnly: boolean
): TimelineTagShift | null {
  const beforePoints = computeTagTimeline(beforeBatches, tag, kind, lowScoreOnly);
  const afterPoints = computeTagTimeline(afterBatches, tag, kind, lowScoreOnly);
  const beforeAvg = avgPct(beforePoints);
  const afterAvg = avgPct(afterPoints);
  if (beforeAvg == null || afterAvg == null) return null;

  const deltaPct = afterAvg - beforeAvg;
  return {
    tag,
    kind,
    beforePct: beforeAvg,
    afterPct: afterAvg,
    deltaPct,
    direction: directionFromDelta(deltaPct),
    significant: Math.abs(deltaPct) >= SIGNIFICANT_PP,
    inferredDiscoveryTags: inferDiscoveryTags(
      beforeBatches,
      afterBatches,
      tag,
      kind,
      lowScoreOnly
    ),
  };
}

function significantShiftsFromBatches(
  beforeBatches: LoadedBatch[],
  afterBatches: LoadedBatch[],
  lowScoreOnly: boolean
): { increases: TimelineTagShift[]; decreases: TimelineTagShift[] } {
  const qaStats = topTagsAcrossBatches(
    [...beforeBatches, ...afterBatches],
    (r) => r.qaTags,
    lowScoreOnly
  );
  const discStats = topTagsAcrossBatches(
    [...beforeBatches, ...afterBatches],
    (r) => r.categoryTags,
    lowScoreOnly
  );

  const shifts: TimelineTagShift[] = [];
  for (const { tag } of qaStats) {
    const s = buildTagShift(tag, "qa", beforeBatches, afterBatches, lowScoreOnly);
    if (s?.significant) shifts.push(s);
  }
  for (const { tag } of discStats) {
    const s = buildTagShift(tag, "category", beforeBatches, afterBatches, lowScoreOnly);
    if (s?.significant) shifts.push(s);
  }

  shifts.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const increases = shifts.filter((s) => s.direction === "up").slice(0, MAX_SHIFTS);
  const decreases = shifts.filter((s) => s.direction === "down").slice(0, MAX_SHIFTS);
  return { increases, decreases };
}

function computePeriodChanges(
  timeline: TimelinePoint[],
  sortedBatches: LoadedBatch[],
  selectedTag: string,
  tagKind: TagKind,
  lowScoreOnly: boolean
): TimelinePeriodChange[] {
  if (timeline.length < 2 || tagKind !== "qa") return [];

  const batchById = new Map(sortedBatches.map((b) => [b.id, b]));
  const changes: TimelinePeriodChange[] = [];

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    const deltaPct = curr.pct - prev.pct;
    if (Math.abs(deltaPct) < SIGNIFICANT_PP) continue;

    const prevBatch = batchById.get(prev.batchId);
    const currBatch = batchById.get(curr.batchId);
    if (!prevBatch || !currBatch) continue;

    changes.push({
      fromBatchId: prev.batchId,
      toBatchId: curr.batchId,
      fromLabel: prev.label,
      toLabel: curr.label,
      fromPct: prev.pct,
      toPct: curr.pct,
      deltaPct,
      direction: deltaPct > 0 ? "up" : "down",
      significant: true,
      inferredDiscoveryTags: inferDiscoveryTags(
        [prevBatch],
        [currBatch],
        selectedTag,
        "qa",
        lowScoreOnly
      ),
    });
  }

  changes.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return changes.slice(0, MAX_SHIFTS);
}

function windowFromSplit(
  id: string,
  label: string,
  scope: TimelineInsightWindow["scope"],
  idx: number,
  sortedBatches: LoadedBatch[],
  lowScoreOnly: boolean,
  splitBatchId?: string
): TimelineInsightWindow | null {
  if (idx <= 0 || idx >= sortedBatches.length) return null;
  const before = batchesBeforeIndex(sortedBatches, idx);
  const after = batchesFromIndex(sortedBatches, idx);
  const { increases, decreases } = significantShiftsFromBatches(before, after, lowScoreOnly);
  if (!increases.length && !decreases.length) return null;
  const beforeLabel = before.map((b) => b.label).join(", ");
  const afterLabel = after.map((b) => b.label).join(", ");
  return {
    id,
    label,
    scope,
    splitBatchId,
    beforeLabel,
    afterLabel,
    increases,
    decreases,
    periodChanges: [],
  };
}

function windowFromRelease(
  overlay: TimelineReleaseOverlay,
  sortedBatches: LoadedBatch[],
  lowScoreOnly: boolean
): TimelineInsightWindow | null {
  return windowFromSplit(
    overlay.markerId,
    `After ${overlay.markerLabel}`,
    "release",
    overlay.index,
    sortedBatches,
    lowScoreOnly,
    overlay.batchId
  );
}

export function computeTimelineInsights(
  sortedBatches: LoadedBatch[],
  timeline: TimelinePoint[],
  selectedTag: string | null,
  tagKind: TagKind,
  lowScoreOnly: boolean,
  releaseMarkers: { id: string; label: string; batchId: string }[],
  changePointBatchId: string | null = null
): TimelineInsights {
  const windows: TimelineInsightWindow[] = [];
  const batchIndex = new Map(sortedBatches.map((b, i) => [b.id, i]));

  if (changePointBatchId && releaseMarkers.length === 0) {
    const idx = batchIndex.get(changePointBatchId);
    if (idx != null) {
      const period = sortedBatches[idx];
      const w = windowFromSplit(
        "change-point",
        `From ${period?.label ?? changePointBatchId} onward`,
        "change_point",
        idx,
        sortedBatches,
        lowScoreOnly,
        changePointBatchId
      );
      if (w) windows.push(w);
    }
  }

  for (const marker of releaseMarkers) {
    if (marker.batchId === changePointBatchId) continue;
    const idx = batchIndex.get(marker.batchId);
    if (idx == null) continue;
    const overlay = computeTimelineReleaseOverlays(
      timeline.length
        ? timeline
        : sortedBatches.map((b) => ({
            batchId: b.id,
            label: b.label,
            count: 0,
            poolSize: 0,
            pct: 0,
            avgScore: null,
          })),
      [marker]
    )[0];
    if (overlay) {
      const w = windowFromRelease(overlay, sortedBatches, lowScoreOnly);
      if (w) windows.push(w);
    }
  }

  const periodChanges =
    selectedTag && tagKind === "qa"
      ? computePeriodChanges(timeline, sortedBatches, selectedTag, tagKind, lowScoreOnly)
      : [];

  if (periodChanges.length) {
    windows.push({
      id: "day-over-day",
      label: selectedTag ? `${selectedTag} · day-over-day` : "Day-over-day",
      scope: "day_over_day",
      increases: [],
      decreases: [],
      periodChanges,
    });
  }

  let selectedTagShifts: TimelineTagShift[] = [];
  if (selectedTag && sortedBatches.length >= 2) {
    if (changePointBatchId && releaseMarkers.length === 0) {
      const idx = batchIndex.get(changePointBatchId);
      if (idx != null) {
        const shift = buildTagShift(
          selectedTag,
          tagKind,
          batchesBeforeIndex(sortedBatches, idx),
          batchesFromIndex(sortedBatches, idx),
          lowScoreOnly
        );
        if (shift) selectedTagShifts = [shift];
      }
    }

    for (const marker of releaseMarkers) {
      const idx = batchIndex.get(marker.batchId);
      if (idx == null) continue;
      const releaseShift = buildTagShift(
        selectedTag,
        tagKind,
        batchesBeforeIndex(sortedBatches, idx),
        batchesFromIndex(sortedBatches, idx),
        lowScoreOnly
      );
      if (releaseShift?.significant) selectedTagShifts.push(releaseShift);
    }
  }

  return { windows, selectedTagShifts };
}

/** Primary window for charting (user change point first). */
export function primaryInsightWindow(
  insights: TimelineInsights
): TimelineInsightWindow | null {
  const changePoint = insights.windows.find((w) => w.scope === "change_point");
  if (changePoint) return changePoint;
  const ranked = insights.windows.filter((w) => w.scope !== "day_over_day");
  if (ranked.length) return ranked[0];
  const dayOd = insights.windows.find((w) => w.scope === "day_over_day");
  return dayOd ?? null;
}

export type ShiftChartRow = {
  id: string;
  tag: string;
  kind: "qa" | "discovery";
  deltaPct: number;
  beforePct: number;
  afterPct: number;
  direction: "up" | "down";
  inferredDiscoveryTags: InferredDiscoveryLink[];
};

export function shiftsForChart(window: TimelineInsightWindow, max = 10): ShiftChartRow[] {
  const rows: ShiftChartRow[] = [
    ...window.increases.map((s) => ({
      id: `up-${s.kind}-${s.tag}`,
      tag: s.tag,
      kind: s.kind as "qa" | "discovery",
      deltaPct: s.deltaPct,
      beforePct: s.beforePct,
      afterPct: s.afterPct,
      direction: "up" as const,
      inferredDiscoveryTags: s.inferredDiscoveryTags,
    })),
    ...window.decreases.map((s) => ({
      id: `dn-${s.kind}-${s.tag}`,
      tag: s.tag,
      kind: s.kind as "qa" | "discovery",
      deltaPct: s.deltaPct,
      beforePct: s.beforePct,
      afterPct: s.afterPct,
      direction: "down" as const,
      inferredDiscoveryTags: s.inferredDiscoveryTags,
    })),
    ...window.periodChanges.map((c) => ({
      id: `pd-${c.fromBatchId}-${c.toBatchId}`,
      tag: `${c.fromLabel} → ${c.toLabel}`,
      kind: "qa" as const,
      deltaPct: c.deltaPct,
      beforePct: c.fromPct,
      afterPct: c.toPct,
      direction: c.direction,
      inferredDiscoveryTags: c.inferredDiscoveryTags,
    })),
  ];
  rows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return rows.slice(0, max);
}

export function shiftsForChartByKind(
  window: TimelineInsightWindow,
  kind: PickableTagKind,
  max = 10
): ShiftChartRow[] {
  return shiftsForChart(window, max * 2)
    .filter((r) => r.kind === kind && !r.tag.includes("→"))
    .slice(0, max);
}
