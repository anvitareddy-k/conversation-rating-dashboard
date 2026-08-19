import type { LoadedBatch, PickableTagKind, RatingRow, TagKind, TagStatRow, FunnelOrder } from "./parsing";
import { computeTagStats, filterRowsByTags, isLowRated, pickTagsByKind, type TagFilterState } from "./parsing";
import { kindLabel } from "./labels";
import type { DaySlice } from "./compactFormat";

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

function activeSlice(batch: LoadedBatch): DaySlice | null {
  return batch.slices?.all ?? null;
}

function tagMapForSlice(
  slice: DaySlice,
  kind: TagKind,
  lowScoreOnly: boolean
): Record<string, number> {
  if (kind === "qa") return lowScoreOnly ? slice.qaLow : slice.qa;
  if (kind === "category") return lowScoreOnly ? slice.catLow : slice.cat;
  if (kind === "discovery") return slice.disc;
  return {};
}

/** Per-day stacked score counts (6+ at base, 1–5 stacked above, ≤5 on top). */
export function computeDailyScoreStacks(batches: LoadedBatch[]): DailyScoreStackPoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  return sorted.map((batch) => {
    const slice = activeSlice(batch);
    if (slice) {
      return {
        batchId: batch.id,
        label: batch.label,
        totalCount: slice.total,
        buckets: slice.buckets,
      };
    }
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
  const slice = activeSlice(batch);
  if (slice) return { ...slice.bands };
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
    const slice = activeSlice(batch);
    if (slice) {
      return {
        batchId: batch.id,
        label: batch.label,
        lowRatedCount: slice.lowRated,
        totalCount: slice.total,
        lowRatedPct: slice.total ? (100 * slice.lowRated) / slice.total : 0,
      };
    }
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
    const slice = activeSlice(batch);
    if (slice) {
      return {
        batchId: batch.id,
        label: batch.label,
        avgTurns: slice.withTurns ? slice.turnSum / slice.withTurns : null,
        sessionCount: slice.total,
        withTurnsCount: slice.withTurns,
      };
    }
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

/** Fixed tags tracked in the week-by-week spotlight chart. */
export type SpotlightTagDef = {
  id: string;
  tag: string;
  kind: PickableTagKind;
  shortLabel: string;
};

export const SPOTLIGHT_TAGS: SpotlightTagDef[] = [
  {
    id: "previous-year",
    tag: "Previous Year Questions",
    kind: "category",
    shortLabel: "Previous year questions",
  },
  {
    id: "mock-practice",
    tag: "Mock / Practice Questions",
    kind: "category",
    shortLabel: "Practice / mock questions",
  },
  {
    id: "image-reading",
    tag: "Image Reading Error",
    kind: "qa",
    shortLabel: "Image reading error",
  },
  {
    id: "incorrect-answer",
    tag: "Incorrect Answer",
    kind: "qa",
    shortLabel: "Incorrect answer",
  },
  {
    id: "unwanted-template",
    tag: "Unwanted Template Push",
    kind: "qa",
    shortLabel: "Unwanted template push",
  },
  {
    id: "context-failure",
    tag: "Context Handling Failure",
    kind: "qa",
    shortLabel: "Context handling failure",
  },
  {
    id: "correction-ignored",
    tag: "Correction Ignored",
    kind: "qa",
    shortLabel: "Correction ignored",
  },
  {
    id: "gone-exception",
    tag: "Gone Exception",
    kind: "qa",
    shortLabel: "Gone exception",
  },
  {
    id: "image-gone",
    tag: "Image Gone Exception",
    kind: "qa",
    shortLabel: "Image gone exception",
  },
  {
    id: "completion-refusal",
    tag: "Completion Refusal",
    kind: "qa",
    shortLabel: "Completion refusal",
  },
  {
    id: "slow-generation",
    tag: "Slow Generation",
    kind: "qa",
    shortLabel: "Slow generation",
  },
  {
    id: "insufficient-input",
    tag: "Insufficient Input Data",
    kind: "qa",
    shortLabel: "Insufficient input",
  },
  {
    id: "slotfill",
    tag: "Slotfill",
    kind: "category",
    shortLabel: "Slotfill",
  },
  {
    id: "image-upload",
    tag: "Image Upload",
    kind: "category",
    shortLabel: "Image upload",
  },
  {
    id: "speech-to-text",
    tag: "Speech to Text",
    kind: "category",
    shortLabel: "Speech to text",
  },
  {
    id: "direct-response",
    tag: "Direct Response",
    kind: "category",
    shortLabel: "Direct response",
  },
  {
    id: "blurry-image",
    tag: "Blurry / Unclear Image",
    kind: "category",
    shortLabel: "Blurry / unclear image",
  },
  {
    id: "outside-school",
    tag: "Outside School Level Questions",
    kind: "category",
    shortLabel: "Outside school level",
  },
];

export type WeeklyTagPoint = {
  weekKey: string;
  label: string;
  weekStart: Date;
  weekEnd: Date;
  count: number;
  poolSize: number;
  pct: number;
  dayCount: number;
};

function startOfIsoWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(date: Date): string {
  const s = startOfIsoWeek(date);
  const y = s.getFullYear();
  const m = String(s.getMonth() + 1).padStart(2, "0");
  const day = String(s.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
  const startFmt = weekStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endFmt = weekEnd.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startFmt} – ${endFmt}`;
}

/**
 * Week-by-week % of sessions with a given tag (Mon–Sun weeks by batch periodDate).
 * Batches without a periodDate are skipped.
 */
export function computeWeeklyTagSeries(
  batches: LoadedBatch[],
  tag: string,
  kind: PickableTagKind,
  lowScoreOnly = false
): WeeklyTagPoint[] {
  type Bucket = {
    weekStart: Date;
    weekEnd: Date;
    count: number;
    poolSize: number;
    dayKeys: Set<string>;
    rows: RatingRow[];
    usedSlice: boolean;
  };
  const byWeek = new Map<string, Bucket>();

  for (const batch of batches) {
    if (!batch.periodDate) continue;
    const start = startOfIsoWeek(batch.periodDate);
    const key = weekKey(batch.periodDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    let bucket = byWeek.get(key);
    if (!bucket) {
      bucket = {
        weekStart: start,
        weekEnd: end,
        count: 0,
        poolSize: 0,
        dayKeys: new Set(),
        rows: [],
        usedSlice: false,
      };
      byWeek.set(key, bucket);
    }
    const dayKey = `${batch.periodDate.getFullYear()}-${batch.periodDate.getMonth()}-${batch.periodDate.getDate()}`;
    bucket.dayKeys.add(dayKey);
    const slice = activeSlice(batch);
    if (slice) {
      bucket.usedSlice = true;
      const map = tagMapForSlice(slice, kind, lowScoreOnly);
      bucket.count += map[tag] || 0;
      bucket.poolSize += lowScoreOnly ? slice.lowRated : slice.total;
    } else {
      const rows = lowScoreOnly ? batch.rows.filter(isLowRated) : batch.rows;
      bucket.rows.push(...rows);
    }
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[1].weekStart.getTime() - b[1].weekStart.getTime())
    .map(([key, bucket]) => {
      const extraCount = bucket.usedSlice
        ? 0
        : bucket.rows.filter((r) => rowHasTag(r, tag, kind)).length;
      const extraPool = bucket.usedSlice ? 0 : bucket.rows.length;
      const count = bucket.count + extraCount;
      const poolSize = bucket.poolSize + extraPool;
      return {
        weekKey: key,
        label: formatWeekLabel(bucket.weekStart, bucket.weekEnd),
        weekStart: bucket.weekStart,
        weekEnd: bucket.weekEnd,
        count,
        poolSize,
        pct: poolSize ? (100 * count) / poolSize : 0,
        dayCount: bucket.dayKeys.size,
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
    const slice = activeSlice(batch);
    if (slice) {
      const poolSize = lowScoreOnly ? slice.lowRated : slice.total;
      const count = tagMapForSlice(slice, kind, lowScoreOnly)[tag] || 0;
      return {
        batchId: batch.id,
        label: batch.label,
        count,
        poolSize,
        pct: poolSize ? (100 * count) / poolSize : 0,
        avgScore: null,
      };
    }
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
  const totalSessions = batches.reduce((s, b) => {
    const slice = activeSlice(b);
    return s + (slice ? slice.total : b.rows.length);
  }, 0);
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
  lowScoreOnly: boolean,
  kind: TagKind = "qa"
): TagStatRow[] {
  const allSliced = batches.length > 0 && batches.every((b) => activeSlice(b));
  if (allSliced) {
    const merged: Record<string, number> = {};
    let pool = 0;
    for (const batch of batches) {
      const slice = activeSlice(batch)!;
      pool += lowScoreOnly ? slice.lowRated : slice.total;
      const map = tagMapForSlice(slice, kind, lowScoreOnly);
      for (const [tag, n] of Object.entries(map)) merged[tag] = (merged[tag] || 0) + n;
    }
    const denom = pool || 1;
    return Object.entries(merged)
      .map(([tag, count]) => ({
        tag,
        count,
        pctOfPool: (100 * count) / denom,
        pctOfTotal: (100 * count) / denom,
      }))
      .sort((a, b) => b.count - a.count);
  }
  const combined = batches.flatMap((b) => poolFromBatch(b, lowScoreOnly));
  return computeTagStats(combined, pickTags, combined.length);
}

/** learning_ask_type share for the selected days. Empty if the column is absent. */
export function computeAskTypeStats(
  batches: LoadedBatch[],
  rows: RatingRow[],
  lowScoreOnly: boolean
): TagStatRow[] {
  const merged: Record<string, number> = {};
  let pool = 0;
  const sliced = batches.filter((b) => activeSlice(b)?.ask);
  if (sliced.length === batches.length && batches.length > 0) {
    for (const batch of batches) {
      const slice = activeSlice(batch)!;
      pool += lowScoreOnly ? slice.lowRated : slice.total;
      const map = lowScoreOnly ? slice.askLow ?? {} : slice.ask ?? {};
      for (const [tag, n] of Object.entries(map)) merged[tag] = (merged[tag] || 0) + n;
    }
  } else {
    const poolRows = lowScoreOnly ? rows.filter(isLowRated) : rows;
    pool = poolRows.length;
    for (const r of poolRows) {
      const t = r.learningAskType?.trim();
      if (!t) continue;
      merged[t] = (merged[t] || 0) + 1;
    }
  }
  const labeled = Object.values(merged).reduce((s, n) => s + n, 0);
  if (!labeled) return [];
  return Object.entries(merged)
    .filter(([, count]) => count > 0)
    .map(([tag, count]) => ({
      tag,
      count,
      pctOfPool: (100 * count) / labeled,
      pctOfTotal: pool > 0 ? (100 * count) / pool : (100 * count) / labeled,
    }))
    .sort((a, b) => b.count - a.count);
}

export type DailyAskTypePoint = {
  batchId: string;
  label: string;
  labeled: number;
  total: number;
  counts: Record<string, number>;
};

function askCountsForBatch(batch: LoadedBatch, lowScoreOnly: boolean): Record<string, number> {
  const slice = activeSlice(batch);
  if (slice?.ask) {
    return { ...(lowScoreOnly ? slice.askLow ?? {} : slice.ask) };
  }
  const counts: Record<string, number> = {};
  const rows = lowScoreOnly ? batch.rows.filter(isLowRated) : batch.rows;
  for (const r of rows) {
    const t = r.learningAskType?.trim();
    if (!t) continue;
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

/** Day-wise learning_ask_type counts. Days with no values are omitted. */
export function computeDailyAskTypeSeries(
  batches: LoadedBatch[],
  lowScoreOnly: boolean
): DailyAskTypePoint[] {
  const sorted = [...batches].sort(
    (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
  );
  const points: DailyAskTypePoint[] = [];
  for (const batch of sorted) {
    const counts = askCountsForBatch(batch, lowScoreOnly);
    const labeled = Object.values(counts).reduce((s, n) => s + n, 0);
    if (!labeled) continue;
    const slice = activeSlice(batch);
    const total = slice
      ? lowScoreOnly
        ? slice.lowRated
        : slice.total
      : lowScoreOnly
        ? batch.rows.filter(isLowRated).length
        : batch.rows.length;
    points.push({ batchId: batch.id, label: batch.label, labeled, total, counts });
  }
  return points;
}
