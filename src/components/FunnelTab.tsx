import { useMemo, useState } from "react";
import type { FunnelStep } from "../analytics";
import { computeFunnelSteps, getFunnelMatchedRows, getFunnelStatsPool } from "../analytics";
import { LABELS } from "../labels";
import { KindBadge } from "./KindBadge";
import type { FunnelOrder, PickableTagKind, RatingRow, TagFilterState, TagStatRow } from "../parsing";
import { computeTagStats } from "../parsing";

type FunnelTabProps = {
  pool: RatingRow[];
  totalCount: number;
  tagFilter: TagFilterState;
  onUpdateFilter: (updater: (f: TagFilterState) => TagFilterState) => void;
  poolLabel: string;
};

function kindLabel(stepKind: FunnelStep["kind"]): string {
  if (stepKind === "qa") return LABELS.tags;
  if (stepKind === "category") return LABELS.categories;
  if (stepKind === "score") return "Score";
  return "Pool";
}

function FunnelVisualization({ steps, startCount }: { steps: FunnelStep[]; startCount: number }) {
  const maxCount = steps[0]?.count || 1;
  const finalCount = steps[steps.length - 1]?.count ?? 0;
  const overallRetention = startCount ? (100 * finalCount) / startCount : 0;
  const totalDropped = startCount - finalCount;

  if (steps.length <= 1) {
    return (
      <div className="funnel-empty-state">
        <p>Select {LABELS.categories.toLowerCase()} and/or {LABELS.tags.toLowerCase()} above.</p>
        <p className="funnel-empty-sub">Each step narrows sessions — the chart shows how many remain after every filter.</p>
      </div>
    );
  }

  return (
    <div className="funnel-waterfall">
      <div className="funnel-summary-row">
        <div className="funnel-summary-stat">
          <span className="funnel-summary-value">{startCount.toLocaleString()}</span>
          <span className="funnel-summary-label">Started</span>
        </div>
        <div className="funnel-summary-stat warn">
          <span className="funnel-summary-value">−{totalDropped.toLocaleString()}</span>
          <span className="funnel-summary-label">Filtered out</span>
        </div>
        <div className="funnel-summary-stat highlight">
          <span className="funnel-summary-value">{finalCount.toLocaleString()}</span>
          <span className="funnel-summary-label">Remaining</span>
        </div>
        <div className="funnel-summary-stat">
          <span className="funnel-summary-value">{overallRetention.toFixed(1)}%</span>
          <span className="funnel-summary-label">Retained</span>
        </div>
      </div>

      <div className="funnel-waterfall-steps">
        {steps.map((step, i) => {
          const widthPct = maxCount ? (100 * step.count) / maxCount : 100;
          const isFirst = i === 0;
          const showDrop = !isFirst && step.dropFromPrev != null && step.dropFromPrev > 0;

          return (
            <div key={`${step.label}-${step.stepIndex}`} className="funnel-waterfall-step">
              {showDrop ? (
                <div className="funnel-drop-row" aria-hidden="true">
                  <span className="funnel-drop-line" />
                  <span className="funnel-drop-pill">
                    −{step.dropFromPrev!.toLocaleString()}
                    <span className="funnel-drop-pct">{step.dropPctFromPrev?.toFixed(0)}% drop</span>
                  </span>
                  <span className="funnel-drop-line" />
                </div>
              ) : null}

              <div className={`funnel-waterfall-row kind-${step.kind}`}>
                <div className="funnel-waterfall-label">
                  <span className={`funnel-step-badge ${step.kind}`}>{step.stepIndex + 1}</span>
                  <div className="funnel-waterfall-label-text">
                    <span className="funnel-waterfall-kind">{kindLabel(step.kind)}</span>
                    <span className="funnel-waterfall-name" title={step.label}>
                      {step.label.replace(/^\+ (Issue tags|Categories): /, "")}
                    </span>
                  </div>
                </div>

                <div className="funnel-waterfall-track-wrap">
                  <div className="funnel-waterfall-track">
                    <div
                      className={`funnel-waterfall-fill ${step.kind}`}
                      style={{ width: `${Math.max(widthPct, step.count > 0 ? 6 : 0)}%` }}
                    >
                      {widthPct >= 22 ? (
                        <>
                          <span className="funnel-fill-count">{step.count.toLocaleString()}</span>
                          <span className="funnel-fill-pct">{step.pctOfStart.toFixed(1)}%</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {widthPct < 22 ? (
                    <span className="funnel-waterfall-track-outside">
                      {step.count.toLocaleString()} · {step.pctOfStart.toFixed(1)}%
                    </span>
                  ) : null}
                </div>

                <div className="funnel-waterfall-stats">
                  <span className="funnel-waterfall-stat-main">{step.count.toLocaleString()}</span>
                  <span className="funnel-waterfall-stat-sub">{step.pctOfStart.toFixed(1)}% of start</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FunnelTagChip({
  row,
  kind,
  active,
  stepNum,
  maxPct,
  onClick,
}: {
  row: TagStatRow;
  kind: PickableTagKind;
  active: boolean;
  stepNum: number | null;
  maxPct: number;
  onClick: () => void;
}) {
  const barPct = maxPct > 0 ? Math.min(100, (100 * row.pctOfPool) / maxPct) : 0;
  const chipClass = kind === "category" ? "discovery" : kind;
  return (
    <button
      type="button"
      className={`funnel-tag-chip ${chipClass} ${active ? "active" : ""}`}
      onClick={onClick}
      title={`${row.count} sessions · ${row.pctOfPool.toFixed(1)}% of step pool`}
    >
      <span className="funnel-tag-chip-bar" style={{ width: `${barPct}%` }} aria-hidden="true" />
      <span className="funnel-tag-chip-body">
        <span className="funnel-tag-chip-top">
          {stepNum != null ? <span className="funnel-tag-chip-step">#{stepNum}</span> : null}
          <span className="funnel-tag-chip-name">{row.tag}</span>
        </span>
        <span className="funnel-tag-chip-meta">
          <span>{row.count.toLocaleString()} sessions</span>
          <span className="funnel-tag-chip-pct">{row.pctOfPool.toFixed(1)}%</span>
        </span>
      </span>
    </button>
  );
}

function FunnelSessionsPanel({ rows }: { rows: RatingRow[] }) {
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const sids = useMemo(
    () =>
      rows
        .map((r) => r.chatbot_sid?.trim())
        .filter((s): s is string => Boolean(s)),
    [rows]
  );

  const displayRows = showAll ? rows : rows.slice(0, 50);

  const copySids = async () => {
    if (!sids.length) return;
    try {
      await navigator.clipboard.writeText(sids.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!rows.length) return null;

  return (
    <div className="chart-card full-width funnel-sessions-card">
      <div className="funnel-sessions-header">
        <h2>
          Matching sessions
          <span className="sub">
            {rows.length} session(s) · {sids.length} chatbot SID(s)
          </span>
        </h2>
        <div className="funnel-actions">
          {sids.length > 0 ? (
            <button type="button" onClick={copySids}>
              {copied ? "Copied!" : "Copy SIDs"}
            </button>
          ) : null}
          {rows.length > 50 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show first 50" : `Show all ${rows.length}`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="funnel-sessions-scroll">
        <table className="tag-table session-table funnel-sessions-table">
          <thead>
            <tr>
              <th>Chatbot SID</th>
              <th>Score</th>
              <th>{LABELS.categories}</th>
              <th>{LABELS.tags}</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.chatbot_sid || `${r.time}-${r.overall_score}`}>
                <td className="mono">{r.chatbot_sid || "—"}</td>
                <td>{Number.isFinite(r.overall_score) ? r.overall_score.toFixed(2) : "—"}</td>
                <td>
                  <div className="mini-tags">
                    {r.categoryTags.map((t) => (
                      <span key={t} className="mini-tag category">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="mini-tags">
                    {r.qaTags.map((t) => (
                      <span key={t} className="mini-tag qa">
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
    </div>
  );
}

function statsSubLabel(
  forPicker: "categories" | "tags",
  statsPool: RatingRow[],
  fullPool: RatingRow[],
  categoriesFirst: boolean,
  hasCategorySelection: boolean,
  hasTagSelection: boolean
): string {
  const n = statsPool.length;
  if (forPicker === "tags" && categoriesFirst && hasCategorySelection) {
    return `% within selected ${LABELS.categories.toLowerCase()} (${n.toLocaleString()} sessions)`;
  }
  if (forPicker === "categories" && !categoriesFirst && hasTagSelection) {
    return `% within selected ${LABELS.tags.toLowerCase()} (${n.toLocaleString()} sessions)`;
  }
  if (forPicker === "categories" && categoriesFirst && hasCategorySelection && n < fullPool.length) {
    return `% within current funnel step (${n.toLocaleString()} sessions)`;
  }
  return `% of pool (${n.toLocaleString()} sessions)`;
}

export function FunnelTab({
  pool,
  totalCount,
  tagFilter,
  onUpdateFilter,
  poolLabel,
}: FunnelTabProps) {
  const [builderQa, setBuilderQa] = useState<string[]>(tagFilter.qaTags);
  const [builderCat, setBuilderCat] = useState<string[]>(tagFilter.categoryTags);
  const [funnelOrder, setFunnelOrder] = useState<FunnelOrder>(
    tagFilter.funnelOrder ?? "categories-first"
  );
  const [categorySearch, setCategorySearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");

  const categoriesFirst = funnelOrder === "categories-first";

  const categoryStatsPool = useMemo(
    () => getFunnelStatsPool(pool, builderQa, builderCat, funnelOrder, "categories"),
    [pool, builderQa, builderCat, funnelOrder]
  );

  const tagStatsPool = useMemo(
    () => getFunnelStatsPool(pool, builderQa, builderCat, funnelOrder, "tags"),
    [pool, builderQa, builderCat, funnelOrder]
  );

  const catStats = useMemo(() => {
    const categoryNames = new Set(pool.flatMap((r) => r.categoryTags));
    return computeTagStats(categoryStatsPool, (r) => r.categoryTags, totalCount).filter((row) =>
      categoryNames.has(row.tag)
    );
  }, [categoryStatsPool, totalCount, pool]);

  const qaStats = useMemo(() => {
    const tagNames = new Set(pool.flatMap((r) => r.qaTags));
    return computeTagStats(tagStatsPool, (r) => r.qaTags, totalCount).filter((row) =>
      tagNames.has(row.tag)
    );
  }, [tagStatsPool, totalCount, pool]);

  const filteredCatStats = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    const list = q ? catStats.filter((r) => r.tag.toLowerCase().includes(q)) : catStats;
    return list.slice(0, 32);
  }, [catStats, categorySearch]);

  const filteredQaStats = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const list = q ? qaStats.filter((r) => r.tag.toLowerCase().includes(q)) : qaStats;
    return list.slice(0, 32);
  }, [qaStats, tagSearch]);

  const maxCatPct = useMemo(
    () => Math.max(...filteredCatStats.map((r) => r.pctOfPool), 1),
    [filteredCatStats]
  );

  const maxQaPct = useMemo(
    () => Math.max(...filteredQaStats.map((r) => r.pctOfPool), 1),
    [filteredQaStats]
  );

  const builderFilter: TagFilterState = {
    ...tagFilter,
    qaTags: builderQa,
    categoryTags: builderCat,
    funnelOrder,
    matchMode: "all",
  };

  const steps = useMemo(() => computeFunnelSteps(pool, builderFilter), [pool, builderFilter]);

  const matchedRows = useMemo(
    () => getFunnelMatchedRows(pool, builderFilter),
    [pool, builderFilter]
  );

  const orderedSelections = useMemo(() => {
    const items: { tag: string; kind: PickableTagKind; step: number }[] = [];
    let n = 1;
    if (categoriesFirst) {
      for (const tag of builderCat) items.push({ tag, kind: "category", step: n++ });
      for (const tag of builderQa) items.push({ tag, kind: "qa", step: n++ });
    } else {
      for (const tag of builderQa) items.push({ tag, kind: "qa", step: n++ });
      for (const tag of builderCat) items.push({ tag, kind: "category", step: n++ });
    }
    return items;
  }, [builderCat, builderQa, categoriesFirst]);

  const globalStepNumber = (kind: PickableTagKind, tag: string): number | null => {
    const catIdx = builderCat.indexOf(tag);
    const tagIdx = builderQa.indexOf(tag);
    if (kind === "category" && catIdx === -1) return null;
    if (kind === "qa" && tagIdx === -1) return null;
    if (categoriesFirst) {
      return kind === "category" ? catIdx + 1 : builderCat.length + tagIdx + 1;
    }
    return kind === "qa" ? tagIdx + 1 : builderQa.length + catIdx + 1;
  };

  const applyToDashboard = () => {
    onUpdateFilter((f) => ({
      ...f,
      qaTags: builderQa,
      categoryTags: builderCat,
      funnelOrder,
      matchMode: "all",
    }));
  };

  const clearBuilder = () => {
    setBuilderQa([]);
    setBuilderCat([]);
    setCategorySearch("");
    setTagSearch("");
  };

  const removeSelection = (tag: string, kind: PickableTagKind) => {
    if (kind === "qa") setBuilderQa((prev) => prev.filter((t) => t !== tag));
    else setBuilderCat((prev) => prev.filter((t) => t !== tag));
  };

  const renderCategoryPicker = () => (
    <div className="chart-card funnel-step-card kind-categories">
      <div className="funnel-step-card-head">
        <h2>
          {categoriesFirst ? "Step 1" : "Step 2"} — {LABELS.categories}
          <span className="sub">
            {statsSubLabel(
              "categories",
              categoryStatsPool,
              pool,
              categoriesFirst,
              builderCat.length > 0,
              builderQa.length > 0
            )}
          </span>
        </h2>
        <KindBadge kind="category" />
      </div>
      <input
        type="search"
        className="funnel-picker-search"
        placeholder={`Search ${LABELS.categories.toLowerCase()}…`}
        value={categorySearch}
        onChange={(e) => setCategorySearch(e.target.value)}
      />
      <div className="funnel-tag-chip-grid">
        {filteredCatStats.map((row) => (
          <FunnelTagChip
            key={row.tag}
            row={row}
            kind="category"
            active={builderCat.includes(row.tag)}
            stepNum={globalStepNumber("category", row.tag)}
            maxPct={maxCatPct}
            onClick={() =>
              setBuilderCat((prev) =>
                prev.includes(row.tag) ? prev.filter((t) => t !== row.tag) : [...prev, row.tag]
              )
            }
          />
        ))}
      </div>
    </div>
  );

  const renderTagPicker = () => (
    <div className="chart-card funnel-step-card kind-tags">
      <div className="funnel-step-card-head">
        <h2>
          {categoriesFirst ? "Step 2" : "Step 1"} — {LABELS.tags}
          <span className="sub">
            {statsSubLabel(
              "tags",
              tagStatsPool,
              pool,
              categoriesFirst,
              builderCat.length > 0,
              builderQa.length > 0
            )}
          </span>
        </h2>
        <KindBadge kind="qa" />
      </div>
      <input
        type="search"
        className="funnel-picker-search"
        placeholder={`Search ${LABELS.tags.toLowerCase()}…`}
        value={tagSearch}
        onChange={(e) => setTagSearch(e.target.value)}
      />
      <div className="funnel-tag-chip-grid">
        {filteredQaStats.map((row) => (
          <FunnelTagChip
            key={row.tag}
            row={row}
            kind="qa"
            active={builderQa.includes(row.tag)}
            stepNum={globalStepNumber("qa", row.tag)}
            maxPct={maxQaPct}
            onClick={() =>
              setBuilderQa((prev) =>
                prev.includes(row.tag) ? prev.filter((t) => t !== row.tag) : [...prev, row.tag]
              )
            }
          />
        ))}
      </div>
    </div>
  );

  const hasSelection = builderQa.length > 0 || builderCat.length > 0;

  return (
    <div className="funnel-tab">
      <div className="funnel-toolbar chart-card">
        <div className="toolbar-group">
          <span className="toolbar-label">Funnel order</span>
          <div className="segmented-control">
            <button
              type="button"
              className={funnelOrder === "categories-first" ? "active" : ""}
              onClick={() => setFunnelOrder("categories-first")}
            >
              {LABELS.categories} → {LABELS.tags}
            </button>
            <button
              type="button"
              className={funnelOrder === "tags-first" ? "active" : ""}
              onClick={() => setFunnelOrder("tags-first")}
            >
              {LABELS.tags} → {LABELS.categories}
            </button>
          </div>
        </div>
        <p className="funnel-toolbar-hint">
          Pick tags in order — each step keeps only sessions matching <strong>all</strong> prior
          filters. Bar width = share of the starting pool.
        </p>
      </div>

      {hasSelection ? (
        <div className="funnel-path-card chart-card">
          <span className="funnel-path-label">Your funnel</span>
          <div className="funnel-path-pills">
            {orderedSelections.map((item) => (
              <button
                key={`${item.kind}-${item.tag}`}
                type="button"
                className={`funnel-path-pill ${item.kind === "category" ? "discovery" : item.kind}`}
                onClick={() => removeSelection(item.tag, item.kind)}
                title="Remove step"
              >
                <span className="funnel-path-step">#{item.step}</span>
                {item.tag}
                <span className="funnel-path-remove">×</span>
              </button>
            ))}
          </div>
          <button type="button" className="funnel-path-clear" onClick={clearBuilder}>
            Clear all
          </button>
        </div>
      ) : null}

      <div className="funnel-builder-grid">
        {categoriesFirst ? (
          <>
            {renderCategoryPicker()}
            {renderTagPicker()}
          </>
        ) : (
          <>
            {renderTagPicker()}
            {renderCategoryPicker()}
          </>
        )}
      </div>

      <div className="chart-card full-width funnel-viz-card">
        <div className="funnel-header-row">
          <h2>
            Funnel
            <span className="sub">
              {poolLabel} · {pool.length.toLocaleString()} sessions
              {hasSelection ? ` · ${matchedRows.length.toLocaleString()} matching` : ""}
            </span>
          </h2>
          <div className="funnel-actions">
            <button type="button" onClick={clearBuilder}>
              Clear
            </button>
            <button type="button" className="btn-primary" onClick={applyToDashboard}>
              Apply to Overview
            </button>
          </div>
        </div>

        <FunnelVisualization steps={steps} startCount={pool.length} />
      </div>

      <FunnelSessionsPanel rows={matchedRows} />
    </div>
  );
}
