import { memo, useMemo } from "react";
import { Bar } from "react-chartjs-2";
import type { LoadedBatch, PickableTagKind, RatingRow, TagFilterState, TagStatRow } from "../parsing";
import type { AppliedTimeRange } from "../parsing";
import { horizontalPctBarOptions, pctBarLabelPlugin } from "../chartTheme";
import { LABELS } from "../labels";
import { KindBadge } from "./KindBadge";
import { DateRangeBar } from "./DateRangeBar";
import { LowRatedDailyChart } from "./LowRatedDailyChart";
import { AvgTurnsDailyChart } from "./AvgTurnsDailyChart";
import { LowRatedTrendChart } from "./LowRatedTrendChart";
import { CappedSessionTable } from "./CappedSessionTable";
import type { ReleaseMarker } from "../releaseMarkers";

function TagChip({
  tag,
  count,
  pct,
  active,
  kind,
  onClick,
  onTimeline,
}: {
  tag: string;
  count: number;
  pct: string;
  active: boolean;
  kind: PickableTagKind;
  onClick: () => void;
  onTimeline?: () => void;
}) {
  const chipClass = kind === "category" ? "discovery" : kind;
  return (
    <div className={`tag-chip-wrap ${active ? "active-wrap" : ""}`}>
      <button
        type="button"
        className={`tag-chip ${chipClass} ${active ? "active" : ""}`}
        onClick={onClick}
        title={`${count} sessions (${pct}% of pool)`}
      >
        <span className="tag-chip-name">{tag}</span>
        <span className="tag-chip-meta">
          {count} · {pct}%
        </span>
      </button>
      {onTimeline ? (
        <button
          type="button"
          className="tag-timeline-btn"
          onClick={(e) => {
            e.stopPropagation();
            onTimeline();
          }}
          title="View day-wise trend"
          aria-label={`Timeline for ${tag}`}
        >
          Trend
        </button>
      ) : null}
    </div>
  );
}

function panelKindClass(kind: PickableTagKind): string {
  return kind === "category" ? "categories" : "tags";
}

function TagStatsTable({
  title,
  rows,
  poolLabel,
  selected,
  onToggle,
  onTimeline,
  kind,
  showTimeline,
}: {
  title: string;
  rows: TagStatRow[];
  poolLabel: string;
  selected: string[];
  onToggle: (tag: string) => void;
  onTimeline: (tag: string, kind: PickableTagKind) => void;
  kind: PickableTagKind;
  showTimeline: boolean;
}) {
  const kindName =
    kind === "category" ? LABELS.categories.toLowerCase() : LABELS.tags.toLowerCase();

  if (!rows.length) {
    return (
      <div className={`tag-stats-panel kind-${panelKindClass(kind)}`}>
        <div className="tag-stats-panel-head">
          <h3>{title}</h3>
          <KindBadge kind={kind} />
        </div>
        <p className="muted-inline">
          No {kindName} in {poolLabel}.
        </p>
      </div>
    );
  }
  return (
    <div className={`tag-stats-panel kind-${panelKindClass(kind)}`}>
      <div className="tag-stats-panel-head">
        <h3>{title}</h3>
        <KindBadge kind={kind} />
      </div>
      <p className="muted-inline">
        Click to filter sessions{showTimeline ? " · Trend for period-wise chart" : ""}. Pool: {poolLabel}.
      </p>
      <div className="tag-chip-grid">
        {rows.map((row) => (
          <TagChip
            key={row.tag}
            tag={row.tag}
            count={row.count}
            pct={row.pctOfPool.toFixed(1)}
            active={selected.includes(row.tag)}
            kind={kind}
            onClick={() => onToggle(row.tag)}
            onTimeline={showTimeline ? () => onTimeline(row.tag, kind) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export type OverviewStats = {
  total: number;
  poolN: number;
  funnelN: number;
  avgOverall: string;
  avgTurns: string;
  poolLabel: string;
  qaTagStats: TagStatRow[];
  categoryTagStats: TagStatRow[];
};

type OverviewTabProps = {
  batches: LoadedBatch[];
  workingBatches: LoadedBatch[];
  rangeBatchCount: number;
  stats: OverviewStats;
  funnelRows: RatingRow[];
  tagFilter: TagFilterState;
  rangeStartStr: string;
  rangeEndStr: string;
  appliedRange: AppliedTimeRange | null;
  onDateRange: (start: string, end: string, applied: AppliedTimeRange | null) => void;
  onTagFilter: (updater: (f: TagFilterState) => TagFilterState) => void;
  toggleQaTag: (tag: string) => void;
  toggleCategoryTag: (tag: string) => void;
  clearTagFilter: () => void;
  openTimeline: (tag: string, kind: PickableTagKind) => void;
  showTimeline: boolean;
  releaseMarkers: ReleaseMarker[];
  sessionsLoading: boolean;
  sessionsNote?: string;
};

export const OverviewTab = memo(function OverviewTab({
  batches,
  workingBatches,
  rangeBatchCount,
  stats,
  funnelRows,
  tagFilter,
  rangeStartStr,
  rangeEndStr,
  appliedRange,
  onDateRange,
  onTagFilter,
  toggleQaTag,
  toggleCategoryTag,
  clearTagFilter,
  openTimeline,
  showTimeline,
  releaseMarkers,
  sessionsLoading,
  sessionsNote,
}: OverviewTabProps) {
  const activeFilterCount = tagFilter.qaTags.length + tagFilter.categoryTags.length;

  const qaChipRows = useMemo(
    () => stats.qaTagStats,
    [stats.qaTagStats]
  );
  const catChipRows = useMemo(
    () => stats.categoryTagStats,
    [stats.categoryTagStats]
  );

  const qaChartData = useMemo(() => {
    const top = stats.qaTagStats.slice(0, 12);
    return {
      labels: top.map((r) => (r.tag.length > 36 ? `${r.tag.slice(0, 33)}…` : r.tag)),
      datasets: [
        {
          label: "% of filtered pool",
          data: top.map((r) => r.pctOfPool),
          backgroundColor: "rgba(61, 139, 253, 0.85)",
          showPctLabels: true,
        },
      ],
    };
  }, [stats.qaTagStats]);

  const categoryChartData = useMemo(() => {
    const top = stats.categoryTagStats.slice(0, 12);
    return {
      labels: top.map((r) => (r.tag.length > 36 ? `${r.tag.slice(0, 33)}…` : r.tag)),
      datasets: [
        {
          label: "% of filtered pool",
          data: top.map((r) => r.pctOfPool),
          backgroundColor: "rgba(142, 68, 173, 0.85)",
          showPctLabels: true,
        },
      ],
    };
  }, [stats.categoryTagStats]);

  const tagsBarOptions = useMemo(() => horizontalPctBarOptions(), []);

  return (
    <section id="dashboard">
      <div className="kpis">
        <div className="kpi">
          <div className="label">Total sessions</div>
          <div className="value">{stats.total.toLocaleString()}</div>
        </div>
        <div className="kpi accent">
          <div className="label">After filters</div>
          <div className="value">{stats.funnelN.toLocaleString()}</div>
        </div>
        <div className="kpi ok">
          <div className="label">Avg rated ≤ 5 score</div>
          <div className="value">{stats.avgOverall}</div>
        </div>
        <div className="kpi">
          <div className="label">Avg conversation length</div>
          <div className="value">{stats.avgTurns}</div>
        </div>
        {rangeBatchCount > 1 ? (
          <div className="kpi accent">
            <div className="label">Days included</div>
            <div className="value">{rangeBatchCount}</div>
          </div>
        ) : null}
      </div>

      <DateRangeBar
        batches={batches}
        startStr={rangeStartStr}
        endStr={rangeEndStr}
        appliedRange={appliedRange}
        onChange={onDateRange}
      />

      {sessionsNote ? <p className="charts-scope-note">{sessionsNote}</p> : null}
      {sessionsLoading ? <p className="status-line">Loading session rows for the selected days…</p> : null}

      <div className="filters tag-funnel-bar">
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={tagFilter.lowScoreOnly}
            onChange={(e) => onTagFilter((f) => ({ ...f, lowScoreOnly: e.target.checked }))}
          />
          Limit pool to score ≤ 5
        </label>
        <label>
          Max overall score
          <input
            type="number"
            min={1}
            max={10}
            step={0.1}
            placeholder="any"
            value={tagFilter.maxScore ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              onTagFilter((f) => ({
                ...f,
                maxScore: v === "" ? null : parseFloat(v),
              }));
            }}
          />
        </label>
        <label>
          Tag match
          <select
            value={tagFilter.matchMode}
            onChange={(e) =>
              onTagFilter((f) => ({
                ...f,
                matchMode: e.target.value as "all" | "any",
              }))
            }
          >
            <option value="all">All selected (AND)</option>
            <option value="any">Any selected (OR)</option>
          </select>
        </label>
        {activeFilterCount > 0 ? (
          <button type="button" className="btn-clear-tags" onClick={clearTagFilter}>
            Clear {activeFilterCount} tag filter(s)
          </button>
        ) : null}
      </div>

      {activeFilterCount > 0 ? (
        <div className="active-filters">
          <strong>Active filters</strong>
          <span className="active-filters-order">
            (
            {tagFilter.funnelOrder === "categories-first"
              ? `${LABELS.categories} → ${LABELS.tags}`
              : `${LABELS.tags} → ${LABELS.categories}`}
            )
          </span>
          {(tagFilter.funnelOrder === "categories-first"
            ? [
                ...tagFilter.categoryTags.map((t) => ({ t, kind: "category" as const })),
                ...tagFilter.qaTags.map((t) => ({ t, kind: "tag" as const })),
              ]
            : [
                ...tagFilter.qaTags.map((t) => ({ t, kind: "tag" as const })),
                ...tagFilter.categoryTags.map((t) => ({ t, kind: "category" as const })),
              ]
          ).map(({ t, kind }, i) => (
            <span key={`${kind}-${t}`} className={`filter-pill ${kind}`}>
              <span className="filter-pill-step">#{i + 1}</span>
              <span className="filter-pill-kind">
                {kind === "category" ? LABELS.categories : LABELS.tags}
              </span>
              {t}
              <button
                type="button"
                onClick={() => (kind === "category" ? toggleCategoryTag(t) : toggleQaTag(t))}
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <p className="charts-scope-note">
        Tag counts use the <strong>{stats.poolLabel}</strong>
        {activeFilterCount ? (
          <>
            {" "}
            → <strong>{stats.funnelN.toLocaleString()}</strong> session(s) after {LABELS.tags.toLowerCase()}{" "}
            &amp; {LABELS.categories.toLowerCase()} filters ({tagFilter.matchMode === "all" ? "AND" : "OR"}).
          </>
        ) : (
          <> ({stats.poolN.toLocaleString()} sessions).</>
        )}
      </p>

      {workingBatches.length >= 1 ? (
        <LowRatedDailyChart
          batches={workingBatches}
          releaseMarkers={releaseMarkers}
          compact={workingBatches.length === 1}
        />
      ) : null}

      {workingBatches.length >= 1 ? (
        <LowRatedTrendChart batches={workingBatches} compact={workingBatches.length === 1} />
      ) : null}

      {workingBatches.length >= 1 ? (
        <AvgTurnsDailyChart batches={workingBatches} compact={workingBatches.length === 1} />
      ) : null}

      <div className="charts-grid">
        <div className="chart-card full-width">
          <h2>
            {LABELS.tags}
            <span className="sub">% of filtered pool (top 12)</span>
          </h2>
          <Bar data={qaChartData} options={tagsBarOptions} plugins={[pctBarLabelPlugin]} />
        </div>
        <div className="chart-card full-width">
          <h2>
            {LABELS.categories}
            <span className="sub">% of filtered pool (top 12)</span>
          </h2>
          <Bar data={categoryChartData} options={tagsBarOptions} plugins={[pctBarLabelPlugin]} />
        </div>
      </div>

      <div className="tag-funnel-grid">
        <TagStatsTable
          title={`${LABELS.tags} — occurrence`}
          rows={qaChipRows}
          poolLabel={stats.poolLabel}
          selected={tagFilter.qaTags}
          onToggle={toggleQaTag}
          onTimeline={openTimeline}
          kind="qa"
          showTimeline={showTimeline}
        />
        <TagStatsTable
          title={`${LABELS.categories} — occurrence`}
          rows={catChipRows}
          poolLabel={stats.poolLabel}
          selected={tagFilter.categoryTags}
          onToggle={toggleCategoryTag}
          onTimeline={openTimeline}
          kind="category"
          showTimeline={showTimeline}
        />
      </div>

      <CappedSessionTable
        rows={funnelRows}
        qaSelected={tagFilter.qaTags}
        categorySelected={tagFilter.categoryTags}
        onToggleQa={toggleQaTag}
        onToggleCategory={toggleCategoryTag}
      />
    </section>
  );
});
