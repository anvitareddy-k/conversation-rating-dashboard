import type { LoadedBatch, PickableTagKind, RatingRow, TagKind, TagStatRow, FunnelOrder } from "./parsing";
import { computeTagStats, filterRowsByTags, isLowRated, pickTagsByKind, type TagFilterState } from "./parsing";
import { kindLabel } from "./labels";

export type TimelinePoint = {
  batchId: string;
  label: string;
  count: number;
  poolSize: number;
  pct: number;
  avgScore: number | null;
};

export type DailyLowRatedPoint = {
  batchId: string;
  label: string;
  lowRatedCount: number;
  totalCount: number;
  lowRatedPct: number;
};

export type ScoreBucketId = "6plus" | "5" | "4" | "3" | "2" | "1" | "unknown";

export type LowScoreBandId = "1-2" | "2-3" | "3-4" | "4-5";

export const LOW_SCORE_BAND_ORDER: LowScoreBandId[] = ["1-2", "2-3", "3-4", "4-5"];

export const LOW_SCORE_BAND_LABELS: Record<LowScoreBandId, string> = {
  "1-2": "1–2",
  "2-3": "2–3",
  "3-4": "3–4",
  "4-5": "4–5",
};

export type DailyScoreStackPoint = {
  batchId: string;
  label: string;
  totalCount: number;
  buckets: Record<ScoreBucketId, number>;
};

function scoreBucket(score: number): ScoreBucketId {
  if (!Number.isFinite(score)) return "unknown";
  if (score > 5) return "6plus";
  if (score > 4) return "5";
  if (score > 3) return "4";
  if (score > 2) return "3";
  if (score > 1) return "2";
  return "1";
}

const EMPTY_BUCKETS = (): Record<ScoreBucketId, number> => ({
  "6plus": 0,
  "5": 0,
  "4": 0,
  "3": 0,
  "2": 0,
  "1": 0,
  unknown: 0,
});

/** Per-day stacked score counts (6+ at base, 1–5 stacked above, ≤5 on top). */
export function computeDailyScoreStacks(batches: LoadedBatch[]): DailyScoreStackPoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  return sorted.map((batch) => {
    const buckets = EMPTY_BUCKETS();
    for (const row of batch.rows) {
      buckets[scoreBucket(row.overall_score)]++;
    }
    return {
      batchId: batch.id,
      label: batch.label,
      totalCount: batch.rows.length,
      buckets,
    };
  });
}

/** Map a ≤5 overall score into half-open bands [1,2), [2,3), [3,4), [4,5]. */
export function lowScoreBand(score: number): LowScoreBandId | null {
  if (!Number.isFinite(score) || score > 5) return null;
  if (score < 2) return "1-2";
  if (score < 3) return "2-3";
  if (score < 4) return "3-4";
  return "4-5";
}

export function computeLowScoreBandBreakdown(
  batch: LoadedBatch
): Record<LowScoreBandId, number> {
  const counts: Record<LowScoreBandId, number> = {
    "1-2": 0,
    "2-3": 0,
    "3-4": 0,
    "4-5": 0,
  };
  for (const row of batch.rows) {
    const band = lowScoreBand(row.overall_score);
    if (band) counts[band]++;
  }
  return counts;
}

/** Day-wise count of sessions rated ≤ 5 per uploaded period. */
export function computeDailyLowRatedSeries(batches: LoadedBatch[]): DailyLowRatedPoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  return sorted.map((batch) => {
    const totalCount = batch.rows.length;
    const lowRatedCount = batch.rows.filter(isLowRated).length;
    return {
      batchId: batch.id,
      label: batch.label,
      lowRatedCount,
      totalCount,
      lowRatedPct: totalCount ? (100 * lowRatedCount) / totalCount : 0,
    };
  });
}

export type DailyAvgTurnsPoint = {
  batchId: string;
  label: string;
  avgTurns: number | null;
  sessionCount: number;
  withTurnsCount: number;
};

/** Day-wise average conversation length (turns / message_count). */
export function computeDailyAvgTurnsSeries(batches: LoadedBatch[]): DailyAvgTurnsPoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  return sorted.map((batch) => {
    const turns = batch.rows
      .map((r) => r.num_turns)
      .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
    const withTurnsCount = turns.length;
    const avgTurns = withTurnsCount
      ? turns.reduce((a, b) => a + b, 0) / withTurnsCount
      : null;
    return {
      batchId: batch.id,
      label: batch.label,
      avgTurns,
      sessionCount: batch.rows.length,
      withTurnsCount,
    };
  });
}

export type FunnelStep = {
  label: string;
  kind: "pool" | "qa" | "category" | "score";
  count: number;
  pctOfStart: number;
  dropFromPrev: number | null;
  dropPctFromPrev: number | null;
  stepIndex: number;
};

export type TagTrend = {
  tag: string;
  kind: TagKind;
  latestPct: number;
  deltaPct: number | null;
  direction: "up" | "down" | "flat" | "new";
};

export type TimelineReleaseOverlay = {
  markerId: string;
  markerLabel: string;
  batchId: string;
  periodLabel: string;
  index: number;
  beforePeriods: number;
  afterPeriods: number;
  beforeAvg: number;
  afterAvg: number;
  deltaPct: number;
  direction: "up" | "down" | "flat";
};

function avgPct(points: TimelinePoint[]): number | null {
  if (!points.length) return null;
  return points.reduce((s, p) => s + p.pct, 0) / points.length;
}

function directionFromDelta(delta: number): "up" | "down" | "flat" {
  if (Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Avg % before vs after each release marker, using the plotted timeline points. */
export function computeTimelineReleaseOverlays(
  timeline: TimelinePoint[],
  markers: { id: string; label: string; batchId: string }[]
): TimelineReleaseOverlay[] {
  return markers
    .map((marker) => {
      const idx = timeline.findIndex((p) => p.batchId === marker.batchId);
      if (idx <= 0 || idx >= timeline.length) return null;

      const beforePoints = timeline.slice(0, idx);
      const afterPoints = timeline.slice(idx);
      const beforeAvg = avgPct(beforePoints);
      const afterAvg = avgPct(afterPoints);
      if (beforeAvg == null || afterAvg == null) return null;

      const deltaPct = afterAvg - beforeAvg;
      return {
        markerId: marker.id,
        markerLabel: marker.label,
        batchId: marker.batchId,
        periodLabel: timeline[idx].label,
        index: idx,
        beforePeriods: beforePoints.length,
        afterPeriods: afterPoints.length,
        beforeAvg,
        afterAvg,
        deltaPct,
        direction: directionFromDelta(deltaPct),
      };
    })
    .filter((o): o is TimelineReleaseOverlay => o != null);
}

function poolFromBatch(batch: LoadedBatch, lowScoreOnly: boolean): RatingRow[] {
  if (!lowScoreOnly) return batch.rows;
  return batch.rows.filter(isLowRated);
}

function rowHasTag(row: RatingRow, tag: string, kind: TagKind): boolean {
  if (kind === "qa") return row.qaTags.includes(tag);
  if (kind === "category") return row.categoryTags.includes(tag);
  if (kind === "discovery") return row.discoveryTags.includes(tag);
  return row.structuralTags.includes(tag);
}

export function computeTagTimeline(
  batches: LoadedBatch[],
  tag: string,
  kind: TagKind,
  lowScoreOnly = true
): TimelinePoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );

  return sorted.map((batch) => {
    const pool = poolFromBatch(batch, lowScoreOnly);
    const matching = pool.filter((r) => rowHasTag(r, tag, kind));
    const scores = matching.map((r) => r.overall_score).filter(Number.isFinite);
    const avgScore = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;
    const poolSize = pool.length || 1;
    return {
      batchId: batch.id,
      label: batch.label,
      count: matching.length,
      poolSize: pool.length,
      pct: (100 * matching.length) / poolSize,
      avgScore,
    };
  });
}

export function computeMultiTagTimeline(
  batches: LoadedBatch[],
  tags: { tag: string; kind: TagKind }[],
  lowScoreOnly = true
): { labels: string[]; datasets: { tag: string; kind: TagKind; data: number[] }[] } {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  const labels = sorted.map((b) => b.label);
  const datasets = tags.map(({ tag, kind }) => ({
    tag,
    kind,
    data: computeTagTimeline(sorted, tag, kind, lowScoreOnly).map((p) => p.pct),
  }));
  return { labels, datasets };
}

export function computeTagTrends(
  batches: LoadedBatch[],
  tagStats: TagStatRow[],
  kind: TagKind,
  lowScoreOnly = true
): TagTrend[] {
  if (batches.length < 2) return [];

  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  const prev = sorted[sorted.length - 2];
  const latest = sorted[sorted.length - 1];

  return tagStats.slice(0, 40).map(({ tag }) => {
    const prevPoint = computeTagTimeline([prev], tag, kind, lowScoreOnly)[0];
    const latestPoint = computeTagTimeline([latest], tag, kind, lowScoreOnly)[0];
    const delta = latestPoint.pct - prevPoint.pct;
    let direction: TagTrend["direction"] = "flat";
    if (Math.abs(delta) < 0.05) direction = "flat";
    else if (delta > 0) direction = "up";
    else direction = "down";
    if (prevPoint.count === 0 && latestPoint.count > 0) direction = "new";
    return {
      tag,
      kind,
      latestPct: latestPoint.pct,
      deltaPct: prevPoint.poolSize > 0 ? delta : null,
      direction,
    };
  });
}

export function computeFunnelSteps(
  pool: RatingRow[],
  filter: TagFilterState
): FunnelStep[] {
  const start = pool.length || 1;
  let stepIndex = 0;

  const pushStep = (
    label: string,
    kind: FunnelStep["kind"],
    count: number,
    prevCount: number
  ) => {
    const dropFromPrev = stepIndex > 0 ? prevCount - count : null;
    const dropPctFromPrev =
      dropFromPrev != null && prevCount > 0 ? (100 * dropFromPrev) / prevCount : null;
    steps.push({
      label,
      kind,
      count,
      pctOfStart: (100 * count) / start,
      dropFromPrev,
      dropPctFromPrev,
      stepIndex,
    });
    stepIndex++;
    return count;
  };

  const steps: FunnelStep[] = [];
  let prevCount = pushStep(
    filter.lowScoreOnly ? "Score ≤ 5 pool" : "All sessions",
    "pool",
    pool.length,
    pool.length
  );

  if (filter.maxScore != null) {
    const after = pool.filter(
      (r) => !Number.isFinite(r.overall_score) || r.overall_score <= filter.maxScore!
    );
    prevCount = pushStep(`Score ≤ ${filter.maxScore}`, "score", after.length, prevCount);
  }

  let current = filterRowsByTags(pool, { ...filter, qaTags: [], categoryTags: [] });

  const order: FunnelOrder = filter.funnelOrder ?? "categories-first";
  const sequence: { tag: string; kind: PickableTagKind }[] =
    order === "categories-first"
      ? [
          ...filter.categoryTags.map((tag) => ({ tag, kind: "category" as const })),
          ...filter.qaTags.map((tag) => ({ tag, kind: "qa" as const })),
        ]
      : [
          ...filter.qaTags.map((tag) => ({ tag, kind: "qa" as const })),
          ...filter.categoryTags.map((tag) => ({ tag, kind: "category" as const })),
        ];

  for (const { tag, kind } of sequence) {
    const next = current.filter((r) => pickTagsByKind(r, kind).includes(tag));
    prevCount = pushStep(`+ ${kindLabel(kind)}: ${tag}`, kind, next.length, prevCount);
    current = next;
  }

  return steps;
}

/** Pool for computing picker stats — applies prior funnel steps only (not same-picker selections). */
export function getFunnelStatsPool(
  pool: RatingRow[],
  qaTags: string[],
  categoryTags: string[],
  funnelOrder: FunnelOrder,
  forPicker: "categories" | "tags"
): RatingRow[] {
  let current = pool;

  if (funnelOrder === "categories-first") {
    if (forPicker === "tags") {
      for (const cat of categoryTags) {
        current = current.filter((r) => r.categoryTags.includes(cat));
      }
    }
  } else if (forPicker === "categories") {
    for (const tag of qaTags) {
      current = current.filter((r) => r.qaTags.includes(tag));
    }
  }

  return current;
}

/** Sessions matching all selected funnel steps (order-independent for AND). */
export function getFunnelMatchedRows(
  pool: RatingRow[],
  filter: TagFilterState
): RatingRow[] {
  if (!filter.qaTags.length && !filter.categoryTags.length) return [];
  return filterRowsByTags(pool, { ...filter, matchMode: "all" });
}

export function computeBatchSummary(batches: LoadedBatch[]): {
  totalSessions: number;
  periodRange: string;
  batchCount: number;
} {
  const totalSessions = batches.reduce((s, b) => s + b.rows.length, 0);
  const dates = batches
    .map((b) => b.periodDate)
    .filter(Boolean) as Date[];
  dates.sort((a, b) => a.getTime() - b.getTime());
  const periodRange =
    dates.length >= 2
      ? `${dates[0].toLocaleDateString()} – ${dates[dates.length - 1].toLocaleDateString()}`
      : dates.length === 1
        ? dates[0].toLocaleDateString()
        : "—";
  return { totalSessions, periodRange, batchCount: batches.length };
}

export function topTagsAcrossBatches(
  batches: LoadedBatch[],
  pickTags: (r: RatingRow) => string[],
  lowScoreOnly: boolean
): TagStatRow[] {
  const combined = batches.flatMap((b) => poolFromBatch(b, lowScoreOnly));
  return computeTagStats(combined, pickTags, combined.length);
}
