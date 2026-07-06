import { useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, type ChartEvent, type ActiveElement } from "chart.js";
import { Bar } from "react-chartjs-2";
import { timelineChartOptions } from "../chartTheme";
import { LABELS } from "../labels";
import {
  shiftsForChartByKind,
  type ShiftChartRow,
  type TimelineInsights,
  type TimelineInsightWindow,
} from "../timelineInsights";
import { getTagDescriptionOrDefault } from "../tagDefinitions";
import type { PickableTagKind } from "../parsing";
import type { ReleaseMarker } from "../releaseMarkers";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type BatchOption = { id: string; label: string };

type SignificantChangesPanelProps = {
  insights: TimelineInsights;
  batches: BatchOption[];
  releaseMarkers: ReleaseMarker[];
  selectedReleaseId: string | null;
  onSelectRelease: (id: string) => void;
  changePointBatchId: string | null;
  onChangePointBatchId: (batchId: string) => void;
  onSelectTag?: (tag: string, kind: PickableTagKind) => void;
};

/** Draw pp delta on horizontal bars — inside bar when wide enough, else outside away from y labels. */
const barDeltaLabelsPlugin = {
  id: "barDeltaLabels",
  afterDatasetsDraw(chart: ChartJS) {
    const { ctx, chartArea } = chart;
    const dataset = chart.data.datasets[0];
    if (!dataset) return;
    const meta = chart.getDatasetMeta(0);
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    meta.data.forEach((bar, index) => {
      const raw = dataset.data[index];
      if (raw == null || typeof raw !== "number") return;
      const label = `${raw >= 0 ? "+" : ""}${raw.toFixed(1)}pp`;
      const props = bar.getProps(["x", "y", "base"], true);
      const barWidth = Math.abs(props.x - props.base);
      const textWidth = ctx.measureText(label).width;
      const fitsInside = barWidth >= textWidth + 14;

      ctx.save();
      if (raw >= 0) {
        if (fitsInside) {
          ctx.fillStyle = "#fff";
          ctx.textAlign = "right";
          ctx.fillText(label, props.x - 8, props.y);
        } else {
          ctx.fillStyle = "#475569";
          ctx.textAlign = "left";
          ctx.fillText(label, Math.min(props.x + 8, chartArea.right - textWidth - 2), props.y);
        }
      } else if (fitsInside) {
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(label, props.x + 8, props.y);
      } else {
        ctx.fillStyle = "#475569";
        ctx.textAlign = "left";
        ctx.fillText(label, Math.max(props.base + 8, chartArea.left + 4), props.y);
      }
      ctx.restore();
    });
  },
};

function buildChartData(rows: ShiftChartRow[]) {
  const sorted = [...rows].sort((a, b) => a.deltaPct - b.deltaPct);
  return {
    labels: sorted.map((r) => r.tag),
    sorted,
    datasets: [
      {
        label: "Change (pp)",
        data: sorted.map((r) => r.deltaPct),
        backgroundColor: sorted.map((r) =>
          r.deltaPct > 0 ? "rgba(220, 38, 38, 0.75)" : "rgba(5, 150, 105, 0.75)"
        ),
        borderWidth: 0,
        borderRadius: 3,
      },
    ],
  };
}

function buildChartOptions(
  rows: ShiftChartRow[],
  kind: PickableTagKind,
  onSelectTag?: (tag: string, kind: PickableTagKind) => void
) {
  const sorted = [...rows].sort((a, b) => a.deltaPct - b.deltaPct);
  return {
    ...timelineChartOptions({
      yFormat: (v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}pp`,
    }),
    indexAxis: "y" as const,
    maintainAspectRatio: false,
    layout: { padding: { left: 4, right: 52, top: 4, bottom: 4 } },
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
      if (!onSelectTag || !elements.length) return;
      const idx = elements[0].index;
      const row = sorted[idx];
      if (row) onSelectTag(row.tag, kind);
    },
    plugins: {
      ...timelineChartOptions().plugins,
      legend: { display: false },
      tooltip: {
        ...timelineChartOptions().plugins.tooltip,
        callbacks: {
          label: (ctx: { dataIndex: number }) => {
            const row = sorted[ctx.dataIndex];
            if (!row) return "";
            const lines = [
              `${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)}pp`,
              `${row.beforePct.toFixed(1)}% → ${row.afterPct.toFixed(1)}%`,
              getTagDescriptionOrDefault(row.tag, kind),
            ];
            if (kind === "qa" && row.inferredDiscoveryTags.length) {
              lines.push(
                `Categories: ${row.inferredDiscoveryTags.map((d) => d.discoveryTag).join(", ")}`
              );
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        ...timelineChartOptions().scales.x,
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#94a3b8",
          font: { size: 11 },
          callback: (v: number | string) => `${Number(v) >= 0 ? "+" : ""}${v}pp`,
        },
      },
      y: {
        ...timelineChartOptions().scales.y,
        grid: { display: false },
        ticks: { color: "#475569", font: { size: 11 } },
      },
    },
  };
}

function ChangesSection({
  title,
  rows,
  kind,
  onSelectTag,
}: {
  title: string;
  rows: ShiftChartRow[];
  kind: PickableTagKind;
  onSelectTag?: (tag: string, kind: PickableTagKind) => void;
}) {
  const chartData = useMemo(() => buildChartData(rows), [rows]);
  const chartOptions = useMemo(
    () => buildChartOptions(rows, kind, onSelectTag),
    [rows, kind, onSelectTag]
  );

  if (!rows.length) {
    return (
      <div className="tl-changes-section">
        <h4 className="tl-changes-section-title">{title}</h4>
        <p className="tl-changes-section-empty">No significant shifts.</p>
      </div>
    );
  }

  return (
    <div className="tl-changes-section">
      <h4 className="tl-changes-section-title">{title}</h4>
      <div
        className="tl-changes-chart-wrap"
        style={{ height: Math.max(160, rows.length * 36) }}
      >
        <Bar data={chartData} options={chartOptions} plugins={[barDeltaLabelsPlugin]} />
      </div>
    </div>
  );
}

function resolveActiveWindow(
  insights: TimelineInsights,
  releaseMarkers: ReleaseMarker[],
  selectedReleaseId: string | null,
  changePointBatchId: string | null
): TimelineInsightWindow | null {
  const chartWindows = insights.windows.filter(
    (w) =>
      w.scope !== "day_over_day" && (w.increases.length > 0 || w.decreases.length > 0)
  );
  if (!chartWindows.length) return null;

  if (releaseMarkers.length > 0) {
    const releaseId = selectedReleaseId ?? releaseMarkers[0]?.id ?? null;
    if (releaseId) {
      const releaseWindow = chartWindows.find((w) => w.id === releaseId);
      if (releaseWindow) return releaseWindow;

      const marker = releaseMarkers.find((m) => m.id === releaseId);
      if (marker) {
        const changePointWindow = chartWindows.find(
          (w) => w.scope === "change_point" && w.splitBatchId === marker.batchId
        );
        if (changePointWindow) return changePointWindow;
      }
    }

    return (
      chartWindows.find((w) => w.scope === "release") ??
      chartWindows.find((w) => w.scope === "change_point") ??
      chartWindows[0] ??
      null
    );
  }

  if (changePointBatchId) {
    return chartWindows.find((w) => w.scope === "change_point") ?? chartWindows[0];
  }

  return chartWindows[0] ?? null;
}

export function SignificantChangesPanel({
  insights,
  batches,
  releaseMarkers,
  selectedReleaseId,
  onSelectRelease,
  changePointBatchId,
  onChangePointBatchId,
  onSelectTag,
}: SignificantChangesPanelProps) {
  const splitOptions = useMemo(
    () =>
      batches
        .map((b, i) => ({ ...b, index: i }))
        .filter((b) => b.index > 0 && b.index < batches.length),
    [batches]
  );

  const activeWindow = useMemo(
    () => resolveActiveWindow(insights, releaseMarkers, selectedReleaseId, changePointBatchId),
    [insights, releaseMarkers, selectedReleaseId, changePointBatchId]
  );

  const issueRows = useMemo(
    () => (activeWindow ? shiftsForChartByKind(activeWindow, "qa", 10) : []),
    [activeWindow]
  );

  const categoryRows = useMemo(
    () => (activeWindow ? shiftsForChartByKind(activeWindow, "category", 10) : []),
    [activeWindow]
  );

  const hasAnyWindow = insights.windows.some(
    (w) =>
      w.scope !== "day_over_day" && (w.increases.length > 0 || w.decreases.length > 0)
  );

  if (!hasAnyWindow) return null;

  const activeReleaseId = selectedReleaseId ?? releaseMarkers[0]?.id ?? null;

  return (
    <section className="tl-changes-panel">
      <div className="tl-changes-head">
        <div>
          <h3 className="tl-changes-title">Significant changes</h3>
          <p className="tl-changes-sub">
            Tags that moved ≥ 0.5pp · red = up, green = down · click a bar to view that tag
          </p>
        </div>
      </div>

      {releaseMarkers.length > 0 ? (
        <div className="tl-changes-tabs">
          {releaseMarkers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className={activeReleaseId === marker.id ? "active" : ""}
              onClick={() => onSelectRelease(marker.id)}
            >
              {marker.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="tl-changes-split-control">
          <label className="tl-changes-split-label">
            Compare from
            <select
              className="tl-input"
              value={changePointBatchId ?? ""}
              onChange={(e) => {
                if (e.target.value) onChangePointBatchId(e.target.value);
              }}
            >
              <option value="" disabled>
                Pick first day of “after” period…
              </option>
              {splitOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} onward
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!activeWindow ? (
        <p className="tl-changes-section-empty">
          {releaseMarkers.length > 0
            ? "Select a release marker above to see significant changes."
            : "Pick a compare-from date to see significant changes."}
        </p>
      ) : !issueRows.length && !categoryRows.length ? (
        <p className="tl-changes-section-empty">No significant shifts for this period.</p>
      ) : (
        <div className="tl-changes-sections">
          <ChangesSection
            title={LABELS.tags}
            rows={issueRows}
            kind="qa"
            onSelectTag={onSelectTag}
          />
          <ChangesSection
            title={LABELS.categories}
            rows={categoryRows}
            kind="category"
            onSelectTag={onSelectTag}
          />
        </div>
      )}
    </section>
  );
}
