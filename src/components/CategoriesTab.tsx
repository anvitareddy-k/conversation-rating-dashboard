import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { computeAskTypeStats, computeDailyAskTypeSeries } from "../analytics";
import { timelineChartOptions } from "../chartTheme";
import { LABELS } from "../labels";
import type { AppliedTimeRange, LoadedBatch, TagFilterState } from "../parsing";
import { DateRangeBar } from "./DateRangeBar";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const BAR_COLOR = "rgba(15, 118, 110, 0.85)";

type CategoriesTabProps = {
  batches: LoadedBatch[];
  workingBatches: LoadedBatch[];
  rangeStartStr: string;
  rangeEndStr: string;
  appliedRange: AppliedTimeRange | null;
  onDateRange: (start: string, end: string, applied: AppliedTimeRange | null) => void;
  tagFilter: TagFilterState;
  onTagFilter: (updater: (f: TagFilterState) => TagFilterState) => void;
};

export function CategoriesTab({
  batches,
  workingBatches,
  rangeStartStr,
  rangeEndStr,
  appliedRange,
  onDateRange,
  tagFilter,
  onTagFilter,
}: CategoriesTabProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const lowScoreOnly = tagFilter.lowScoreOnly;

  const series = useMemo(
    () => computeDailyAskTypeSeries(workingBatches, lowScoreOnly),
    [workingBatches, lowScoreOnly]
  );

  const overallStats = useMemo(
    () => computeAskTypeStats(workingBatches, [], lowScoreOnly),
    [workingBatches, lowScoreOnly]
  );

  useEffect(() => {
    if (!overallStats.length) {
      setSelectedType(null);
      return;
    }
    if (selectedType && overallStats.some((r) => r.tag === selectedType)) return;
    setSelectedType(overallStats[0].tag);
  }, [overallStats, selectedType]);

  const labeledTotal = useMemo(
    () => series.reduce((s, p) => s + p.labeled, 0),
    [series]
  );

  const selectedStat = overallStats.find((r) => r.tag === selectedType) ?? null;

  const countSeries = useMemo(() => {
    if (!selectedType) return [];
    return series.map((p) => ({
      ...p,
      count: p.counts[selectedType] || 0,
    }));
  }, [series, selectedType]);

  const latest = countSeries.length ? countSeries[countSeries.length - 1] : null;
  const prev = countSeries.length >= 2 ? countSeries[countSeries.length - 2] : null;
  const delta = latest != null && prev != null ? latest.count - prev.count : null;

  const chartData = useMemo(
    () => ({
      labels: countSeries.map((p) => p.label),
      datasets: [
        {
          label: selectedType ?? "",
          data: countSeries.map((p) => p.count),
          backgroundColor: BAR_COLOR,
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 48,
        },
      ],
    }),
    [countSeries, selectedType]
  );

  const options = useMemo(
    () => ({
      ...timelineChartOptions({
        yFormat: (v) => Number(v).toLocaleString(),
      }),
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
              return idx != null ? countSeries[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"bar">) => {
              const point = countSeries[ctx.dataIndex];
              if (!point) return "";
              const denom = point.total || 0;
              const pct = denom ? (100 * point.count) / denom : 0;
              return `${point.count.toLocaleString()} sessions · ${pct.toFixed(1)}% of that day`;
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
    }),
    [countSeries, selectedType]
  );

  const deltaLabel =
    delta == null
      ? ""
      : ` · ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} vs prior day`;

  return (
    <section id="categories" className="categories-view">
      <div className="kpis">
        <div className="kpi">
          <div className="label">Sessions with a category</div>
          <div className="value">{labeledTotal.toLocaleString()}</div>
        </div>
        <div className="kpi accent">
          <div className="label">Selected in range</div>
          <div className="value">{selectedStat ? selectedStat.count.toLocaleString() : "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Days with data</div>
          <div className="value">{series.length || "—"}</div>
        </div>
      </div>

      <DateRangeBar
        batches={batches}
        startStr={rangeStartStr}
        endStr={rangeEndStr}
        appliedRange={appliedRange}
        onChange={onDateRange}
      />

      <div className="filters tag-funnel-bar">
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={lowScoreOnly}
            onChange={(e) => onTagFilter((f) => ({ ...f, lowScoreOnly: e.target.checked }))}
          />
          Limit pool to score ≤ 5
        </label>
      </div>

      {!series.length ? (
        <p className="charts-scope-note">
          No learning ask type in the selected days. This field is present on newer rating files.
        </p>
      ) : (
        <>
          <div className="tag-stats-panel kind-asktype">
            <div className="tag-stats-panel-head">
              <h3>{LABELS.askType}</h3>
            </div>
            <p className="muted-inline">Select one category to view its day-by-day session count.</p>
            <div className="tag-chip-grid">
              {overallStats.map((row) => {
                const active = row.tag === selectedType;
                return (
                  <div key={row.tag} className={`tag-chip-wrap ${active ? "active-wrap" : ""}`}>
                    <button
                      type="button"
                      className={`tag-chip discovery ${active ? "active" : ""}`}
                      aria-pressed={active}
                      onClick={() => setSelectedType(row.tag)}
                      title={`${row.count.toLocaleString()} sessions`}
                    >
                      <span className="tag-chip-name">{row.tag}</span>
                      <span className="tag-chip-meta">{row.count.toLocaleString()}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedType ? (
            <div className="tl-chart-surface tl-pool-chart">
              <div className="tl-pool-chart-head">
                <div>
                  <h3 className="tl-pool-chart-title">{selectedType}</h3>
                  <p className="tl-pool-chart-sub">
                    Sessions per day
                    {selectedStat ? ` · ${selectedStat.count.toLocaleString()} in range` : ""}
                    {latest != null
                      ? ` · latest ${latest.count.toLocaleString()}${deltaLabel}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="tl-chart-canvas">
                <Bar data={chartData} options={options} />
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
