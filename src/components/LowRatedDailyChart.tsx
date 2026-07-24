import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ActiveElement,
  type ChartEvent,
  type Plugin,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  computeDailyScoreStacks,
  computeLowScoreBandBreakdown,
  LOW_SCORE_BAND_LABELS,
  LOW_SCORE_BAND_ORDER,
  type DailyScoreStackPoint,
  type LowScoreBandId,
  type ScoreBucketId,
} from "../analytics";
import { timelineChartOptions } from "../chartTheme";
import type { LoadedBatch } from "../parsing";
import type { ReleaseMarker } from "../releaseMarkers";
import { createReleaseMarkerPlugin } from "../releaseMarkerPlugin";
import { computeTimelineReleaseOverlays } from "../analytics";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** Bottom → top: high scores at base, ≤5 segments on top. */
const STACK_BUCKET_ORDER: ScoreBucketId[] = ["6plus", "5", "4", "3", "2", "1", "unknown"];

const BUCKET_META: Record<
  ScoreBucketId,
  { label: string; color: string; short: string }
> = {
  "6plus": { label: "Score > 5", color: "#059669", short: ">5" },
  "5": { label: "Score 5", color: "#4ade80", short: "5" },
  "4": { label: "Score 4", color: "#bef264", short: "4" },
  "3": { label: "Score 3", color: "#fbbf24", short: "3" },
  "2": { label: "Score 2", color: "#fb923c", short: "2" },
  "1": { label: "Score 1", color: "#dc2626", short: "1" },
  unknown: { label: "Unrated", color: "#cbd5e1", short: "?" },
};

const BAND_COLORS: Record<LowScoreBandId, string> = {
  "1-2": "#991b1b",
  "2-3": "#dc2626",
  "3-4": "#f97316",
  "4-5": "#fbbf24",
};

function lowRatedCount(point: DailyScoreStackPoint): number {
  return (
    point.buckets["1"] +
    point.buckets["2"] +
    point.buckets["3"] +
    point.buckets["4"] +
    point.buckets["5"]
  );
}

function pctOfTotal(point: DailyScoreStackPoint, count: number): number {
  return point.totalCount ? (100 * count) / point.totalCount : 0;
}

function pctOfLowRated(point: DailyScoreStackPoint, count: number): number {
  const low = lowRatedCount(point);
  return low ? (100 * count) / low : 0;
}

const stackTotalLabelPlugin: Plugin<"bar"> = {
  id: "stackTotalLabels",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const n = chart.data.labels?.length ?? 0;
    for (let index = 0; index < n; index++) {
      let total = 0;
      let topY = Infinity;
      let x = 0;
      for (let di = 0; di < chart.data.datasets.length; di++) {
        const count = Number(chart.data.datasets[di].data[index] ?? 0);
        total += count;
        const el = chart.getDatasetMeta(di).data[index];
        if (!el || !count) continue;
        const props = el.getProps(["x", "y"], true) as { x: number; y: number };
        if (props.y < topY) {
          topY = props.y;
          x = props.x;
        }
      }
      if (!total || !Number.isFinite(topY) || !Number.isFinite(x)) continue;
      const labelY = Math.max(chartArea.top + 10, topY - 8);
      ctx.save();
      ctx.fillStyle = "#475569";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(total.toLocaleString(), x, labelY);
      ctx.restore();
    }
  },
};

function createBarTopLabelPlugin(
  getLabel: (index: number) => string | null
): Plugin<"bar"> {
  return {
    id: "barTopLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const n = chart.data.labels?.length ?? 0;
      for (let index = 0; index < n; index++) {
        const label = getLabel(index);
        if (!label) continue;
        const el = chart.getDatasetMeta(0)?.data?.[index];
        if (!el) continue;
        const { x, y } = el.getProps(["x", "y"], true) as { x: number; y: number };
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.save();
        ctx.fillStyle = "#475569";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, x, y - 6);
        ctx.restore();
      }
    },
  };
}

type LowRatedDailyChartProps = {
  batches: LoadedBatch[];
  releaseMarkers?: ReleaseMarker[];
  compact?: boolean;
};

export function LowRatedDailyChart({
  batches,
  releaseMarkers = [],
  compact = false,
}: LowRatedDailyChartProps) {
  const [drillBatchId, setDrillBatchId] = useState<string | null>(null);

  const series = useMemo(() => computeDailyScoreStacks(batches), [batches]);

  const drillBatch = useMemo(
    () => (drillBatchId ? batches.find((b) => b.id === drillBatchId) ?? null : null),
    [batches, drillBatchId]
  );

  const drillPoint = useMemo(
    () => (drillBatchId ? series.find((p) => p.batchId === drillBatchId) ?? null : null),
    [series, drillBatchId]
  );

  const drillBands = useMemo(() => {
    if (!drillBatch) return null;
    return computeLowScoreBandBreakdown(drillBatch);
  }, [drillBatch]);

  const stackBucketIds = useMemo(
    () => STACK_BUCKET_ORDER.filter((id) => series.some((p) => p.buckets[id] > 0)),
    [series]
  );

  const fakeTimeline = useMemo(
    () =>
      series.map((p) => {
        const low = lowRatedCount(p);
        return {
          batchId: p.batchId,
          label: p.label,
          count: low,
          poolSize: p.totalCount,
          pct: pctOfTotal(p, low),
          avgScore: null,
        };
      }),
    [series]
  );

  const overlays = useMemo(() => {
    const visibleIds = new Set(series.map((p) => p.batchId));
    const markersInView = releaseMarkers.filter((m) => visibleIds.has(m.batchId));
    return computeTimelineReleaseOverlays(fakeTimeline, markersInView);
  }, [fakeTimeline, releaseMarkers, series]);

  const markerPlugin = useMemo(() => createReleaseMarkerPlugin(overlays), [overlays]);

  const overviewChartData = useMemo(
    () => ({
      labels: series.map((p) => p.label),
      datasets: stackBucketIds.map((bucketId) => ({
        label: BUCKET_META[bucketId].label,
        bucketId,
        data: series.map((p) => p.buckets[bucketId]),
        backgroundColor: BUCKET_META[bucketId].color,
        borderWidth: 0,
        borderRadius: 2,
        stack: "daily",
      })),
    }),
    [series, stackBucketIds]
  );

  const drillChartData = useMemo(() => {
    if (!drillBands) return null;
    return {
      labels: LOW_SCORE_BAND_ORDER.map((id) => LOW_SCORE_BAND_LABELS[id]),
      datasets: [
        {
          label: "Sessions",
          data: LOW_SCORE_BAND_ORDER.map((id) => drillBands[id]),
          backgroundColor: LOW_SCORE_BAND_ORDER.map((id) => BAND_COLORS[id]),
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 56,
        },
      ],
    };
  }, [drillBands]);

  const drillTopLabelPlugin = useMemo(
    () =>
      createBarTopLabelPlugin((index) => {
        if (!drillPoint || !drillBands) return null;
        const bandId = LOW_SCORE_BAND_ORDER[index];
        if (!bandId) return null;
        const count = drillBands[bandId];
        return `${pctOfLowRated(drillPoint, count).toFixed(0)}%`;
      }),
    [drillPoint, drillBands]
  );

  const overviewOptions = useMemo(
    () => ({
      ...timelineChartOptions({ yFormat: (v) => String(v) }),
      maintainAspectRatio: false,
      layout: { padding: { top: overlays.length ? 32 : 26, right: 8, left: 4 } },
      onClick: (_evt: ChartEvent, elements: ActiveElement[]) => {
        if (!elements.length) return;
        const { index } = elements[0];
        const point = series[index];
        if (!point) return;
        if (lowRatedCount(point) > 0) setDrillBatchId(point.batchId);
      },
      plugins: {
        ...timelineChartOptions().plugins,
        legend: {
          display: true,
          position: "top" as const,
          align: "end" as const,
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            padding: 10,
            font: { size: 11 },
            color: "#64748b",
          },
        },
        tooltip: {
          ...timelineChartOptions().plugins.tooltip,
          mode: "index" as const,
          intersect: false,
          displayColors: false,
          callbacks: {
            title: (items: TooltipItem<"bar">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? series[idx]?.label ?? "" : "";
            },
            label: () => "",
            afterBody: (items: TooltipItem<"bar">[]) => {
              const idx = items[0]?.dataIndex;
              const point = idx != null ? series[idx] : null;
              if (!point) return [];
              const low = lowRatedCount(point);
              const lines = [
                `${point.totalCount.toLocaleString()} conversations`,
                `${pctOfTotal(point, low).toFixed(1)}% rated ≤5`,
              ];
              if (low > 0) {
                lines.push("Click bar for score band breakdown");
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: { ...timelineChartOptions().scales.x, stacked: true },
        y: {
          ...timelineChartOptions().scales.y,
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: "Conversations",
            color: "#94a3b8",
            font: { size: 11 },
          },
        },
      },
    }),
    [series, overlays.length]
  );

  const drillOptions = useMemo(() => {
    if (!drillPoint || !drillBands) return null;
    const low = lowRatedCount(drillPoint);
    return {
      ...timelineChartOptions({ yFormat: (v) => String(v) }),
      maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 8, left: 4 } },
      plugins: {
        ...timelineChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          ...timelineChartOptions().plugins.tooltip,
          intersect: true,
          mode: "nearest" as const,
          callbacks: {
            title: () => drillPoint.label,
            label: (ctx: TooltipItem<"bar">) => {
              const bandId = LOW_SCORE_BAND_ORDER[ctx.dataIndex];
              if (!bandId) return "";
              const count = drillBands[bandId];
              const ofLow = pctOfLowRated(drillPoint, count);
              const ofDay = pctOfTotal(drillPoint, count);
              return [
                `${LOW_SCORE_BAND_LABELS[bandId]}: ${count} sessions`,
                `${ofLow.toFixed(1)}% of ≤5-rated (${low} total)`,
                `${ofDay.toFixed(1)}% of all conversations`,
              ];
            },
          },
        },
      },
      scales: {
        x: timelineChartOptions().scales.x,
        y: {
          ...timelineChartOptions().scales.y,
          beginAtZero: true,
          title: {
            display: true,
            text: "Sessions",
            color: "#94a3b8",
            font: { size: 11 },
          },
        },
      },
    };
  }, [drillPoint, drillBands]);

  if (!series.length) return null;

  const latest = series[series.length - 1];
  const latestLow = lowRatedCount(latest);

  if (drillPoint && drillChartData && drillOptions && drillBands) {
    const low = lowRatedCount(drillPoint);
    return (
      <div className={`tl-chart-surface tl-pool-chart tl-pool-chart-drill ${compact ? "compact" : ""}`}>
        <div className="tl-pool-chart-head">
          <div>
            <button type="button" className="tl-drill-back" onClick={() => setDrillBatchId(null)}>
              ← Back to daily overview
            </button>
            <h3 className="tl-pool-chart-title">Score bands · {drillPoint.label}</h3>
            <p className="tl-pool-chart-sub">
              {low} of {drillPoint.totalCount} rated ≤5 ({pctOfTotal(drillPoint, low).toFixed(1)}%) ·
              bands 1–2, 2–3, 3–4, 4–5 · bar labels = % of ≤5 pool
            </p>
          </div>
        </div>
        <div className={`tl-chart-canvas ${compact ? "short" : "stacked"}`}>
          <Bar data={drillChartData} options={drillOptions} plugins={[drillTopLabelPlugin]} />
        </div>
      </div>
    );
  }

  return (
    <div className={`tl-chart-surface tl-pool-chart ${compact ? "compact" : ""}`}>
      <div className="tl-pool-chart-head">
        <div>
          <h3 className="tl-pool-chart-title">Conversations by score</h3>
          <p className="tl-pool-chart-sub">
            Stacked total per day included · count on top · hover for % rated ≤5 · click bar for band breakdown
            {series.length > 1
              ? ` · latest ${latestLow}/${latest.totalCount} rated ≤5 (${pctOfTotal(latest, latestLow).toFixed(1)}%)`
              : ""}
          </p>
        </div>
      </div>
      <div className={`tl-chart-canvas ${compact ? "short" : "stacked"}`}>
        <Bar
          key={`score-stack-${series.map((p) => p.batchId).join("|")}-${overlays.map((o) => o.markerId).join("|") || "none"}`}
          data={overviewChartData}
          options={overviewOptions}
          plugins={[
            markerPlugin as import("chart.js").Plugin<"bar">,
            stackTotalLabelPlugin,
          ]}
        />
      </div>
    </div>
  );
}
