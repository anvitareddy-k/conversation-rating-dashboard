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
  topTagsAcrossBatches,
} from "../analytics";
import { CHART, timelineChartOptions } from "../chartTheme";
import { LABELS, kindLabel } from "../labels";
import type { LoadedBatch, PickableTagKind } from "../parsing";
import { pickTagsByKind } from "../parsing";
import {
  BUILTIN_RELEASE_DEFINITIONS,
  builtinReleaseIdFromMarkerId,
  createReleaseMarker,
  isResolvableReleaseMarker,
  loadHiddenBuiltinReleaseIds,
  loadManualReleaseMarkers,
  pruneInvalidManualReleaseMarkers,
  resolveReleaseMarkers,
  saveHiddenBuiltinReleaseIds,
  saveManualReleaseMarkers,
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

type CompareTag = { tag: string; kind: PickableTagKind };

const OVERLAY_COLORS = CHART.colors.filter((c) => c !== CHART.accent && c !== "#7c3aed");

function compareKey(tag: string, kind: PickableTagKind): string {
  return `${kind}:${tag}`;
}

function compareColor(index: number): string {
  return OVERLAY_COLORS[index % OVERLAY_COLORS.length];
}

function colorForTagKind(kind: PickableTagKind): string {
  return kind === "category" ? "#7c3aed" : CHART.accent;
}

function kindShortLabel(kind: PickableTagKind): string {
  return kindLabel(kind);
}

type TimelineTabProps = {
  batches: LoadedBatch[];
  /** Full loaded series used to lock builtin release markers to hard-coded dates. */
  allBatches?: LoadedBatch[];
  lowScoreOnly: boolean;
  initialTag?: { tag: string; kind: PickableTagKind } | null;
};

function deltaArrow(delta: number): string {
  if (Math.abs(delta) < 0.05) return "→";
  return delta > 0 ? "↑" : "↓";
}

export function TimelineTab({
  batches,
  allBatches,
  lowScoreOnly,
  initialTag,
}: TimelineTabProps) {
  const [tagKind, setTagKind] = useState<PickableTagKind>(initialTag?.kind ?? "qa");
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag?.tag ?? null);
  const [tagSearch, setTagSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [chartView, setChartView] = useState<ChartView>("line");
  const [manualReleaseMarkers, setManualReleaseMarkers] = useState<ReleaseMarker[]>(() =>
    loadManualReleaseMarkers()
  );
  const [hiddenBuiltinIds, setHiddenBuiltinIds] = useState<string[]>(() =>
    loadHiddenBuiltinReleaseIds()
  );
  const [newReleaseLabel, setNewReleaseLabel] = useState("");
  const [newReleaseBatchId, setNewReleaseBatchId] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [changePointBatchId, setChangePointBatchId] = useState<string | null>(() =>
    loadChangePointBatchId()
  );
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [compareTags, setCompareTags] = useState<CompareTag[]>([]);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  const [compareSearch, setCompareSearch] = useState("");
  const [compareKind, setCompareKind] = useState<PickableTagKind>("category");
  const pickerRef = useRef<HTMLDivElement>(null);
  const comparePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveManualReleaseMarkers(manualReleaseMarkers);
  }, [manualReleaseMarkers]);

  useEffect(() => {
    saveHiddenBuiltinReleaseIds(hiddenBuiltinIds);
  }, [hiddenBuiltinIds]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(t)) {
        setTagPickerOpen(false);
      }
      if (comparePickerRef.current && !comparePickerRef.current.contains(t)) {
        setComparePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const tagStats = useMemo(
    () => topTagsAcrossBatches(batches, (r) => pickTagsByKind(r, tagKind), lowScoreOnly),
    [batches, tagKind, lowScoreOnly]
  );

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const list = q ? tagStats.filter((r) => r.tag.toLowerCase().includes(q)) : tagStats;
    return list.slice(0, 40);
  }, [tagStats, tagSearch]);

  const compareTagStats = useMemo(
    () => topTagsAcrossBatches(batches, (r) => pickTagsByKind(r, compareKind), lowScoreOnly),
    [batches, compareKind, lowScoreOnly]
  );

  const filteredCompareOptions = useMemo(() => {
    const q = compareSearch.trim().toLowerCase();
    const list = q
      ? compareTagStats.filter((r) => r.tag.toLowerCase().includes(q))
      : compareTagStats;
    return list
      .filter((r) => !(r.tag === selectedTag && compareKind === tagKind))
      .slice(0, 40);
  }, [compareTagStats, compareSearch, selectedTag, compareKind, tagKind]);

  const sortedBatches = useMemo(
    () =>
      [...batches].sort(
        (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
      ),
    [batches]
  );

  const sortedAllBatches = useMemo(() => {
    const source = allBatches?.length ? allBatches : batches;
    return [...source].sort(
      (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
    );
  }, [allBatches, batches]);

  useEffect(() => {
    pruneInvalidManualReleaseMarkers(sortedBatches);
    setManualReleaseMarkers((prev) => {
      const valid = prev.filter((m) => isResolvableReleaseMarker(m, sortedBatches));
      return valid.length === prev.length ? prev : valid;
    });
  }, [sortedBatches]);

  const releaseMarkers = useMemo(
    () =>
      resolveReleaseMarkers(
        sortedBatches,
        manualReleaseMarkers,
        hiddenBuiltinIds,
        sortedAllBatches
      ),
    [sortedBatches, sortedAllBatches, manualReleaseMarkers, hiddenBuiltinIds]
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
      setTagKind(initialTag.kind);
    }
  }, [initialTag]);

  useEffect(() => {
    if (!selectedTag) return;
    setCompareTags((prev) =>
      prev.filter((c) => !(c.tag === selectedTag && c.kind === tagKind))
    );
  }, [selectedTag, tagKind]);

  const timeline = useMemo(() => {
    if (!selectedTag) return [];
    return computeTagTimeline(sortedBatches, selectedTag, tagKind, lowScoreOnly);
  }, [sortedBatches, selectedTag, tagKind, lowScoreOnly]);

  const compareSeries = useMemo(() => {
    return compareTags.map((compare, index) => {
      const seriesTimeline = computeTagTimeline(
        sortedBatches,
        compare.tag,
        compare.kind,
        lowScoreOnly
      );
      const byBatchId = new Map(seriesTimeline.map((p) => [p.batchId, p]));
      return {
        ...compare,
        color: compareColor(index),
        byBatchId,
        data: timeline.map((p) => byBatchId.get(p.batchId)?.pct ?? null),
      };
    });
  }, [compareTags, sortedBatches, lowScoreOnly, timeline]);

  const seriesKindByLabel = useMemo(() => {
    const map = new Map<string, PickableTagKind>();
    if (selectedTag) map.set(selectedTag, tagKind);
    for (const compare of compareTags) map.set(compare.tag, compare.kind);
    return map;
  }, [selectedTag, tagKind, compareTags]);

  const poolLabel = lowScoreOnly ? "score ≤ 5" : "all sessions";

  const timelineAvg = useMemo(() => {
    if (!timeline.length) return null;
    const sum = timeline.reduce((s, p) => s + p.pct, 0);
    return sum / timeline.length;
  }, [timeline]);

  const timelineAvgTitle = useMemo(() => {
    if (timelineAvg == null || !selectedTag) return "";
    const dayWord = timeline.length === 1 ? "day" : "days";
    return `Average % across ${timeline.length} ${dayWord} included on the chart (${poolLabel}). Not the latest day alone.`;
  }, [timelineAvg, selectedTag, timeline.length, poolLabel]);

  const releaseOverlays = useMemo(() => {
    const visibleIds = new Set(timeline.map((p) => p.batchId));
    const markersInView = releaseMarkers.filter((m) => visibleIds.has(m.batchId));
    return computeTimelineReleaseOverlays(timeline, markersInView);
  }, [timeline, releaseMarkers]);

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
    setManualReleaseMarkers((prev) => [...prev, createReleaseMarker(label, batchId)]);
    setNewReleaseLabel("");
    setShowConfig(true);
  };

  const removeReleaseMarker = (marker: ReleaseMarker) => {
    if (marker.source === "builtin") {
      const builtinId = builtinReleaseIdFromMarkerId(marker.id);
      if (builtinId) {
        setHiddenBuiltinIds((prev) => (prev.includes(builtinId) ? prev : [...prev, builtinId]));
      }
      return;
    }
    setManualReleaseMarkers((prev) => prev.filter((m) => m.id !== marker.id));
  };

  const restoreBuiltinRelease = (builtinId: string) => {
    setHiddenBuiltinIds((prev) => prev.filter((id) => id !== builtinId));
  };

  const toggleCompareTag = (tag: string, kind: PickableTagKind) => {
    const key = compareKey(tag, kind);
    setCompareTags((prev) => {
      const exists = prev.some((c) => compareKey(c.tag, c.kind) === key);
      if (exists) return prev.filter((c) => compareKey(c.tag, c.kind) !== key);
      return [...prev, { tag, kind }];
    });
  };

  const removeCompareTag = (tag: string, kind: PickableTagKind) => {
    const key = compareKey(tag, kind);
    setCompareTags((prev) => prev.filter((c) => compareKey(c.tag, c.kind) !== key));
  };

  const accent = colorForTagKind(tagKind);
  const hasCompare = compareTags.length > 0;

  const chartLabels = useMemo(() => timeline.map((p) => p.label), [timeline]);

  const barChartData = useMemo(() => {
    const datasets: import("chart.js").ChartDataset<"bar", number[]>[] = [
      {
        label: selectedTag ?? "",
        data: timeline.map((p) => p.pct),
        backgroundColor: `${accent}99`,
        borderColor: accent,
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: hasCompare ? 0.55 : 0.65,
        categoryPercentage: hasCompare ? 0.72 : 0.8,
      },
    ];
    for (const compare of compareSeries) {
      datasets.push({
        label: compare.tag,
        data: compare.data.map((v) => v ?? 0),
        backgroundColor: `${compare.color}88`,
        borderColor: compare.color,
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.55,
        categoryPercentage: 0.72,
      });
    }
    return { labels: chartLabels, datasets };
  }, [chartLabels, timeline, selectedTag, accent, compareSeries, hasCompare]);

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
    for (const compare of compareSeries) {
      datasets.push({
        label: compare.tag,
        data: compare.data.map((v) => v ?? 0),
        borderColor: compare.color,
        backgroundColor: `${compare.color}08`,
        fill: false,
        tension: 0.35,
        pointRadius: timeline.length > 14 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#fff",
        pointBorderColor: compare.color,
        pointBorderWidth: 2,
        borderWidth: 2,
        borderDash: [6, 4],
      });
    }
    return { labels: chartLabels, datasets };
  }, [chartLabels, timeline, selectedTag, accent, compareSeries]);

  const makeTooltipLine = (
    dataIndex: number,
    y: number | null,
    seriesTag: string,
    seriesKind: PickableTagKind
  ) => {
    if (y == null) return "";
    const point =
      seriesTag === selectedTag
        ? timeline[dataIndex]
        : compareSeries.find((c) => c.tag === seriesTag)?.byBatchId.get(
            timeline[dataIndex]?.batchId ?? ""
          );
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
          display: hasCompare,
          position: "top" as const,
          labels: { color: CHART.text, font: { size: 12 }, boxWidth: 14, padding: 14 },
        },
        tooltip: {
          ...baseChartOptions.plugins.tooltip,
          displayColors: hasCompare,
          callbacks: {
            title: (items: TooltipItem<"bar">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? timeline[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"bar">) => {
              const label = String(ctx.dataset.label ?? "");
              const kind = seriesKindByLabel.get(label) ?? tagKind;
              return makeTooltipLine(ctx.dataIndex, ctx.parsed.y, label, kind);
            },
          },
        },
      },
    }),
    [baseChartOptions, chartPadding, timeline, hasCompare, tagKind, seriesKindByLabel, compareSeries, selectedTag]
  );

  const lineChartOptions = useMemo(
    () => ({
      ...baseChartOptions,
      layout: { padding: chartPadding },
      plugins: {
        ...baseChartOptions.plugins,
        legend: {
          display: hasCompare,
          position: "top" as const,
          labels: { color: CHART.text, font: { size: 12 }, boxWidth: 14, padding: 14 },
        },
        tooltip: {
          ...baseChartOptions.plugins.tooltip,
          displayColors: hasCompare,
          callbacks: {
            title: (items: TooltipItem<"line">[]) => {
              const idx = items[0]?.dataIndex;
              return idx != null ? timeline[idx]?.label ?? "" : "";
            },
            label: (ctx: TooltipItem<"line">) => {
              const label = String(ctx.dataset.label ?? "");
              const kind = seriesKindByLabel.get(label) ?? tagKind;
              return makeTooltipLine(ctx.dataIndex, ctx.parsed.y, label, kind);
            },
          },
        },
      },
    }),
    [baseChartOptions, chartPadding, timeline, hasCompare, tagKind, seriesKindByLabel, compareSeries, selectedTag]
  );

  if (batches.length === 0) {
    return <div className="tl-empty">Upload daily rating files to explore trends across days included.</div>;
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
              className={tagKind === "category" ? "active" : ""}
              onClick={() => {
                setTagKind("category");
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

          <div className="tl-compare-row">
            {compareTags.map((compare, index) => (
              <span
                key={compareKey(compare.tag, compare.kind)}
                className="tl-compare-chip"
                style={{ borderColor: compareColor(index) }}
              >
                <span
                  className="tl-compare-dot"
                  style={{ background: compareColor(index) }}
                  aria-hidden
                />
                {compare.tag}
                <button
                  type="button"
                  className="tl-compare-chip-remove"
                  aria-label={`Remove ${compare.tag}`}
                  onClick={() => removeCompareTag(compare.tag, compare.kind)}
                >
                  ×
                </button>
              </span>
            ))}
            <div className="tl-tag-combo tl-compare-add" ref={comparePickerRef}>
              <button
                type="button"
                className={`tl-tag-trigger tl-compare-trigger ${compareTags.length ? "has-compare" : ""}`}
                onClick={() => setComparePickerOpen((o) => !o)}
                aria-expanded={comparePickerOpen}
              >
                <span className="tl-tag-trigger-label">+ Compare</span>
                <span className="tl-tag-trigger-caret">▾</span>
              </button>
              {comparePickerOpen ? (
                <div className="tl-tag-dropdown">
                  <div className="tl-compare-dropdown-head">
                    <div className="tl-kind-pills tl-kind-pills-compact">
                      <button
                        type="button"
                        className={compareKind === "qa" ? "active" : ""}
                        onClick={() => setCompareKind("qa")}
                      >
                        {LABELS.tags}
                      </button>
                      <button
                        type="button"
                        className={compareKind === "category" ? "active" : ""}
                        onClick={() => setCompareKind("category")}
                      >
                        {LABELS.categories}
                      </button>
                    </div>
                  </div>
                  <input
                    type="search"
                    className="tl-tag-search"
                    placeholder="Search…"
                    value={compareSearch}
                    onChange={(e) => setCompareSearch(e.target.value)}
                    autoFocus
                  />
                  <ul className="tl-tag-options">
                    {filteredCompareOptions.length === 0 ? (
                      <li className="tl-tag-empty">No matches</li>
                    ) : (
                      filteredCompareOptions.map((row) => {
                        const selected = compareTags.some(
                          (c) => c.tag === row.tag && c.kind === compareKind
                        );
                        return (
                          <li key={row.tag}>
                            <button
                              type="button"
                              className={selected ? "selected" : ""}
                              title={getTagDescriptionOrDefault(row.tag, compareKind)}
                              onClick={() => toggleCompareTag(row.tag, compareKind)}
                            >
                              <span className="tl-tag-option-main">
                                <span>{row.tag}</span>
                                <span className="tl-tag-pct">
                                  {selected ? "✓" : `${row.pctOfPool.toFixed(1)}%`}
                                </span>
                              </span>
                              <span className="tl-tag-desc">
                                {getTagDescriptionOrDefault(row.tag, compareKind)}
                              </span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
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
            className={`tl-config-btn ${showConfig ? "active" : ""} ${
              releaseMarkers.length > 0 ? "has-markers" : ""
            }`}
            onClick={() => setShowConfig((s) => !s)}
          >
            {showConfig ? "Hide releases" : "Releases"}
            {releaseMarkers.length > 0 ? (
              <span className="tl-config-btn-count">{releaseMarkers.length}</span>
            ) : null}
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
                  {timeline.length > 0 ? ` · ${timeline.length} day${timeline.length === 1 ? "" : "s"} included` : ""} · {poolLabel}
                </span>
              </div>
            </div>

            {releaseOverlays.length > 0 ? (
              <div className="tl-metrics-releases-wrap">
                <span className="tl-metrics-releases-heading">Release impact</span>
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
              </div>
            ) : null}
          </div>

          <div className="tl-chart-surface">
            <div className="tl-pool-chart-head">
              <h3 className="tl-pool-chart-title">
                {selectedTag}
                {compareTags.length > 0 ? (
                  <>
                    {" "}
                    <span className="tl-chart-vs">vs</span>{" "}
                    {compareTags.map((c) => c.tag).join(", ")}
                  </>
                ) : null}{" "}
                over time
              </h3>
              <p className="tl-pool-chart-sub">
                % of conversations tagged each day included
                {compareTags.length > 0 ? " · dashed lines = comparisons" : ""}
              </p>
            </div>
            {timeline.length <= 1 ? (
              <p className="tl-chart-hint">Add more days of data to see a trend.</p>
            ) : null}
            <div className="tl-chart-canvas">
              {chartView === "bar" ? (
                <Bar
                  key={`tl-bar-${timeline.map((p) => p.batchId).join("|")}-${releaseOverlays.map((o) => o.markerId).join("|") || "none"}`}
                  data={barChartData}
                  options={barChartOptions}
                  plugins={[releaseMarkerPlugin as import("chart.js").Plugin<"bar">]}
                />
              ) : (
                <Line
                  key={`tl-line-${timeline.map((p) => p.batchId).join("|")}-${releaseOverlays.map((o) => o.markerId).join("|") || "none"}`}
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
                Built-in releases are locked to hard-coded calendar days (Slotfill Fix → Jun 10,
                2026) and only appear when that period is in range. Add custom markers below, or
                hide a built-in you do not need.
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
                          {m.source === "builtin" ? (
                            <span className="tl-muted"> · built-in</span>
                          ) : null}
                          <span className="tl-muted"> · {batch?.label ?? "—"}</span>
                        </span>
                        <button type="button" onClick={() => removeReleaseMarker(m)}>
                          {m.source === "builtin" ? "Hide" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {hiddenBuiltinIds.length > 0 ? (
                <ul className="tl-release-list" style={{ marginTop: "0.75rem" }}>
                  {hiddenBuiltinIds.map((builtinId) => {
                    const def = BUILTIN_RELEASE_DEFINITIONS.find((d) => d.id === builtinId);
                    if (!def) return null;
                    return (
                      <li key={builtinId}>
                        <span className="tl-muted">
                          <strong>{def.label}</strong> · hidden
                        </span>
                        <button type="button" onClick={() => restoreBuiltinRelease(builtinId)}>
                          Restore
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
