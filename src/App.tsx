import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { LoadedBatch, RatingRow, TagFilterState, TagKind, TagStatRow } from "./parsing";
import {
  createBatch,
  defaultTagFilter,
  filterRows,
  filterRowsByTags,
  computeExclusiveTagStats,
  excludeErrorSessions,
  batchesExcludingErrors,
  isErrorSession,
  isLowRated,
  mergeAndDedupeByChatbotSid,
  normalizeRowsFromCsv,
  normalizeRowsFromHtml,
  parseSessionTime,
  setDatetimeLocalValue,
} from "./parsing";
import { computeBatchSummary } from "./analytics";
import { horizontalPctBarOptions, pctBarLabelPlugin } from "./chartTheme";
import { KindBadge } from "./components/KindBadge";
import { LABELS } from "./labels";
import { TimelineTab } from "./components/TimelineTab";
import { FunnelTab } from "./components/FunnelTab";
import { HtmlViewerTab } from "./components/HtmlViewerTab";
import { LowRatedDailyChart } from "./components/LowRatedDailyChart";
import { loadReleaseMarkers } from "./releaseMarkers";
import {
  loadChangePointBatchId,
  resolveChangePointBatchId,
  saveChangePointBatchId,
} from "./changePoint";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type TabId = "overview" | "timeline" | "funnel" | "htmlviewer";

function toggleInList(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];
}

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
  kind: "qa" | "discovery";
  onClick: () => void;
  onTimeline?: () => void;
}) {
  return (
    <div className={`tag-chip-wrap ${active ? "active-wrap" : ""}`}>
      <button
        type="button"
        className={`tag-chip ${kind} ${active ? "active" : ""}`}
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
  onTimeline: (tag: string, kind: TagKind) => void;
  kind: "qa" | "discovery";
  showTimeline: boolean;
}) {
  if (!rows.length) {
    return (
      <div className={`tag-stats-panel kind-${kind === "discovery" ? "categories" : "tags"}`}>
        <div className="tag-stats-panel-head">
          <h3>{title}</h3>
          <KindBadge kind={kind} />
        </div>
        <p className="muted-inline">
          No {kind === "discovery" ? LABELS.categories.toLowerCase() : LABELS.tags.toLowerCase()} in {poolLabel}.
        </p>
      </div>
    );
  }
  return (
    <div className={`tag-stats-panel kind-${kind === "discovery" ? "categories" : "tags"}`}>
      <div className="tag-stats-panel-head">
        <h3>{title}</h3>
        <KindBadge kind={kind} />
      </div>
      <p className="muted-inline">
        Click to filter sessions{showTimeline ? " · Trend for day-wise chart" : ""}. Pool: {poolLabel}.
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
      <details className="collapse-table-drawer">
        <summary>Table view ({rows.length} rows)</summary>
        <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
          <table className="tag-table compact">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Count</th>
                <th>% pool</th>
                {showTimeline ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((row) => (
                <tr
                  key={row.tag}
                  className={selected.includes(row.tag) ? "row-selected" : "row-clickable"}
                  onClick={() => onToggle(row.tag)}
                >
                  <td>{row.tag}</td>
                  <td>{row.count}</td>
                  <td>{row.pctOfPool.toFixed(1)}%</td>
                  {showTimeline ? (
                    <td>
                      <button
                        type="button"
                        className="table-timeline-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTimeline(row.tag, kind);
                        }}
                      >
                        Trend
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function App() {
  const [batches, setBatches] = useState<LoadedBatch[]>([]);
  const [rawRows, setRawRows] = useState<RatingRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [rangeStartStr, setRangeStartStr] = useState("");
  const [rangeEndStr, setRangeEndStr] = useState("");
  const [appliedRange, setAppliedRange] = useState<{
    start: Date | null;
    end: Date | null;
  } | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilterState>(defaultTagFilter());
  const [excludeErrors, setExcludeErrors] = useState(true);
  const [htmlSources, setHtmlSources] = useState<{ name: string; text: string }[]>([]);
  const [status, setStatus] = useState("");
  const [showHtmlWarn, setShowHtmlWarn] = useState(false);
  const [timelineFocusTag, setTimelineFocusTag] = useState<{ tag: string; kind: TagKind } | null>(null);
  const [changePointBatchId, setChangePointBatchId] = useState<string | null>(() =>
    loadChangePointBatchId()
  );

  const batchSummary = useMemo(() => computeBatchSummary(batches), [batches]);
  const showTimeline = batches.length >= 1;

  const timeFilteredRows = useMemo(() => {
    if (appliedRange === null) return rawRows;
    return filterRows(rawRows, appliedRange.start, appliedRange.end);
  }, [rawRows, appliedRange]);

  const errorSessionCount = useMemo(
    () => timeFilteredRows.filter(isErrorSession).length,
    [timeFilteredRows]
  );

  const baseRows = useMemo(() => {
    if (!excludeErrors) return timeFilteredRows;
    return excludeErrorSessions(timeFilteredRows);
  }, [timeFilteredRows, excludeErrors]);

  const workingBatches = useMemo(() => {
    if (!excludeErrors) return batches;
    return batchesExcludingErrors(batches);
  }, [batches, excludeErrors]);

  const sortedWorkingBatches = useMemo(
    () =>
      [...workingBatches].sort(
        (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
      ),
    [workingBatches]
  );

  const releaseMarkers = useMemo(() => loadReleaseMarkers(), []);

  useEffect(() => {
    const ids = sortedWorkingBatches.map((b) => b.id);
    const markerIds = releaseMarkers.map((m) => m.batchId);
    setChangePointBatchId((prev) => resolveChangePointBatchId(ids, prev, markerIds));
  }, [sortedWorkingBatches, releaseMarkers]);

  useEffect(() => {
    saveChangePointBatchId(changePointBatchId);
  }, [changePointBatchId]);

  const analyticsPool = useMemo(() => {
    if (tagFilter.lowScoreOnly) return baseRows.filter(isLowRated);
    return baseRows;
  }, [baseRows, tagFilter.lowScoreOnly]);

  const funnelRows = useMemo(
    () => filterRowsByTags(analyticsPool, tagFilter),
    [analyticsPool, tagFilter]
  );

  const stats = useMemo(() => {
    const total = baseRows.length;
    const pool = analyticsPool;
    const funnel = funnelRows;
    const poolN = pool.length;
    const funnelN = funnel.length;

    const overallScores = funnel.map((r) => r.overall_score).filter(Number.isFinite);
    const avgOverall = overallScores.length
      ? (overallScores.reduce((a, b) => a + b, 0) / overallScores.length).toFixed(2)
      : "—";

    const qaTagStats = computeExclusiveTagStats(funnel, "qa", total);
    const discoveryTagStats = computeExclusiveTagStats(funnel, "discovery", total);
    const poolLabel = tagFilter.lowScoreOnly ? "≤5-rated pool" : "all sessions";

    return {
      total,
      poolN,
      funnelN,
      avgOverall,
      qaTagStats,
      discoveryTagStats,
      poolLabel,
    };
  }, [baseRows, analyticsPool, funnelRows, tagFilter.lowScoreOnly]);

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

  const discoveryChartData = useMemo(() => {
    const top = stats.discoveryTagStats.slice(0, 12);
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
  }, [stats.discoveryTagStats]);

  const tagsBarOptions = useMemo(() => horizontalPctBarOptions(), []);

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsText(file);
    });

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    let anyLargeHtml = false;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = (f.name || "").toLowerCase();
      if ((name.endsWith(".html") || f.type === "text/html") && f.size > 2 * 1024 * 1024) {
        anyLargeHtml = true;
      }
    }
    setShowHtmlWarn(anyLargeHtml);
    setStatus("Loading…");

    (async () => {
      try {
        const newBatches: LoadedBatch[] = [];
        const combined: RatingRow[] = [];
        const newHtmlSources: { name: string; text: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const name = (file.name || "").toLowerCase();
          const isHtml = name.endsWith(".html") || file.type === "text/html";
          const text = await readFileAsText(file);
          if (isHtml) newHtmlSources.push({ name: file.name, text });
          const rows = isHtml
            ? normalizeRowsFromHtml(text)
            : normalizeRowsFromCsv(
                Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data
              );
          const batch = createBatch(file.name, rows);
          newBatches.push(batch);
          combined.push(...batch.rows);
        }
        const before = combined.length;
        const merged = mergeAndDedupeByChatbotSid(combined);
        setHtmlSources(newHtmlSources);
        setBatches(newBatches);
        setRawRows(merged);
        setAppliedRange(null);
        setTagFilter(defaultTagFilter());
        setTimelineFocusTag(null);
        setStatus(
          `Loaded ${files.length} file(s) → ${before} sessions → ${merged.length} unique across ${newBatches.length} period(s).`
        );
        const times = merged.map((r) => parseSessionTime(r.time)).filter(Boolean) as Date[];
        if (times.length) {
          setRangeStartStr(setDatetimeLocalValue(new Date(Math.min(...times.map((d) => d.getTime())))));
          setRangeEndStr(setDatetimeLocalValue(new Date(Math.max(...times.map((d) => d.getTime())))));
        } else {
          setRangeStartStr("");
          setRangeEndStr("");
        }
      } catch (err) {
        console.error(err);
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, []);

  const appendFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setStatus("Appending…");

    (async () => {
      try {
        const addedBatches: LoadedBatch[] = [];
        const addedRows: RatingRow[] = [];
        const addedHtmlSources: { name: string; text: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const name = (file.name || "").toLowerCase();
          const isHtml = name.endsWith(".html") || file.type === "text/html";
          const text = await readFileAsText(file);
          if (isHtml) addedHtmlSources.push({ name: file.name, text });
          const rows = isHtml
            ? normalizeRowsFromHtml(text)
            : normalizeRowsFromCsv(
                Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data
              );
          const batch = createBatch(file.name, rows);
          addedBatches.push(batch);
          addedRows.push(...batch.rows);
        }
        setHtmlSources((prev) => [...prev, ...addedHtmlSources]);
        setBatches((prev) => [...prev, ...addedBatches]);
        setRawRows((prev) => mergeAndDedupeByChatbotSid([...prev, ...addedRows]));
        setStatus(`Added ${files.length} file(s) · ${addedBatches.length} new period(s).`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, []);

  const applyRange = useCallback(() => {
    setAppliedRange({
      start: rangeStartStr ? new Date(rangeStartStr) : null,
      end: rangeEndStr ? new Date(rangeEndStr) : null,
    });
  }, [rangeStartStr, rangeEndStr]);

  const clearRange = useCallback(() => {
    setRangeStartStr("");
    setRangeEndStr("");
    setAppliedRange(null);
  }, []);

  const toggleQaTag = useCallback((tag: string) => {
    setTagFilter((f) => ({ ...f, qaTags: toggleInList(f.qaTags, tag) }));
  }, []);

  const toggleDiscoveryTag = useCallback((tag: string) => {
    setTagFilter((f) => ({ ...f, discoveryTags: toggleInList(f.discoveryTags, tag) }));
  }, []);

  const clearTagFilter = useCallback(() => {
    setTagFilter((f) => ({ ...f, qaTags: [], discoveryTags: [] }));
  }, []);

  const openTimeline = useCallback((tag: string, kind: TagKind) => {
    setTimelineFocusTag({ tag, kind });
    setActiveTab("timeline");
  }, []);

  const hasData = rawRows.length > 0;
  const activeFilterCount = tagFilter.qaTags.length + tagFilter.discoveryTags.length;

  const tabs: { id: TabId; label: string; desc: string; badge?: string }[] = [
    { id: "overview", label: "Overview", desc: "KPIs, charts & sessions" },
    { id: "timeline", label: "Timeline", desc: "Pick a tag → day-wise % trend", badge: batches.length > 1 ? `${batches.length} days` : undefined },
    { id: "funnel", label: "Funnel", desc: "Narrow by tags & categories" },
    { id: "htmlviewer", label: "Report viewer", desc: "Browse large report HTML, paginated" },
  ];

  return (
    <>
      <header>
        <h1>Conversation rating dashboard</h1>
        <p>
          Upload rating report HTML or CSV files — one per day works best for timeline charts.
          Sessions are tagged with <strong>{LABELS.tags.toLowerCase()}</strong> (issues) and{" "}
          <strong>{LABELS.categories.toLowerCase()}</strong> (conversation types).
        </p>
      </header>
      <main>
        <div className="upload-zone">
          <label className="file-btn" htmlFor="file-input">
            Choose CSV or HTML (multiple)
          </label>
          <input id="file-input" type="file" accept=".csv,.html,text/html,text/csv" multiple onChange={onFile} />
          {hasData ? (
            <>
              <label className="file-btn secondary" htmlFor="append-input">
                Add more periods
              </label>
              <input id="append-input" type="file" accept=".csv,.html,text/html,text/csv" multiple onChange={appendFiles} />
            </>
          ) : null}
          <p className="hint">
            Tip: upload one file per calendar day or rating run — each file becomes a timeline period.
          </p>
          <div className={`warn-banner ${showHtmlWarn ? "visible" : ""}`}>
            Large HTML files can make the tab hang briefly while parsing.
          </div>
        </div>
        {status ? <div className="status-line">{status}</div> : null}

        {batches.length > 0 ? (
          <div className="batch-summary-bar">
            <span>
              <strong>{batchSummary.batchCount}</strong> period(s) ·{" "}
              <strong>{batchSummary.totalSessions}</strong> total sessions
            </span>
            {batchSummary.periodRange !== "—" ? (
              <span className="batch-range">{batchSummary.periodRange}</span>
            ) : null}
          </div>
        ) : null}

        <nav className="tab-bar" role="tablist" aria-label="Dashboard sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-btn-label">{tab.label}</span>
              <span className="tab-btn-desc">{tab.desc}</span>
              {tab.badge ? <span className="tab-badge">{tab.badge}</span> : null}
            </button>
          ))}
        </nav>

        {activeTab === "htmlviewer" ? (
          <div className="tab-content">
            <HtmlViewerTab sharedSources={htmlSources} />
          </div>
        ) : hasData ? (
          <>
            <div className="global-filters-bar">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={excludeErrors}
                  onChange={(e) => setExcludeErrors(e.target.checked)}
                />
                Exclude sessions tagged <strong>Error</strong> (failed LLM rating)
              </label>
              {excludeErrors && errorSessionCount > 0 ? (
                <span className="global-filter-note">
                  {errorSessionCount} session{errorSessionCount === 1 ? "" : "s"} hidden across all tabs
                </span>
              ) : null}
            </div>

            <div className="tab-content">
            {activeTab === "overview" ? (
              <section id="dashboard">
                <div className="kpis">
                  <div className="kpi">
                    <div className="label">Total sessions</div>
                    <div className="value">{stats.total}</div>
                  </div>
                  <div className="kpi accent">
                    <div className="label">After filters</div>
                    <div className="value">{stats.funnelN}</div>
                  </div>
                  <div className="kpi ok">
                    <div className="label">Avg overall (filtered)</div>
                    <div className="value">{stats.avgOverall}</div>
                  </div>
                  {batches.length > 1 ? (
                    <div className="kpi accent">
                      <div className="label">Timeline periods</div>
                      <div className="value">{batches.length}</div>
                    </div>
                  ) : null}
                </div>

                <div className="filters">
                  <label>
                    Start (session time)
                    <input type="datetime-local" value={rangeStartStr} onChange={(e) => setRangeStartStr(e.target.value)} />
                  </label>
                  <label>
                    End (session time)
                    <input type="datetime-local" value={rangeEndStr} onChange={(e) => setRangeEndStr(e.target.value)} />
                  </label>
                  <button type="button" onClick={applyRange}>
                    Apply range
                  </button>
                  <button type="button" onClick={clearRange}>
                    Clear range
                  </button>
                </div>

                <div className="filters tag-funnel-bar">
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={tagFilter.lowScoreOnly}
                      onChange={(e) => setTagFilter((f) => ({ ...f, lowScoreOnly: e.target.checked }))}
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
                        setTagFilter((f) => ({
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
                        setTagFilter((f) => ({
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
                      ({tagFilter.funnelOrder === "categories-first"
                        ? `${LABELS.categories} → ${LABELS.tags}`
                        : `${LABELS.tags} → ${LABELS.categories}`}
                      )
                    </span>
                    {(tagFilter.funnelOrder === "categories-first"
                      ? [
                          ...tagFilter.discoveryTags.map((t) => ({ t, kind: "category" as const })),
                          ...tagFilter.qaTags.map((t) => ({ t, kind: "tag" as const })),
                        ]
                      : [
                          ...tagFilter.qaTags.map((t) => ({ t, kind: "tag" as const })),
                          ...tagFilter.discoveryTags.map((t) => ({ t, kind: "category" as const })),
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
                          onClick={() =>
                            kind === "category" ? toggleDiscoveryTag(t) : toggleQaTag(t)
                          }
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
                      → <strong>{stats.funnelN}</strong> session(s) after {LABELS.tags.toLowerCase()} &amp;{" "}
                      {LABELS.categories.toLowerCase()} filters ({tagFilter.matchMode === "all" ? "AND" : "OR"}).
                    </>
                  ) : (
                    <> ({stats.poolN} sessions).</>
                  )}
                </p>

                {workingBatches.length >= 1 ? (
                  <LowRatedDailyChart
                    batches={workingBatches}
                    releaseMarkers={releaseMarkers}
                    compact={workingBatches.length === 1}
                    changePointBatchId={changePointBatchId}
                    onSelectChangePoint={setChangePointBatchId}
                  />
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
                    <Bar data={discoveryChartData} options={tagsBarOptions} plugins={[pctBarLabelPlugin]} />
                  </div>
                </div>

                <div className="tag-funnel-grid">
                  <TagStatsTable
                    title={`${LABELS.tags} — occurrence`}
                    rows={computeExclusiveTagStats(analyticsPool, "qa", stats.total)}
                    poolLabel={stats.poolLabel}
                    selected={tagFilter.qaTags}
                    onToggle={toggleQaTag}
                    onTimeline={openTimeline}
                    kind="qa"
                    showTimeline={showTimeline}
                  />
                  <TagStatsTable
                    title={`${LABELS.categories} — occurrence`}
                    rows={computeExclusiveTagStats(analyticsPool, "discovery", stats.total)}
                    poolLabel={stats.poolLabel}
                    selected={tagFilter.discoveryTags}
                    onToggle={toggleDiscoveryTag}
                    onTimeline={openTimeline}
                    kind="discovery"
                    showTimeline={showTimeline}
                  />
                </div>

                <details className="collapse-table-drawer session-drawer">
                  <summary>
                    Session list ({stats.funnelN}) — click chips above to filter
                  </summary>
                  <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                    <table className="tag-table session-table">
                      <thead>
                        <tr>
                          <th>Chatbot SID</th>
                          <th>Score</th>
                          <th>Axes</th>
                          <th>{LABELS.tags}</th>
                          <th>{LABELS.categories}</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {funnelRows
                          .slice()
                          .sort((a, b) => a.overall_score - b.overall_score)
                          .map((r) => (
                            <tr key={r.chatbot_sid || `${r.time}-${r.overall_score}`}>
                              <td className="mono">{r.chatbot_sid || "—"}</td>
                              <td>{Number.isFinite(r.overall_score) ? r.overall_score.toFixed(2) : "—"}</td>
                              <td className="axes">
                                {Number.isFinite(r.axis1) ? r.axis1 : "—"}/
                                {Number.isFinite(r.axis2) ? r.axis2 : "—"}/
                                {Number.isFinite(r.axis3) ? r.axis3 : "—"}
                              </td>
                              <td>
                                <div className="mini-tags">
                                  {r.qaTags.map((t) => (
                                    <span
                                      key={t}
                                      className={`mini-tag qa ${tagFilter.qaTags.includes(t) ? "hit" : ""}`}
                                      onClick={() => toggleQaTag(t)}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => e.key === "Enter" && toggleQaTag(t)}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>
                                <div className="mini-tags">
                                  {r.discoveryTags.map((t) => (
                                    <span
                                      key={t}
                                      className={`mini-tag discovery ${tagFilter.discoveryTags.includes(t) ? "hit" : ""}`}
                                      onClick={() => toggleDiscoveryTag(t)}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => e.key === "Enter" && toggleDiscoveryTag(t)}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="time-cell">{r.time || "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            ) : null}

            {activeTab === "timeline" ? (
              <TimelineTab
                batches={workingBatches}
                lowScoreOnly={tagFilter.lowScoreOnly}
                initialTag={timelineFocusTag}
              />
            ) : null}

            {activeTab === "funnel" ? (
              <FunnelTab
                pool={analyticsPool}
                totalCount={stats.total}
                tagFilter={tagFilter}
                onUpdateFilter={setTagFilter}
                poolLabel={stats.poolLabel}
              />
            ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state">Upload a rating report or CSV to explore tags and categories.</div>
        )}
      </main>
    </>
  );
}
