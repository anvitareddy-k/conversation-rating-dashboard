import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type HtmlSource = {
  name: string;
  text: string;
};

type IndexedSource = HtmlSource & {
  /** Stable key used for selection + parse caching. */
  key: string;
  origin: "dashboard" | "viewer";
};

type ParsedCard = {
  html: string;
  sid: string;
  score: number;
  issueTags: string[];
  categoryTags: string[];
  /** Lowercased plain text used for fast client-side search. */
  searchText: string;
};

type TagOption = { tag: string; count: number };

type ParsedReport = {
  styleText: string;
  cards: ParsedCard[];
  /** Distinct issue/category tags across the report, sorted by frequency. */
  issueTagOptions: TagOption[];
  categoryTagOptions: TagOption[];
  /** Total cards parsed before any filtering. */
  totalCards: number;
  /** Approx. size of the source in MB. */
  sizeMb: number;
};

type SortMode = "doc" | "score-asc" | "score-desc";
type TagMatchMode = "all" | "any";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function splitTagAttr(value: string | null): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function rankTags(counts: Map<string, number>): TagOption[] {
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function matchSelectedTags(selected: string[], have: string[], mode: TagMatchMode): boolean {
  if (!selected.length) return true;
  if (mode === "any") return selected.some((t) => have.includes(t));
  return selected.every((t) => have.includes(t));
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

/**
 * Parse a large rating-report HTML entirely off the live DOM. DOMParser builds a
 * detached document that is never attached to the page, so nothing renders here —
 * we only pull out the stylesheet text and each session card's markup as strings.
 * The browser is only ever asked to render one page worth of cards at a time.
 */
function parseReport(htmlText: string): ParsedReport {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  const styleText = Array.from(doc.querySelectorAll("style"))
    .map((el) => el.textContent || "")
    .join("\n");

  const cardEls = doc.querySelectorAll(".session-card");
  const cards: ParsedCard[] = [];
  const issueCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  cardEls.forEach((el) => {
    const sid = (el.getAttribute("data-manual-sid") || "").trim();
    const scoreStr = el.getAttribute("data-score");
    const score = scoreStr != null ? parseFloat(scoreStr) : NaN;
    const issueTags = splitTagAttr(el.getAttribute("data-issue-tags"));
    const categoryTags = splitTagAttr(el.getAttribute("data-category-tags"));
    for (const t of issueTags) issueCounts.set(t, (issueCounts.get(t) || 0) + 1);
    for (const t of categoryTags) categoryCounts.set(t, (categoryCounts.get(t) || 0) + 1);
    cards.push({
      html: el.outerHTML,
      sid,
      score,
      issueTags,
      categoryTags,
      searchText: (el.textContent || "").toLowerCase(),
    });
  });

  return {
    styleText,
    cards,
    issueTagOptions: rankTags(issueCounts),
    categoryTagOptions: rankTags(categoryCounts),
    totalCards: cards.length,
    sizeMb: htmlText.length / (1024 * 1024),
  };
}

function buildSrcDoc(styleText: string, cards: ParsedCard[]): string {
  const body = cards.map((c) => c.html).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${styleText}</style>
<style>
  html, body { margin: 0; padding: 16px; background: #11161d; }
  .session-card:last-child { margin-bottom: 0; }
</style>
</head>
<body>${body}</body>
</html>`;
}

type HtmlViewerTabProps = {
  /** HTML files already uploaded on the main dashboard, shared so there's no re-upload. */
  sharedSources?: HtmlSource[];
};

export function HtmlViewerTab({ sharedSources }: HtmlViewerTabProps) {
  const [localSources, setLocalSources] = useState<HtmlSource[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("doc");
  const [selectedIssueTags, setSelectedIssueTags] = useState<string[]>([]);
  const [selectedCategoryTags, setSelectedCategoryTags] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>("all");
  const [maxScore, setMaxScore] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(600);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Parsed reports are memoized by source key so switching files (or pages) never re-parses.
  const cacheRef = useRef<Map<string, ParsedReport>>(new Map());

  const allSources = useMemo<IndexedSource[]>(() => {
    const out: IndexedSource[] = [];
    (sharedSources || []).forEach((s, i) => {
      out.push({ ...s, origin: "dashboard", key: `dash:${i}:${s.text.length}:${s.name}` });
    });
    localSources.forEach((s, i) => {
      out.push({ ...s, origin: "viewer", key: `local:${i}:${s.text.length}:${s.name}` });
    });
    return out;
  }, [sharedSources, localSources]);

  // Keep a valid selection as the available sources change.
  useEffect(() => {
    if (!allSources.length) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    if (!selectedKey || !allSources.some((s) => s.key === selectedKey)) {
      setSelectedKey(allSources[0].key);
    }
  }, [allSources, selectedKey]);

  const selectedSource = useMemo(
    () => allSources.find((s) => s.key === selectedKey) || null,
    [allSources, selectedKey]
  );

  const report = useMemo<ParsedReport | null>(() => {
    if (!selectedSource) return null;
    const cached = cacheRef.current.get(selectedSource.key);
    if (cached) return cached;
    const parsed = parseReport(selectedSource.text);
    cacheRef.current.set(selectedSource.key, parsed);
    return parsed;
  }, [selectedSource]);

  // Reset paging/search/filters when switching to a different file.
  useEffect(() => {
    setPage(0);
    setQuery("");
    setSortMode("doc");
    setSelectedIssueTags([]);
    setSelectedCategoryTags([]);
    setTagMatchMode("all");
    setMaxScore("");
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedSource || !report) {
      setStatus("");
      return;
    }
    if (!report.totalCards) {
      setStatus(
        `No session cards found in ${selectedSource.name}. This viewer expects a conversation rating report HTML.`
      );
    } else {
      setStatus(
        `${selectedSource.name}: ${report.totalCards} session card(s) (${report.sizeMb.toFixed(1)} MB).`
      );
    }
  }, [selectedSource, report]);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    setStatus(`Reading ${files.length} file(s)…`);
    (async () => {
      try {
        const added: HtmlSource[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const text = await readFileAsText(file);
          added.push({ name: file.name, text });
        }
        // Newly uploaded files become selectable; select the first new one.
        setLocalSources((prev) => [...prev, ...added]);
        setSelectedKey(`local:${localSources.length}:${added[0].text.length}:${added[0].name}`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    })();
    // Allow re-selecting the same file later.
    e.target.value = "";
  }, [localSources.length]);

  const maxScoreNum = useMemo(() => {
    const v = parseFloat(maxScore);
    return Number.isFinite(v) ? v : null;
  }, [maxScore]);

  const filteredCards = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    let cards = report.cards;
    if (q) {
      cards = cards.filter((c) => c.sid.toLowerCase().includes(q) || c.searchText.includes(q));
    }
    if (maxScoreNum != null) {
      cards = cards.filter((c) => !Number.isFinite(c.score) || c.score <= maxScoreNum);
    }
    if (selectedIssueTags.length || selectedCategoryTags.length) {
      cards = cards.filter(
        (c) =>
          matchSelectedTags(selectedIssueTags, c.issueTags, tagMatchMode) &&
          matchSelectedTags(selectedCategoryTags, c.categoryTags, tagMatchMode)
      );
    }
    if (sortMode !== "doc") {
      cards = cards.slice().sort((a, b) => {
        const av = Number.isFinite(a.score) ? a.score : sortMode === "score-asc" ? Infinity : -Infinity;
        const bv = Number.isFinite(b.score) ? b.score : sortMode === "score-asc" ? Infinity : -Infinity;
        return sortMode === "score-asc" ? av - bv : bv - av;
      });
    }
    return cards;
  }, [report, query, sortMode, maxScoreNum, selectedIssueTags, selectedCategoryTags, tagMatchMode]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);

  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);

  const pageCards = useMemo(() => {
    const start = clampedPage * pageSize;
    return filteredCards.slice(start, start + pageSize);
  }, [filteredCards, clampedPage, pageSize]);

  const srcDoc = useMemo(() => {
    if (!report) return "";
    return buildSrcDoc(report.styleText, pageCards);
  }, [report, pageCards]);

  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    const body = iframe?.contentWindow?.document?.body;
    if (body) {
      setIframeHeight(Math.max(400, body.scrollHeight + 8));
    }
  }, []);

  // Scroll the page viewer back to the top whenever the rendered page changes.
  useEffect(() => {
    iframeRef.current?.scrollIntoView({ block: "nearest" });
  }, [clampedPage, srcDoc]);

  const toggleIssueTag = useCallback((tag: string) => {
    setPage(0);
    setSelectedIssueTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const toggleCategoryTag = useCallback((tag: string) => {
    setPage(0);
    setSelectedCategoryTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearTagFilters = useCallback(() => {
    setPage(0);
    setSelectedIssueTags([]);
    setSelectedCategoryTags([]);
    setMaxScore("");
  }, []);

  const rangeStart = filteredCards.length ? clampedPage * pageSize + 1 : 0;
  const rangeEnd = Math.min(filteredCards.length, (clampedPage + 1) * pageSize);
  const hasSources = allSources.length > 0;
  const activeTagCount =
    selectedIssueTags.length + selectedCategoryTags.length + (maxScoreNum != null ? 1 : 0);

  return (
    <section className="html-viewer">
      <div className="upload-zone">
        {hasSources ? (
          <label className="viewer-inline-label viewer-file-picker">
            Viewing file
            <select value={selectedKey ?? ""} onChange={(e) => setSelectedKey(e.target.value)}>
              {allSources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                  {s.origin === "dashboard" ? "  (from dashboard upload)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="file-btn secondary" htmlFor="html-viewer-input">
          {hasSources ? "Add another HTML" : "Choose report HTML (multiple)"}
        </label>
        <input
          id="html-viewer-input"
          type="file"
          accept=".html,text/html"
          multiple
          onChange={onFile}
        />
        <p className="hint">
          HTML files you upload on the other tabs show up here automatically — no need to upload twice.
          Each file is parsed once off-screen and only the current page is rendered, so even
          multi-hundred-MB reports stay responsive.
        </p>
        {status ? <div className="status-line">{status}</div> : null}
      </div>

      {report && report.totalCards > 0 ? (
        <>
          <div className="viewer-controls">
            <div className="viewer-control-group">
              <input
                type="search"
                className="viewer-search"
                placeholder="Search SID or transcript text…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>

            <div className="viewer-control-group">
              <label className="viewer-inline-label">
                Sort
                <select
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value as SortMode);
                    setPage(0);
                  }}
                >
                  <option value="doc">Report order</option>
                  <option value="score-asc">Score: low → high</option>
                  <option value="score-desc">Score: high → low</option>
                </select>
              </label>
              <label className="viewer-inline-label">
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`viewer-filter-toggle ${showFilters ? "open" : ""} ${
                  activeTagCount ? "has-active" : ""
                }`}
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                {showFilters ? "Hide filters" : "Filter by tags"}
                {activeTagCount ? <span className="viewer-filter-badge">{activeTagCount}</span> : null}
              </button>
            </div>
          </div>

          {showFilters ? (
            <div className="viewer-filter-panel">
              <div className="viewer-filter-row">
                <label className="viewer-inline-label">
                  Tag match
                  <select
                    value={tagMatchMode}
                    onChange={(e) => {
                      setTagMatchMode(e.target.value as TagMatchMode);
                      setPage(0);
                    }}
                  >
                    <option value="all">All selected (AND)</option>
                    <option value="any">Any selected (OR)</option>
                  </select>
                </label>
                <label className="viewer-inline-label">
                  Max score
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    placeholder="any"
                    value={maxScore}
                    onChange={(e) => {
                      setMaxScore(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                {activeTagCount ? (
                  <button type="button" className="viewer-clear-tags" onClick={clearTagFilters}>
                    Clear {activeTagCount} filter(s)
                  </button>
                ) : null}
              </div>

              {report.issueTagOptions.length ? (
                <div className="viewer-tag-group">
                  <span className="viewer-tag-group-title">Issue tags</span>
                  <div className="viewer-tag-chips">
                    {report.issueTagOptions.map((o) => (
                      <button
                        key={o.tag}
                        type="button"
                        className={`viewer-tag-chip issue ${
                          selectedIssueTags.includes(o.tag) ? "active" : ""
                        }`}
                        onClick={() => toggleIssueTag(o.tag)}
                      >
                        {o.tag} <span className="viewer-tag-chip-count">{o.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {report.categoryTagOptions.length ? (
                <div className="viewer-tag-group">
                  <span className="viewer-tag-group-title">Category tags</span>
                  <div className="viewer-tag-chips">
                    {report.categoryTagOptions.map((o) => (
                      <button
                        key={o.tag}
                        type="button"
                        className={`viewer-tag-chip category ${
                          selectedCategoryTags.includes(o.tag) ? "active" : ""
                        }`}
                        onClick={() => toggleCategoryTag(o.tag)}
                      >
                        {o.tag} <span className="viewer-tag-chip-count">{o.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!report.issueTagOptions.length && !report.categoryTagOptions.length ? (
                <p className="hint" style={{ margin: 0 }}>
                  This report has no issue or category tag metadata to filter by.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="viewer-pager">
            <button type="button" onClick={() => setPage(0)} disabled={clampedPage === 0}>
              « First
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              ‹ Prev
            </button>
            <span className="viewer-pager-info">
              Page{" "}
              <input
                type="number"
                min={1}
                max={totalPages}
                value={clampedPage + 1}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) setPage(Math.min(totalPages, Math.max(1, v)) - 1);
                }}
              />{" "}
              of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              Next ›
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages - 1)}
              disabled={clampedPage >= totalPages - 1}
            >
              Last »
            </button>
            <span className="viewer-pager-count">
              Showing {rangeStart}–{rangeEnd} of {filteredCards.length}
              {query ? ` (filtered from ${report.totalCards})` : ""}
            </span>
          </div>

          <div className="viewer-frame-wrap">
            <iframe
              ref={iframeRef}
              title="Report viewer"
              className="viewer-frame"
              srcDoc={srcDoc}
              style={{ height: iframeHeight }}
              onLoad={resizeIframe}
              sandbox="allow-same-origin"
            />
          </div>

          <div className="viewer-pager bottom">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              ‹ Prev
            </button>
            <span className="viewer-pager-info">
              Page {clampedPage + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              Next ›
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          {busy
            ? "Working…"
            : hasSources
            ? "This file has no session cards to display."
            : "Upload a conversation rating report HTML — or load one on the Overview tab — to browse it page by page."}
        </div>
      )}
    </section>
  );
}
