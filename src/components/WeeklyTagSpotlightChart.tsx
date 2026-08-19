import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  SPOTLIGHT_TAGS,
  computeWeeklyTagSeries,
  type SpotlightTagDef,
} from "../analytics";
import { CHART, timelineChartOptions } from "../chartTheme";
import type { LoadedBatch } from "../parsing";
import { getTagDescriptionOrDefault } from "../tagDefinitions";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function colorForTag(id: string): string {
  const idx = SPOTLIGHT_TAGS.findIndex((t) => t.id === id);
  return CHART.colors[(idx >= 0 ? idx : 0) % CHART.colors.length];
}

type WeeklyTagSpotlightChartProps = {
  batches: LoadedBatch[];
  compact?: boolean;
  lowScoreOnly?: boolean;
};

export function WeeklyTagSpotlightChart({
  batches,
  compact = false,
  lowScoreOnly = false,
}: WeeklyTagSpotlightChartProps) {
  const [selectedId, setSelectedId] = useState(SPOTLIGHT_TAGS[0].id);

  const selected: SpotlightTagDef =
    SPOTLIGHT_TAGS.find((t) => t.id === selectedId) ?? SPOTLIGHT_TAGS[0];

  const series = useMemo(
    () => computeWeeklyTagSeries(batches, selected.tag, selected.kind, lowScoreOnly),
    [batches, selected.tag, selected.kind, lowScoreOnly]
  );

  const overallPct = useMemo(() => {
    if (!series.length) return null;
    const count = series.reduce((s, p) => s + p.count, 0);
    const pool = series.reduce((s, p) => s + p.poolSize, 0);
    return pool ? (100 * count) / pool : null;
  }, [series]);

  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const delta = latest != null && prev != null ? latest.pct - prev.pct : null;

  const color = colorForTag(selected.id);

  const chartData = useMemo(
    () => ({
      labels: series.map((p) => p.label),
      datasets: [
        {
          label: `% · ${selected.shortLabel}`,
          data: series.map((p) => p.pct),
          backgroundColor: color,
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 48,
        },
      ],
    }),
    [series, selected.shortLabel, color]
  );

  const options = useMemo(
    () => ({
      ...timelineChartOptions({ yFormat: (v) => `${Number(v).toFixed(0)}%` }),
      maintainAspectRatio: false,
      layout: { padding: { top: 18, right: 8, left: 4 } },
      plugins: {
        ...timelineChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          ...timelineChartOptions().plugins.tooltip,
          callbacks: {
            title: (items: TooltipItem<"bar">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? series[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"bar">) => {
              const point = series[ctx.dataIndex];
              if (!point) return "";
              return [
                `${selected.tag}: ${point.pct.toFixed(1)}%`,
                `${point.count.toLocaleString()} of ${point.poolSize.toLocaleString()} sessions`,
                `${point.dayCount} day${point.dayCount === 1 ? "" : "s"} in week`,
                getTagDescriptionOrDefault(selected.tag, selected.kind),
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ...timelineChartOptions().scales.x,
          ticks: {
            ...timelineChartOptions().scales.x.ticks,
            maxRotation: 45,
            minRotation: 0,
            maxTicksLimit: 16,
          },
        },
        y: {
          ...timelineChartOptions().scales.y,
          beginAtZero: true,
          title: {
            display: true,
            text: lowScoreOnly ? "% of ≤5 sessions" : "% of sessions",
            color: "#94a3b8",
            font: { size: 11 },
          },
        },
      },
    }),
    [series, selected, lowScoreOnly]
  );

  if (!series.length) return null;

  const deltaLabel =
    delta == null
      ? ""
      : ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp vs prior week`;

  return (
    <div className={`tl-chart-surface tl-pool-chart ${compact ? "compact" : ""}`}>
      <div className="tl-pool-chart-head weekly-spotlight-head">
        <div>
          <h3 className="tl-pool-chart-title">Week-by-week tag spotlight</h3>
          <p className="tl-pool-chart-sub">
            % of {lowScoreOnly ? "≤5-rated " : ""}conversations with the selected tag each Mon–Sun week
            {overallPct != null ? ` · overall ${overallPct.toFixed(1)}%` : ""}
            {latest != null ? ` · latest week ${latest.pct.toFixed(1)}%${deltaLabel}` : ""}
          </p>
        </div>
      </div>

      <div className="weekly-spotlight-pills" role="tablist" aria-label="Spotlight tags">
        {SPOTLIGHT_TAGS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selectedId === t.id}
            className={`weekly-spotlight-pill ${selectedId === t.id ? "active" : ""}`}
            style={
              selectedId === t.id
                ? { borderColor: colorForTag(t.id), background: `${colorForTag(t.id)}14` }
                : undefined
            }
            onClick={() => setSelectedId(t.id)}
          >
            <span
              className="weekly-spotlight-dot"
              style={{ background: colorForTag(t.id) }}
              aria-hidden
            />
            {t.shortLabel}
          </button>
        ))}
      </div>

      <div className={`tl-chart-canvas ${compact ? "short" : "stacked"}`}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
