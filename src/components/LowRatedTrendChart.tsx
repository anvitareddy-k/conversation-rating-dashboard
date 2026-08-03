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
import { computeDailyLowRatedSeries } from "../analytics";
import { timelineChartOptions } from "../chartTheme";
import type { LoadedBatch } from "../parsing";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const LINE_COLOR = "#dc2626";

type LowRatedTrendChartProps = {
  batches: LoadedBatch[];
  compact?: boolean;
};

export function LowRatedTrendChart({ batches, compact = false }: LowRatedTrendChartProps) {
  const series = useMemo(() => computeDailyLowRatedSeries(batches), [batches]);

  const overallPct = useMemo(() => {
    if (!series.length) return null;
    const totalLow = series.reduce((s, p) => s + p.lowRatedCount, 0);
    const totalSessions = series.reduce((s, p) => s + p.totalCount, 0);
    return totalSessions ? (100 * totalLow) / totalSessions : null;
  }, [series]);

  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const delta =
    latest != null && prev != null ? latest.lowRatedPct - prev.lowRatedPct : null;

  const chartData = useMemo(
    () => ({
      labels: series.map((p) => p.label),
      datasets: [
        {
          label: "% rated ≤5",
          data: series.map((p) => p.lowRatedPct),
          borderColor: LINE_COLOR,
          backgroundColor: "rgba(220, 38, 38, 0.12)",
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
        yFormat: (v) => `${Number(v).toFixed(0)}%`,
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
              return [
                `${point.lowRatedPct.toFixed(1)}% rated ≤5`,
                `${point.lowRatedCount.toLocaleString()} of ${point.totalCount.toLocaleString()} sessions`,
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
            text: "% rated ≤5",
            color: "#94a3b8",
            font: { size: 11 },
          },
        },
      },
    }),
    [series]
  );

  if (!series.length) return null;

  const deltaLabel =
    delta == null
      ? ""
      : ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp vs prior day`;

  return (
    <div className={`tl-chart-surface tl-pool-chart ${compact ? "compact" : ""}`}>
      <div className="tl-pool-chart-head">
        <div>
          <h3 className="tl-pool-chart-title">Conversations rated ≤5</h3>
          <p className="tl-pool-chart-sub">
            Share of sessions scored ≤5 each day included
            {overallPct != null ? ` · overall ${overallPct.toFixed(1)}%` : ""}
            {latest != null
              ? ` · latest ${latest.lowRatedPct.toFixed(1)}%${deltaLabel}`
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
