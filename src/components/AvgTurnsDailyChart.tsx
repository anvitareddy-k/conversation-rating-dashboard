import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { computeDailyAvgTurnsSeries } from "../analytics";
import { CHART, timelineChartOptions } from "../chartTheme";
import type { LoadedBatch } from "../parsing";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

type AvgTurnsDailyChartProps = {
  batches: LoadedBatch[];
  compact?: boolean;
};

export function AvgTurnsDailyChart({ batches, compact = false }: AvgTurnsDailyChartProps) {
  const series = useMemo(() => computeDailyAvgTurnsSeries(batches), [batches]);

  const values = useMemo(
    () => series.map((p) => p.avgTurns).filter((v): v is number => v != null),
    [series]
  );

  const overallAvg = useMemo(() => {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [values]);

  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const delta =
    latest?.avgTurns != null && prev?.avgTurns != null
      ? latest.avgTurns - prev.avgTurns
      : null;

  const chartData = useMemo(
    () => ({
      labels: series.map((p) => p.label),
      datasets: [
        {
          label: "Avg turns",
          data: series.map((p) => p.avgTurns),
          borderColor: CHART.accent,
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: series.length > 14 ? 0 : 3,
          pointHoverRadius: 5,
          spanGaps: false,
        },
      ],
    }),
    [series]
  );

  const options = useMemo(
    () => ({
      ...timelineChartOptions({
        yFormat: (v) => (typeof v === "number" ? v.toFixed(v % 1 === 0 ? 0 : 1) : String(v)),
      }),
      maintainAspectRatio: false,
      layout: { padding: { top: 18, right: 8, left: 4 } },
      plugins: {
        ...timelineChartOptions().plugins,
        tooltip: {
          ...timelineChartOptions().plugins.tooltip,
          callbacks: {
            title: (items: TooltipItem<"line">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? series[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"line">) => {
              const point = series[ctx.dataIndex];
              if (!point) return "";
              if (point.avgTurns == null) return "No turn data";
              return [
                `Avg length: ${point.avgTurns.toFixed(1)} turns`,
                `${point.withTurnsCount.toLocaleString()} of ${point.sessionCount.toLocaleString()} sessions`,
              ];
            },
          },
        },
      },
      scales: {
        x: timelineChartOptions().scales.x,
        y: {
          ...timelineChartOptions().scales.y,
          beginAtZero: false,
          title: {
            display: true,
            text: "Avg turns",
            color: "#94a3b8",
            font: { size: 11 },
          },
        },
      },
    }),
    [series]
  );

  if (!series.length || !values.length) return null;

  const deltaLabel =
    delta == null
      ? ""
      : ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs prior day`;

  return (
    <div className={`tl-chart-surface tl-pool-chart ${compact ? "compact" : ""}`}>
      <div className="tl-pool-chart-head">
        <div>
          <h3 className="tl-pool-chart-title">Average conversation length</h3>
          <p className="tl-pool-chart-sub">
            Mean turns per day included
            {overallAvg != null ? ` · overall ${overallAvg.toFixed(1)} turns` : ""}
            {latest?.avgTurns != null
              ? ` · latest ${latest.avgTurns.toFixed(1)}${deltaLabel}`
              : ""}
          </p>
        </div>
      </div>
      <div className="tl-chart-canvas short">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
