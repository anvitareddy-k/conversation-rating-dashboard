import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { CompactManifest } from "./compactFormat";
import { loadCompactDays } from "./compactLoad";
import type { LoadedBatch, PickableTagKind, RatingRow, TagFilterState } from "./parsing";
import {
  appliedRangeFromStrings,
  createBatch,
  defaultTagFilter,
  excludeErrorSessions,
  filterBatchesByRange,
  filterRowsByTags,
  isErrorSession,
  isLowRated,
  mergeAndDedupeByChatbotSid,
  setDateInputValue,
  computeExclusiveTagStats,
} from "./parsing";
import { computeBatchSummary, topTagsAcrossBatches } from "./analytics";
import { LABELS } from "./labels";
import { TimelineTab } from "./components/TimelineTab";
import { FunnelTab } from "./components/FunnelTab";
import { DiscoveryTagsTab } from "./components/DiscoveryTagsTab";
import { HtmlViewerTab } from "./components/HtmlViewerTab";
import { OverviewTab } from "./components/OverviewTab";
import {
  loadHiddenBuiltinReleaseIds,
  loadManualReleaseMarkers,
  pruneInvalidManualReleaseMarkers,
  resolveReleaseMarkers,
} from "./releaseMarkers";
import {
  loadChangePointBatchId,
  resolveChangePointBatchId,
  saveChangePointBatchId,
} from "./changePoint";
import { loadBundledData, parseFileContent } from "./loadData";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type TabId = "overview" | "timeline" | "funnel" | "discovery" | "htmlviewer";

function toggleInList(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];
}

function lastNDayRange(batches: LoadedBatch[], n: number) {
  const dated = [...batches]
    .filter((b) => b.periodDate)
    .sort((a, b) => a.periodDate!.getTime() - b.periodDate!.getTime());
  const slice = dated.slice(-Math.min(n, dated.length));
  if (!slice.length) return { start: "", end: "", applied: null as ReturnType<typeof appliedRangeFromStrings> | null };
  const start = setDateInputValue(slice[0].periodDate!);
  const end = setDateInputValue(slice[slice.length - 1].periodDate!);
  return { start, end, applied: appliedRangeFromStrings(start, end) };
}

function pickSlices(batch: LoadedBatch, excludeErrors: boolean): LoadedBatch {
  if (!batch.slices) return batch;
  if (!excludeErrors) return batch;
  return { ...batch, slices: { all: batch.slices.noError, noError: batch.slices.noError } };
}

export default function App() {
  const [batches, setBatches] = useState<LoadedBatch[]>([]);
  const [sessionRows, setSessionRows] = useState<Record<string, RatingRow[]>>({});
  const [compactManifest, setCompactManifest] = useState<CompactManifest | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [rangeStartStr, setRangeStartStr] = useState("");
  const [rangeEndStr, setRangeEndStr] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ start: Date | null; end: Date | null } | null>(
    null
  );
  const [tagFilter, setTagFilter] = useState<TagFilterState>(defaultTagFilter());
  const [excludeErrors, setExcludeErrors] = useState(true);
  const [htmlSources, setHtmlSources] = useState<{ name: string; text: string }[]>([]);
  const [status, setStatus] = useState("");
  const [showHtmlWarn, setShowHtmlWarn] = useState(false);
  const [timelineFocusTag, setTimelineFocusTag] = useState<{
    tag: string;
    kind: PickableTagKind;
  } | null>(null);
  const [changePointBatchId, setChangePointBatchId] = useState<string | null>(() =>
    loadChangePointBatchId()
  );
  const loadedDaysRef = useRef<Set<string>>(new Set());

  const rangeBatches = useMemo(() => {
    if (appliedRange === null) return batches;
    return filterBatchesByRange(batches, appliedRange.start, appliedRange.end);
  }, [batches, appliedRange]);

  const workingBatches = useMemo(() => {
    return rangeBatches.map((b) => {
      const sliced = pickSlices(b, excludeErrors);
      const rows = sessionRows[b.id] ?? [];
      return {
        ...sliced,
        rows: excludeErrors ? excludeErrorSessions(rows) : rows,
      };
    });
  }, [rangeBatches, excludeErrors, sessionRows]);

  const batchSummary = useMemo(() => computeBatchSummary(workingBatches), [workingBatches]);
  const showTimeline = rangeBatches.length >= 1;

  const loadedSessionRows = useMemo(
    () => workingBatches.flatMap((b) => b.rows),
    [workingBatches]
  );

  const errorSessionCount = useMemo(() => {
    return rangeBatches.reduce((s, b) => {
      if (b.slices) return s + Math.max(0, b.slices.all.total - b.slices.noError.total);
      return s + (sessionRows[b.id] ?? []).filter(isErrorSession).length;
    }, 0);
  }, [rangeBatches, sessionRows]);

  const analyticsPool = useMemo(() => {
    if (tagFilter.lowScoreOnly) return loadedSessionRows.filter(isLowRated);
    return loadedSessionRows;
  }, [loadedSessionRows, tagFilter.lowScoreOnly]);

  const funnelRows = useMemo(
    () => filterRowsByTags(analyticsPool, tagFilter),
    [analyticsPool, tagFilter]
  );

  const sortedWorkingBatches = useMemo(
    () =>
      [...workingBatches].sort(
        (a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0)
      ),
    [workingBatches]
  );

  const sortedAllBatches = useMemo(() => {
    return [...batches]
      .map((b) => pickSlices(b, excludeErrors))
      .sort((a, b) => (a.periodDate?.getTime() ?? 0) - (b.periodDate?.getTime() ?? 0));
  }, [batches, excludeErrors]);

  const releaseMarkers = useMemo(
    () =>
      resolveReleaseMarkers(
        sortedWorkingBatches,
        loadManualReleaseMarkers(),
        loadHiddenBuiltinReleaseIds(),
        sortedAllBatches
      ),
    [sortedWorkingBatches, sortedAllBatches]
  );

  useEffect(() => {
    pruneInvalidManualReleaseMarkers(sortedWorkingBatches);
  }, [sortedWorkingBatches]);

  useEffect(() => {
    const ids = sortedWorkingBatches.map((b) => b.id);
    const markerIds = releaseMarkers.map((m) => m.batchId);
    setChangePointBatchId((prev) => resolveChangePointBatchId(ids, prev, markerIds));
  }, [sortedWorkingBatches, releaseMarkers]);

  useEffect(() => {
    saveChangePointBatchId(changePointBatchId);
  }, [changePointBatchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadBundledData();
        if (cancelled || !loaded) return;
        setHtmlSources(loaded.htmlSources);
        setBatches(loaded.batches);
        setCompactManifest(loaded.compactManifest ?? null);
        setTagFilter(defaultTagFilter());
        setTimelineFocusTag(null);
        loadedDaysRef.current = new Set();
        setSessionRows({});

        const initial = lastNDayRange(loaded.batches, 14);
        setRangeStartStr(initial.start);
        setRangeEndStr(initial.end);
        setAppliedRange(initial.applied);

        if (loaded.merged.length) {
          const byId: Record<string, RatingRow[]> = {};
          for (const b of loaded.batches) {
            byId[b.id] = b.rows;
            loadedDaysRef.current.add(b.id);
          }
          setSessionRows(byId);
        }

        const skipNote = loaded.skippedFiles?.length
          ? ` · skipped ${loaded.skippedFiles.length} missing file(s)`
          : "";
        setStatus(
          loaded.compactManifest
            ? `Loaded ${loaded.batches.length} day(s) of packed stats.${skipNote}`
            : `Auto-loaded ${loaded.batches.length} file(s).${skipNote}`
        );
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setStatus(`Error loading bundled data: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!compactManifest) return;
    const needed = rangeBatches.map((b) => b.id).filter((id) => !loadedDaysRef.current.has(id));
    if (!needed.length) return;
    let cancelled = false;
    setSessionsLoading(true);
    (async () => {
      try {
        const extra = await loadCompactDays(needed, compactManifest);
        if (cancelled) return;
        for (const id of Object.keys(extra)) loadedDaysRef.current.add(id);
        setSessionRows((prev) => ({ ...prev, ...extra }));
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setStatus(`Error loading sessions: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compactManifest, rangeBatches]);

  const activeFilterCount = tagFilter.qaTags.length + tagFilter.categoryTags.length;

  const stats = useMemo(() => {
    const sliceTotal = workingBatches.reduce(
      (s, b) => s + (b.slices?.all.total ?? b.rows.length),
      0
    );
    const total = sliceTotal || loadedSessionRows.length;
    const poolN = analyticsPool.length || (tagFilter.lowScoreOnly
      ? workingBatches.reduce((s, b) => s + (b.slices?.all.lowRated ?? 0), 0)
      : total);
    const funnel = funnelRows;
    const funnelN = activeFilterCount ? funnel.length : poolN;

    const scorePool = activeFilterCount ? funnel : analyticsPool;
    const overallScores = (scorePool.length ? scorePool : analyticsPool)
      .map((r) => r.overall_score)
      .filter(Number.isFinite);
    const avgOverall = overallScores.length
      ? (overallScores.reduce((a, b) => a + b, 0) / overallScores.length).toFixed(2)
      : "—";

    const turnSource = scorePool.length ? scorePool : analyticsPool;
    const turnCounts = turnSource
      .map((r) => r.num_turns)
      .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
    const avgTurns = turnCounts.length
      ? (turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length).toFixed(1)
      : workingBatches.some((b) => b.slices)
        ? (() => {
            let sum = 0;
            let n = 0;
            for (const b of workingBatches) {
              if (!b.slices) continue;
              sum += b.slices.all.turnSum;
              n += b.slices.all.withTurns;
            }
            return n ? (sum / n).toFixed(1) : "—";
          })()
        : "—";

    const qaTagStats = activeFilterCount
      ? computeExclusiveTagStats(funnel, "qa", total)
      : topTagsAcrossBatches(workingBatches, (r) => r.qaTags, tagFilter.lowScoreOnly, "qa");
    const categoryTagStats = activeFilterCount
      ? computeExclusiveTagStats(funnel, "category", total)
      : topTagsAcrossBatches(
          workingBatches,
          (r) => r.categoryTags,
          tagFilter.lowScoreOnly,
          "category"
        );
    const poolLabel = tagFilter.lowScoreOnly ? "≤5-rated pool" : "all sessions";

    return {
      total,
      poolN,
      funnelN,
      avgOverall,
      avgTurns,
      qaTagStats,
      categoryTagStats,
      poolLabel,
    };
  }, [
    workingBatches,
    loadedSessionRows.length,
    analyticsPool,
    funnelRows,
    tagFilter.lowScoreOnly,
    activeFilterCount,
  ]);

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
          const text = await readFileAsText(file);
          const parsed = parseFileContent(file.name, text);
          if (parsed.htmlSource) newHtmlSources.push(parsed.htmlSource);
          const batch = createBatch(parsed.fileName, parsed.rows);
          newBatches.push(batch);
          combined.push(...batch.rows);
        }
        const merged = mergeAndDedupeByChatbotSid(combined);
        setHtmlSources(newHtmlSources);
        setBatches(newBatches);
        setCompactManifest(null);
        loadedDaysRef.current = new Set(newBatches.map((b) => b.id));
        const byId: Record<string, RatingRow[]> = {};
        for (const b of newBatches) byId[b.id] = b.rows;
        setSessionRows(byId);
        setTagFilter(defaultTagFilter());
        setTimelineFocusTag(null);
        const initial = lastNDayRange(newBatches, 14);
        setRangeStartStr(initial.start);
        setRangeEndStr(initial.end);
        setAppliedRange(initial.applied);
        setStatus(
          `Loaded ${files.length} file(s) → ${merged.length} unique across ${newBatches.length} day(s).`
        );
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
        const addedHtmlSources: { name: string; text: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const text = await readFileAsText(file);
          const parsed = parseFileContent(file.name, text);
          if (parsed.htmlSource) addedHtmlSources.push(parsed.htmlSource);
          addedBatches.push(createBatch(parsed.fileName, parsed.rows));
        }
        setHtmlSources((prev) => [...prev, ...addedHtmlSources]);
        setBatches((prev) => [...prev, ...addedBatches]);
        setSessionRows((prev) => {
          const next = { ...prev };
          for (const b of addedBatches) {
            next[b.id] = b.rows;
            loadedDaysRef.current.add(b.id);
          }
          return next;
        });
        setStatus(`Added ${files.length} file(s) · ${addedBatches.length} new day(s).`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, []);

  const applyDateRange = useCallback(
    (start: string, end: string, applied: { start: Date | null; end: Date | null } | null) => {
      setRangeStartStr(start);
      setRangeEndStr(end);
      setAppliedRange(applied);
    },
    []
  );

  const toggleQaTag = useCallback((tag: string) => {
    setTagFilter((f) => ({ ...f, qaTags: toggleInList(f.qaTags, tag) }));
  }, []);

  const toggleCategoryTag = useCallback((tag: string) => {
    setTagFilter((f) => ({ ...f, categoryTags: toggleInList(f.categoryTags, tag) }));
  }, []);

  const clearTagFilter = useCallback(() => {
    setTagFilter((f) => ({ ...f, qaTags: [], categoryTags: [] }));
  }, []);

  const updateTagFilter = useCallback((updater: (prev: TagFilterState) => TagFilterState) => {
    setTagFilter(updater);
  }, []);

  const openTimeline = useCallback((tag: string, kind: PickableTagKind) => {
    setTimelineFocusTag({ tag, kind });
    setActiveTab("timeline");
  }, []);

  const hasData = batches.length > 0;
  const discoveryPoolLabel = excludeErrors
    ? "all sessions (errors excluded)"
    : "all sessions";

  const missingSessionDays = rangeBatches.filter((b) => !sessionRows[b.id]).length;
  const sessionsNote =
    compactManifest && missingSessionDays === 0 && rangeBatches.length < batches.length
      ? `Time-series charts use the selected days. Session lists/funnel use loaded rows for those days (${loadedSessionRows.length.toLocaleString()} sessions).`
      : undefined;

  const tabs: { id: TabId; label: string; desc: string; badge?: string }[] = [
    { id: "overview", label: "Overview", desc: "KPIs, charts & sessions" },
    {
      id: "timeline",
      label: "Timeline",
      desc: "Pick a tag → % trend by day",
      badge: rangeBatches.length > 1 ? `${rangeBatches.length} days` : undefined,
    },
    { id: "funnel", label: "Funnel", desc: "Narrow by tags & categories" },
    { id: "discovery", label: "Discovery tags", desc: "Occurrence & share of pool" },
    { id: "htmlviewer", label: "Report viewer", desc: "Browse large report HTML, paginated" },
  ];

  return (
    <>
      <header>
        <h1>Conversation rating dashboard</h1>
        <p>
          Upload rating report HTML or CSV files — one file per calendar day works best for trend charts.
          Sessions are tagged with <strong>{LABELS.tags.toLowerCase()}</strong> (issues) and{" "}
          <strong>{LABELS.categories.toLowerCase()}</strong> (conversation types).
        </p>
      </header>
      <main>
        <div className="upload-zone">
          <label className="file-btn" htmlFor="file-input">
            Choose CSV or HTML (multiple)
          </label>
          <input
            id="file-input"
            type="file"
            accept=".csv,.html,text/html,text/csv"
            multiple
            onChange={onFile}
          />
          {hasData ? (
            <>
              <label className="file-btn secondary" htmlFor="append-input">
                Add more days
              </label>
              <input
                id="append-input"
                type="file"
                accept=".csv,.html,text/html,text/csv"
                multiple
                onChange={appendFiles}
              />
            </>
          ) : null}
          <p className="hint">
            Bundled data is packed at build time. Session rows load for the selected date range (default last
            14 days).
          </p>
          <div className={`warn-banner ${showHtmlWarn ? "visible" : ""}`}>
            Large HTML files can make the tab hang briefly while parsing.
          </div>
        </div>
        {status ? <div className="status-line">{status}</div> : null}

        {batches.length > 0 ? (
          <div className="batch-summary-bar">
            <span>
              <strong>{batchSummary.batchCount}</strong> day(s) included ·{" "}
              <strong>{batchSummary.totalSessions.toLocaleString()}</strong> sessions
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
            <details className="collapse-table-drawer global-filters-drawer">
              <summary>
                Data filters
                {excludeErrors && errorSessionCount > 0
                  ? ` · ${errorSessionCount.toLocaleString()} error session${errorSessionCount === 1 ? "" : "s"} excluded`
                  : ""}
              </summary>
              <div className="global-filters-drawer-body">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={excludeErrors}
                    onChange={(e) => setExcludeErrors(e.target.checked)}
                  />
                  Exclude sessions tagged <strong>Error</strong> (failed LLM rating)
                </label>
              </div>
            </details>

            <div className="tab-content">
              {activeTab === "overview" ? (
                <OverviewTab
                  batches={batches}
                  workingBatches={workingBatches}
                  rangeBatchCount={rangeBatches.length}
                  stats={stats}
                  funnelRows={funnelRows}
                  tagFilter={tagFilter}
                  rangeStartStr={rangeStartStr}
                  rangeEndStr={rangeEndStr}
                  appliedRange={appliedRange}
                  onDateRange={applyDateRange}
                  onTagFilter={updateTagFilter}
                  toggleQaTag={toggleQaTag}
                  toggleCategoryTag={toggleCategoryTag}
                  clearTagFilter={clearTagFilter}
                  openTimeline={openTimeline}
                  showTimeline={showTimeline}
                  releaseMarkers={releaseMarkers}
                  sessionsLoading={sessionsLoading}
                  sessionsNote={sessionsNote}
                />
              ) : null}

              {activeTab === "timeline" ? (
                <TimelineTab
                  batches={workingBatches}
                  allBatches={sortedAllBatches}
                  lowScoreOnly={tagFilter.lowScoreOnly}
                  initialTag={timelineFocusTag}
                />
              ) : null}

              {activeTab === "funnel" ? (
                <FunnelTab
                  pool={analyticsPool}
                  totalCount={stats.total}
                  tagFilter={tagFilter}
                  onUpdateFilter={updateTagFilter}
                  poolLabel={stats.poolLabel}
                />
              ) : null}

              {activeTab === "discovery" ? (
                <DiscoveryTagsTab
                  pool={analyticsPool}
                  totalCount={stats.total}
                  poolLabel={discoveryPoolLabel}
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
