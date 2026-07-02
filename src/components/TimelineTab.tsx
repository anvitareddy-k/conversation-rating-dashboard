import { useEffect, useMemo, useRef, useState } from "react";
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
  type TooltipItem,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import {
  computeTimelineReleaseOverlays,
  computeTagTimeline,
  computeTagTrends,
  topTagsAcrossBatches,
} from "../analytics";
import { CHART, timelineChartOptions } from "../chartTheme";
import { LABELS } from "../labels";
import type { LoadedBatch, TagKind } from "../parsing";
import {
  createReleaseMarker,
  loadReleaseMarkers,
  saveReleaseMarkers,
  type ReleaseMarker,
} from "../releaseMarkers";
import { createReleaseMarkerPlugin } from "../releaseMarkerPlugin";
import { computeTimelineInsights } from "../timelineInsights";
import {
  loadChangePointBatchId,
  resolveChangePointBatchId,
  saveChangePointBatchId,
} from "../changePoint";
import { getTagDescriptionOrDefault } from "../tagDefinitions";
import { SignificantChangesPanel } from "./SignificantChangesPanel";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

type ChartView = "line" | "bar";

type OverlaySelection = { tag: string; kind: TagKind } | null;

const OVERLAY_LINE_COLOR = "#059669";

function colorForTagKind(kind: TagKind): string {
  return kind === "discovery" ? "#7c3aed" : CHART.accent;
}

function kindShortLabel(kind: TagKind): string {
  return kind === "discovery" ? LABELS.categories : LABELS.tags;
}

type TimelineTabProps = {
  batches: LoadedBatch[];
  lowScoreOnly: boolean;
  initialTag?: { tag: string; kind: TagKind } | null;
};

function deltaArrow(delta: number): string {
  if (Math.abs(delta) < 0.05) return "→";
  return delta > 0 ? "↑" : "↓";
}

export function TimelineTab({
  batches,
  lowScoreOnly,
  initialTag,
}: TimelineTabProps) {
  const [tagKind, setTagKind] = useState<"qa" | "discovery">(
    initialTag?.kind === "discovery" ? "discovery" : "qa"
  );
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag?.tag ?? null);
  const [tagSearch, setTagSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [chartView, setChartView] = useState<ChartView>("line");
  const [releaseMarkers, setReleaseMarkers] = useState<ReleaseMarker[]>(() => loadReleaseMarkers());
  const [newReleaseLabel, setNewReleaseLabel] = useState("");
  const [newReleaseBatchId, setNewReleaseBatchId] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [changePointBatchId, setChangePointBatchId] = useState<string | null>(() =>
    loadChangePointBatchId()
  );
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlaySelection>(null);
  const [overlayPickerOpen, setOverlayPickerOpen] = useState(false);
  const [overlaySearch, setOverlaySearch] = useState("");
  const [overlayKind, setOverlayKind] = useState<"qa" | "discovery">("discovery");
  const pickerRef = useRef<HTMLDivElement>(null);
  const overlayPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveReleaseMarkers(releaseMarkers);
  }, [releaseMarkers]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(t)) {
        setTagPickerOpen(false);
      }
      if (overlayPickerRef.current && !overlayPickerRef.current.contains(t)) {
        setOverlayPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const tagStats = useMemo(
    () =>
      topTagsAcrossBatches(
        batches,
        tagKind === "qa" ? (r) => r.qaTags : (r) => r.discoveryTags,
        lowScoreOnly
      ),
    [batches, tagKind, lowScoreOnly]
  );

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const list = q ? tagStats.filter((r) => r.tag.toLowerCase().includes(q)) : tagStats;
    return list.slice(0, 40);
  }, [tagStats, tagSearch]);

  const overlayTagStats = useMemo(
    () =>
      topTagsAcrossBatches(
        batches,
        overlayKind === "qa" ? (r) => r.qaTags : (r) => r.discoveryTags,
        lowScoreOnly
      ),
    [batches, overlayKind, lowScoreOnly]
  );

  const filteredOverlayTags = useMemo(() => {
    const q = overlaySearch.trim().toLowerCase();
    const list = q
      ? overlayTagStats.filter((r) => r.tag.toLowerCase().includes(q))
      : overlayTagStats;
    return list
      .filter((r) => !(r.tag === selectedTag && overlayKind === tagKind))
      .slice(0, 40);
  }, [overlayTagStats, overlaySearch, selectedTag, overlayKind, tagKind]);

  const trends = useMemo(
    () => computeTagTrends(batches, tagStats, tagKind, lowScoreOnly),
    [batches, tagStats, tagKind, lowScoreOnly]
  );

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
      ),
    [batches]
  );

  useEffect(() => {
    const ids = sortedBatches.map((b) => b.id);
    const markerIds = releaseMarkers.map((m) => m.batchId);
    setChangePointBatchId((prev) => resolveChangePointBatchId(ids, prev, markerIds));
  }, [sortedBatches, releaseMarkers]);

  useEffect(() => {
    saveChangePointBatchId(changePointBatchId);
  }, [changePointBatchId]);

  useEffect(() => {
    setSelectedReleaseId((prev) => {
      if (!releaseMarkers.length) return null;
      if (prev && releaseMarkers.some((m) => m.id === prev)) return prev;
      return releaseMarkers[0].id;
    });
  }, [releaseMarkers]);

  useEffect(() => {
    if (selectedTag && tagStats.some((r) => r.tag === selectedTag)) return;
    if (tagStats.length > 0) setSelectedTag(tagStats[0].tag);
  }, [tagStats, selectedTag]);

  useEffect(() => {
    if (initialTag) {
      setSelectedTag(initialTag.tag);
      setTagKind(initialTag.kind === "discovery" ? "discovery" : "qa");
    }
  }, [initialTag]);

  const timeline = useMemo(() => {
    if (!selectedTag) return [];
    return computeTagTimeline(sortedBatches, selectedTag, tagKind, lowScoreOnly);
  }, [sortedBatches, selectedTag, tagKind, lowScoreOnly]);

  const overlayTimeline = useMemo(() => {
    if (!overlay) return [];
    return computeTagTimeline(sortedBatches, overlay.tag, overlay.kind, lowScoreOnly);
  }, [sortedBatches, overlay, lowScoreOnly]);

  const overlayByBatchId = useMemo(
    () => new Map(overlayTimeline.map((p) => [p.batchId, p])),
    [overlayTimeline]
  );

  const poolLabel = lowScoreOnly ? "score ≤ 5" : "all sessions";

  const selectedTrend = useMemo(
    () => trends.find((t) => t.tag === selectedTag) ?? null,
    [trends, selectedTag]
  );

  const timelineAvg = useMemo(() => {
    if (!timeline.length) return null;
    const sum = timeline.reduce((s, p) => s + p.pct, 0);
    return sum / timeline.length;
  }, [timeline]);

  const timelineAvgTitle = useMemo(() => {
    if (timelineAvg == null || !selectedTag) return "";
    const dayWord = timeline.length === 1 ? "day" : "days";
    return `Average daily % across ${timeline.length} ${dayWord} on the chart (${poolLabel}). Not the latest day alone.`;
  }, [timelineAvg, selectedTag, timeline.length, poolLabel]);

  const releaseOverlays = useMemo(
    () => computeTimelineReleaseOverlays(timeline, releaseMarkers),
    [timeline, releaseMarkers]
  );

  const releaseMarkerPlugin = useMemo(
    () => createReleaseMarkerPlugin(releaseOverlays),
    [releaseOverlays]
  );

  const timelineInsights = useMemo(
    () =>
      computeTimelineInsights(
        sortedBatches,
        timeline,
        selectedTag,
        tagKind,
        lowScoreOnly,
        releaseMarkers,
        changePointBatchId
      ),
    [sortedBatches, timeline, selectedTag, tagKind, lowScoreOnly, releaseMarkers, changePointBatchId]
  );

  const hasInsights = timelineInsights.windows.some(
    (w) => w.increases.length || w.decreases.length || w.periodChanges.length
  );

  const handleSelectChangePoint = (batchId: string) => {
    setChangePointBatchId(batchId);
  };

  const addReleaseMarker = () => {
    const label = newReleaseLabel.trim();
    const batchId = newReleaseBatchId;
    if (!label || !batchId) return;
    setReleaseMarkers((prev) => [...prev, createReleaseMarker(label, batchId)]);
    setNewReleaseLabel("");
    setShowConfig(true);
  };

  const removeReleaseMarker = (id: string) => {
    setReleaseMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  const accent = colorForTagKind(tagKind);
  const overlayAccent = overlay ? colorForTagKind(overlay.kind) : OVERLAY_LINE_COLOR;
  const hasOverlay = overlay != null;

  const chartLabels = useMemo(() => timeline.map((p) => p.label), [timeline]);

  const overlaySeriesData = useMemo(() => {
    if (!overlay) return null;
    return timeline.map((p) => overlayByBatchId.get(p.batchId)?.pct ?? null);
  }, [timeline, overlay, overlayByBatchId]);

  const barChartData = useMemo(() => {
    const datasets: import("chart.js").ChartDataset<"bar", number[]>[] = [
      {
        label: selectedTag ?? "",
        data: timeline.map((p) => p.pct),
        backgroundColor: `${accent}99`,
        borderColor: accent,
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: hasOverlay ? 0.55 : 0.65,
        categoryPercentage: hasOverlay ? 0.72 : 0.8,
      },
    ];
    if (overlay && overlaySeriesData) {
      datasets.push({
        label: overlay.tag,
        data: overlaySeriesData.map((v) => v ?? 0),
        backgroundColor: `${overlayAccent}88`,
        borderColor: overlayAccent,
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.55,
        categoryPercentage: 0.72,
      });
    }
    return { labels: chartLabels, datasets };
  }, [
    chartLabels,
    timeline,
    selectedTag,
    accent,
    overlay,
    overlaySeriesData,
    overlayAccent,
    hasOverlay,
  ]);

  const lineChartData = useMemo(() => {
    const datasets: import("chart.js").ChartDataset<"line", number[]>[] = [
      {
        label: selectedTag ?? "",
        data: timeline.map((p) => p.pct),
        borderColor: accent,
        backgroundColor: `${accent}12`,
        fill: true,
        tension: 0.35,
        pointRadius: timeline.length > 14 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#fff",
        pointBorderColor: accent,
        pointBorderWidth: 2,
        borderWidth: 2,
      },
    ];
    if (overlay && overlaySeriesData) {
      datasets.push({
        label: overlay.tag,
        data: overlaySeriesData.map((v) => v ?? 0),
        borderColor: overlayAccent,
        backgroundColor: `${overlayAccent}08`,
        fill: false,
        tension: 0.35,
        pointRadius: timeline.length > 14 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#fff",
        pointBorderColor: overlayAccent,
        pointBorderWidth: 2,
        borderWidth: 2,
        borderDash: [6, 4],
      });
    }
    return { labels: chartLabels, datasets };
  }, [
    chartLabels,
    timeline,
    selectedTag,
    accent,
    overlay,
    overlaySeriesData,
    overlayAccent,
  ]);

  const makeTooltipLine = (
    dataIndex: number,
    y: number | null,
    seriesTag: string,
    seriesKind: TagKind
  ) => {
    if (y == null) return "";
    const point =
      seriesTag === selectedTag
        ? timeline[dataIndex]
        : overlayByBatchId.get(timeline[dataIndex]?.batchId ?? "");
    if (!point) return `${seriesTag}: ${Number(y).toFixed(1)}%`;
    return `${seriesTag} (${kindShortLabel(seriesKind)}): ${Number(y).toFixed(1)}% · ${point.count}/${point.poolSize}`;
  };

  const baseChartOptions = useMemo(
    () =>
      timelineChartOptions({
        yFormat: (v) => `${Number(v).toFixed(0)}%`,
      }),
    []
  );

  const chartPadding = useMemo(
    () => ({ top: releaseOverlays.length ? 24 : 8, right: 8, bottom: 0, left: 0 }),
    [releaseOverlays.length]
  );

  const barChartOptions = useMemo(
    () => ({
      ...baseChartOptions,
      layout: { padding: chartPadding },
      plugins: {
        ...baseChartOptions.plugins,
        legend: {
          display: hasOverlay,
          position: "top" as const,
          labels: { color: CHART.text, font: { size: 12 }, boxWidth: 14, padding: 14 },
        },
        tooltip: {
          ...baseChartOptions.plugins.tooltip,
          displayColors: hasOverlay,
          callbacks: {
            title: (items: TooltipItem<"bar">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? timeline[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"bar">) => {
              const label = String(ctx.dataset.label ?? "");
              const kind =
                label === selectedTag ? tagKind : overlay?.kind ?? tagKind;
              return makeTooltipLine(ctx.dataIndex, ctx.parsed.y, label, kind);
            },
          },
        },
      },
    }),
    [baseChartOptions, chartPadding, timeline, hasOverlay, selectedTag, tagKind, overlay, overlayByBatchId]
  );

  const lineChartOptions = useMemo(
    () => ({
      ...baseChartOptions,
      layout: { padding: chartPadding },
      plugins: {
        ...baseChartOptions.plugins,
        legend: {
          display: hasOverlay,
          position: "top" as const,
          labels: { color: CHART.text, font: { size: 12 }, boxWidth: 14, padding: 14 },
        },
        tooltip: {
          ...baseChartOptions.plugins.tooltip,
          displayColors: hasOverlay,
          callbacks: {
            title: (items: TooltipItem<"line">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? timeline[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"line">) => {
              const label = String(ctx.dataset.label ?? "");
              const kind =
                label === selectedTag ? tagKind : overlay?.kind ?? tagKind;
              return makeTooltipLine(ctx.dataIndex, ctx.parsed.y, label, kind);
            },
          },
        },
      },
    }),
    [baseChartOptions, chartPadding, timeline, hasOverlay, selectedTag, tagKind, overlay, overlayByBatchId]
  );

  if (batches.length === 0) {
    return <div className="tl-empty">Upload daily rating files to explore trends over time.</div>;
  }

  return (
    <div className="tl-view">
      <div className="tl-toolbar">
        <div className="tl-toolbar-main">
          <div className="tl-kind-pills">
            <button
              type="button"
              className={tagKind === "qa" ? "active" : ""}
              onClick={() => {
                setTagKind("qa");
                setSelectedTag(null);
              }}
            >
              {LABELS.tags}
            </button>
            <button
              type="button"
              className={tagKind === "discovery" ? "active" : ""}
              onClick={() => {
                setTagKind("discovery");
                setSelectedTag(null);
              }}
            >
              {LABELS.categories}
            </button>
          </div>

          <div className="tl-tag-combo" ref={pickerRef}>
            <button
              type="button"
              className="tl-tag-trigger"
              onClick={() => setTagPickerOpen((o) => !o)}
              aria-expanded={tagPickerOpen}
            >
              <span className="tl-tag-trigger-label">
                {selectedTag ?? "Select a tag…"}
              </span>
              <span className="tl-tag-trigger-caret">▾</span>
            </button>
            {tagPickerOpen ? (
              <div className="tl-tag-dropdown">
                <input
                  type="search"
                  className="tl-tag-search"
                  placeholder="Search…"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  autoFocus
                />
                <ul className="tl-tag-options">
                  {filteredTags.length === 0 ? (
                    <li className="tl-tag-empty">No matches</li>
                  ) : (
                    filteredTags.map((row) => (
                      <li key={row.tag}>
                        <button
                          type="button"
                          className={selectedTag === row.tag ? "selected" : ""}
                          title={getTagDescriptionOrDefault(row.tag, tagKind)}
                          onClick={() => {
                            setSelectedTag(row.tag);
                            setTagPickerOpen(false);
                            setTagSearch("");
                          }}
                        >
                          <span className="tl-tag-option-main">
                            <span>{row.tag}</span>
                            <span className="tl-tag-pct">{row.pctOfPool.toFixed(1)}%</span>
                          </span>
                          <span className="tl-tag-desc">
                            {getTagDescriptionOrDefault(row.tag, tagKind)}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="tl-overlay-row">
            <span className="tl-overlay-label">Overlay</span>
            <div className="tl-kind-pills tl-kind-pills-compact">
              <button
                type="button"
                className={overlayKind === "qa" ? "active" : ""}
                onClick={() => setOverlayKind("qa")}
              >
                {LABELS.tags}
              </button>
              <button
                type="button"
                className={overlayKind === "discovery" ? "active" : ""}
                onClick={() => setOverlayKind("discovery")}
              >
                {LABELS.categories}
              </button>
            </div>
            <div className="tl-tag-combo tl-overlay-combo" ref={overlayPickerRef}>
              <button
                type="button"
                className={`tl-tag-trigger ${overlay ? "has-overlay" : ""}`}
                onClick={() => setOverlayPickerOpen((o) => !o)}
                aria-expanded={overlayPickerOpen}
              >
                <span className="tl-tag-trigger-label">
                  {overlay ? overlay.tag : "Add comparison…"}
                </span>
                <span className="tl-tag-trigger-caret">▾</span>
              </button>
              {overlayPickerOpen ? (
                <div className="tl-tag-dropdown">
                  <input
                    type="search"
                    className="tl-tag-search"
                    placeholder="Search overlay…"
                    value={overlaySearch}
                    onChange={(e) => setOverlaySearch(e.target.value)}
                    autoFocus
                  />
                  <ul className="tl-tag-options">
                    {filteredOverlayTags.length === 0 ? (
                      <li className="tl-tag-empty">No matches</li>
                    ) : (
                      filteredOverlayTags.map((row) => (
                        <li key={row.tag}>
                          <button
                            type="button"
                            className={
                              overlay?.tag === row.tag && overlay?.kind === overlayKind
                                ? "selected"
                                : ""
                            }
                            title={getTagDescriptionOrDefault(row.tag, overlayKind)}
                            onClick={() => {
                              setOverlay({ tag: row.tag, kind: overlayKind });
                              setOverlayPickerOpen(false);
                              setOverlaySearch("");
                            }}
                          >
                            <span className="tl-tag-option-main">
                              <span>{row.tag}</span>
                              <span className="tl-tag-pct">{row.pctOfPool.toFixed(1)}%</span>
                            </span>
                            <span className="tl-tag-desc">
                              {getTagDescriptionOrDefault(row.tag, overlayKind)}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
            {overlay ? (
              <button
                type="button"
                className="tl-overlay-clear"
                onClick={() => setOverlay(null)}
              >
                Clear overlay
              </button>
            ) : null}
          </div>
        </div>

        <div className="tl-toolbar-actions">
          <div className="tl-chart-toggle">
            <button
              type="button"
              className={chartView === "line" ? "active" : ""}
              onClick={() => setChartView("line")}
            >
              Line
            </button>
            <button
              type="button"
              className={chartView === "bar" ? "active" : ""}
              onClick={() => setChartView("bar")}
            >
              Bar
            </button>
          </div>
          <button
            type="button"
            className={`tl-config-btn ${showConfig ? "active" : ""}`}
            onClick={() => setShowConfig((s) => !s)}
          >
            {showConfig ? "Hide releases" : "Releases"}
          </button>
        </div>
      </div>

      {selectedTag ? (
        <p className="tl-selected-tag-desc">{getTagDescriptionOrDefault(selectedTag, tagKind)}</p>
      ) : null}

      {selectedTag ? (
        <>
          <div className="tl-metrics">
            <div className="tl-metrics-primary">
              <div className="tl-metric tl-metric-hero" title={timelineAvgTitle}>
                <span className="tl-metric-value">
                  {timelineAvg != null ? `${timelineAvg.toFixed(1)}%` : "—"}
                </span>
                <span
                  className="tl-metric-label"
                  title={timelineAvgTitle || getTagDescriptionOrDefault(selectedTag, tagKind)}
                >
                  {selectedTag} · average
                  {timeline.length > 0 ? ` · ${timeline.length}d` : ""} · {poolLabel}
                </span>
              </div>

              {selectedTrend && batches.length >= 2 ? (
                <div className={`tl-metric tl-metric-delta ${selectedTrend.direction}`}>
                  <span className="tl-metric-value">
                    {selectedTrend.deltaPct != null
                      ? `${selectedTrend.deltaPct >= 0 ? "+" : ""}${selectedTrend.deltaPct.toFixed(1)}`
                      : "—"}
                    <span className="tl-metric-unit">pp</span>
                  </span>
                  <span className="tl-metric-label">vs previous day</span>
                </div>
              ) : null}
            </div>

            {releaseOverlays.length > 0 ? (
              <div className="tl-metrics-releases">
                {releaseOverlays.map((o) => (
                  <button
                    key={o.markerId}
                    type="button"
                    className={`tl-metric tl-metric-release ${o.direction} ${
                      selectedReleaseId === o.markerId ? "selected" : ""
                    }`}
                    onClick={() => setSelectedReleaseId(o.markerId)}
                    title={`Show significant changes for ${o.markerLabel}`}
                  >
                    <span className="tl-metric-value">
                      {deltaArrow(o.deltaPct)}
                      {Math.abs(o.deltaPct).toFixed(1)}
                      <span className="tl-metric-unit">pp</span>
                    </span>
                    <span className="tl-metric-label">
                      {o.markerLabel} · {o.beforeAvg.toFixed(1)}% → {o.afterAvg.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="tl-chart-surface">
            <div className="tl-pool-chart-head">
              <h3 className="tl-pool-chart-title">
                {selectedTag}
                {overlay ? (
                  <>
                    {" "}
                    <span className="tl-chart-vs">vs</span> {overlay.tag}
                  </>
                ) : null}{" "}
                over time
              </h3>
              <p className="tl-pool-chart-sub">
                % of conversations tagged each day
                {overlay
                  ? ` · solid/filled = ${selectedTag}, dashed = ${overlay.tag}`
                  : ""}
              </p>
            </div>
            {timeline.length <= 1 ? (
              <p className="tl-chart-hint">Add more daily files to see a trend.</p>
            ) : null}
            <div className="tl-chart-canvas">
              {chartView === "bar" ? (
                <Bar
                  data={barChartData}
                  options={barChartOptions}
                  plugins={[releaseMarkerPlugin as import("chart.js").Plugin<"bar">]}
                />
              ) : (
                <Line
                  data={lineChartData}
                  options={lineChartOptions}
                  plugins={[releaseMarkerPlugin as import("chart.js").Plugin<"line">]}
                />
              )}
            </div>
          </div>

          {hasInsights ? (
            <SignificantChangesPanel
              insights={timelineInsights}
              batches={sortedBatches.map((b) => ({ id: b.id, label: b.label }))}
              releaseMarkers={releaseMarkers}
              selectedReleaseId={selectedReleaseId}
              onSelectRelease={setSelectedReleaseId}
              changePointBatchId={changePointBatchId}
              onChangePointBatchId={handleSelectChangePoint}
              onSelectTag={(tag, kind) => {
                setSelectedTag(tag);
                setTagKind(kind);
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="tl-empty">Choose a tag to view its trend chart.</div>
      )}

      {showConfig ? (
        <details className="tl-drawer" open>
          <summary>Release markers</summary>
          <div className="tl-config-panel flat">
            <section className="tl-config-section">
              <p className="tl-muted" style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>
                Mark the first day after a release. Click a release pill above the chart to filter
                significant changes.
              </p>
              <div className="tl-config-row">
                <input
                  type="text"
                  className="tl-input"
                  placeholder="Release name"
                  value={newReleaseLabel}
                  onChange={(e) => setNewReleaseLabel(e.target.value)}
                />
                <select
                  className="tl-input"
                  value={newReleaseBatchId}
                  onChange={(e) => setNewReleaseBatchId(e.target.value)}
                >
                  <option value="">First post-release day…</option>
                  {sortedBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="tl-btn-primary"
                  disabled={!newReleaseLabel.trim() || !newReleaseBatchId}
                  onClick={addReleaseMarker}
                >
                  Add
                </button>
              </div>
              {releaseMarkers.length > 0 ? (
                <ul className="tl-release-list">
                  {releaseMarkers.map((m) => {
                    const batch = sortedBatches.find((b) => b.id === m.batchId);
                    return (
                      <li key={m.id}>
                        <span>
                          <strong>{m.label}</strong>
                          <span className="tl-muted"> · {batch?.label ?? "—"}</span>
                        </span>
                        <button type="button" onClick={() => removeReleaseMarker(m.id)}>
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          </div>
        </details>
      ) : null}
    </div>
  );
}
