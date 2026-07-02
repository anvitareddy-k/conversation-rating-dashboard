import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { computeTagTimeline } from "../analytics";
import { kindLabel } from "../labels";
import { barLineOptions, CHART } from "../chartTheme";
import type { LoadedBatch, TagKind } from "../parsing";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const KIND_COLOR: Record<TagKind, string> = {
  qa: CHART.accent,
  discovery: "#7c3aed",
  structural: "#ea580c",
};

type SidePanelProps = {
  open: boolean;
  tag: string | null;
  kind: TagKind | null;
  batches: LoadedBatch[];
  lowScoreOnly: boolean;
  onClose: () => void;
  onAddToFunnel?: (tag: string, kind: TagKind) => void;
};

export function SidePanel({
  open,
  tag,
  kind,
  batches,
  lowScoreOnly,
  onClose,
  onAddToFunnel,
}: SidePanelProps) {
  const [chartView, setChartView] = useState<"bar" | "line">("bar");

  const timeline = useMemo(() => {
    if (!tag || !kind) return [];
    return computeTagTimeline(batches, tag, kind, lowScoreOnly);
  }, [batches, tag, kind, lowScoreOnly]);

  const trend = useMemo(() => {
    if (timeline.length < 2) return null;
    const prev = timeline[timeline.length - 2];
    const latest = timeline[timeline.length - 1];
    const delta = latest.pct - prev.pct;
    return { delta, latest, prev };
  }, [timeline]);

  const color = kind ? KIND_COLOR[kind] : CHART.accent;

  const pctChartData = useMemo(
    () => ({
      labels: timeline.map((p) => p.label),
      datasets: [
        chartView === "bar"
          ? {
              label: "% of pool",
              data: timeline.map((p) => p.pct),
              backgroundColor: `${color}bb`,
              borderColor: color,
              borderWidth: 1,
              borderRadius: 6,
            }
          : {
              label: "% of pool",
              data: timeline.map((p) => p.pct),
              borderColor: color,
              backgroundColor: `${color}18`,
              fill: true,
              tension: 0.3,
              pointRadius: 6,
              pointHoverRadius: 8,
              borderWidth: 2.5,
            },
      ],
    }),
    [timeline, color, chartView]
  );

  const countChartData = useMemo(
    () => ({
      labels: timeline.map((p) => p.label),
      datasets: [
        {
          label: "Session count",
          data: timeline.map((p) => p.count),
          backgroundColor: "#059669bb",
          borderColor: "#059669",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }),
    [timeline]
  );

  const pctOptions = useMemo(
    () => ({
      ...barLineOptions({ yLabel: "% of pool", yFormat: (v) => `${v}%` }),
      plugins: {
        ...barLineOptions().plugins,
        tooltip: {
          ...barLineOptions().plugins.tooltip,
          callbacks: {
            afterBody: (items: { dataIndex: number }[]) => {
              const idx = items[0]?.dataIndex;
              if (idx == null) return [];
              const p = timeline[idx];
              if (!p) return [];
              return [
                `Count: ${p.count} / ${p.poolSize} sessions`,
                p.avgScore != null ? `Avg score: ${p.avgScore.toFixed(2)}` : "",
              ].filter(Boolean);
            },
          },
        },
      },
    }),
    [timeline]
  );

  const countOptions = useMemo(
    () => barLineOptions({ yLabel: "Sessions", yFormat: (v) => String(v) }),
    []
  );

  if (!open || !tag || !kind) return null;

  return (
    <>
      <div className="side-panel-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="side-panel" role="dialog" aria-label={`Timeline for ${tag}`}>
        <div className="side-panel-header">
          <div>
            <span className={`side-panel-kind ${kind}`}>{kindLabel(kind)}</span>
            <h2>{tag}</h2>
          </div>
          <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {trend ? (
          <div className={`trend-banner ${trend.delta > 0.05 ? "up" : trend.delta < -0.05 ? "down" : "flat"}`}>
            <strong>
              {trend.delta > 0.05 ? "▲ Increased" : trend.delta < -0.05 ? "▼ Decreased" : "● Stable"}{" "}
              {Math.abs(trend.delta).toFixed(1)} pp
            </strong>
            <span>
              {trend.prev.label}: {trend.prev.pct.toFixed(1)}% → {trend.latest.label}: {trend.latest.pct.toFixed(1)}%
            </span>
          </div>
        ) : batches.length < 2 ? (
          <div className="trend-banner flat">
            Upload multiple files to compare trends across periods.
          </div>
        ) : null}

        <div className="side-panel-section">
          <div className="side-panel-section-head">
            <h3>% of pool over time</h3>
            <div className="segmented-control compact">
              <button type="button" className={chartView === "bar" ? "active" : ""} onClick={() => setChartView("bar")}>Bar</button>
              <button type="button" className={chartView === "line" ? "active" : ""} onClick={() => setChartView("line")}>Line</button>
            </div>
          </div>
          <div className="side-panel-chart">
            {chartView === "bar" ? (
              <Bar data={pctChartData} options={pctOptions} />
            ) : (
              <Line data={pctChartData} options={pctOptions} />
            )}
          </div>
        </div>

        <div className="side-panel-section">
          <h3>Session count over time</h3>
          <div className="side-panel-chart">
            <Bar data={countChartData} options={countOptions} />
          </div>
        </div>

        <table className="tag-table compact side-panel-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Count</th>
              <th>% pool</th>
              <th>Avg score</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((p) => (
              <tr key={p.batchId}>
                <td>{p.label}</td>
                <td>{p.count}</td>
                <td>{p.pct.toFixed(1)}%</td>
                <td>{p.avgScore != null ? p.avgScore.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {onAddToFunnel ? (
          <button type="button" className="side-panel-action" onClick={() => onAddToFunnel(tag, kind)}>
            Add to funnel filter
          </button>
        ) : null}
      </aside>
    </>
  );
}
