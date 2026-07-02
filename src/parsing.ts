export type TagKind = "qa" | "discovery" | "structural";

export type RatingRow = {
  chatbot_sid?: string;
  time?: string;
  user_id?: string;
  num_turns?: number;
  overall_score: number;
  axis1: number;
  axis2: number;
  axis3: number;
  /** QA failure tags only */
  qaTags: string[];
  /** Product/workflow discovery tags */
  discoveryTags: string[];
  /** Session structure tags (Slotfill, Video, …) */
  structuralTags: string[];
  tagReasons: Record<string, string>;
  discoveryTagReasons: Record<string, string>;
  reasoning?: string;
  /** All display tags combined (structural + qa + discovery) */
  tags: string[];
  /** Source file batch id (for timeline) */
  batchId?: string;
};

export type LoadedBatch = {
  id: string;
  fileName: string;
  label: string;
  rows: RatingRow[];
  periodDate: Date | null;
};

export type TagStatRow = {
  tag: string;
  count: number;
  pctOfPool: number;
  pctOfTotal: number;
};

const STRUCTURAL_TAGS = new Set([
  "Image_Slotfill",
  "Image Upload Tag",
  "Slot-filling",
  "User actions",
  "Video",
  "Image upload",
  "Speech to text",
]);

export function isStructuralTag(tag: string): boolean {
  const t = String(tag || "").trim();
  return STRUCTURAL_TAGS.has(t) || t.startsWith("Slotfill ·");
}

export function parseSessionTime(str: string | undefined): Date | null {
  if (str == null || String(str).trim() === "") return null;
  const d = new Date(String(str).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function rowInRange(row: RatingRow, start: Date | null, end: Date | null): boolean {
  const t = parseSessionTime(row.time);
  if (!t) return true;
  if (start && t < start) return false;
  if (end && t > end) return false;
  return true;
}

export function filterRows(rows: RatingRow[], start: Date | null, end: Date | null): RatingRow[] {
  return rows.filter((r) => rowInRange(r, start, end));
}

function splitTags(tagsCell: string | undefined): string[] {
  if (tagsCell == null || String(tagsCell).trim() === "") return [];
  return String(tagsCell)
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTagReasonsFromList(listEl: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!listEl) return out;
  listEl.querySelectorAll("li").forEach((li) => {
    const badge = li.querySelector(".badge");
    if (!badge) return;
    const tag = (badge.textContent || "").trim();
    if (!tag) return;
    const full = (li.textContent || "").trim();
    const reason = full.slice(tag.length).trim().replace(/^[:\s-]+/, "");
    if (reason) out[tag] = reason;
  });
  return out;
}

function classifyHeaderBadge(el: Element): { kind: TagKind; tag: string } | null {
  const tag = (el.textContent || "").trim();
  if (!tag || /^Overall Score:/i.test(tag)) return null;
  const cls = el.className || "";
  if (/\bdiscovery-tag\b/.test(cls) || /\bcategory-tag\b/.test(cls)) return { kind: "discovery", tag };
  if (/\btag\b/.test(cls) && !/\bcategory-tag\b/.test(cls)) return { kind: "qa", tag };
  return { kind: "structural", tag };
}

export function normalizeRowsFromCsv(data: Record<string, string>[]): RatingRow[] {
  const rows: RatingRow[] = [];
  for (const r of data) {
    const overall = parseFloat(r.overall_score);
    const axis1 = parseFloat(r.axis1);
    const axis2 = parseFloat(r.axis2);
    const axis3 = parseFloat(r.axis3);
    const allTags = splitTags(r.tags);
    const categoryFromCol = splitTags(r.category_tags);
    const discoveryFromCol = splitTags(r.discovery_tags);
    const qaFromCol = splitTags(r.qa_tags || r.issue_tags);
    const structuralTags = allTags.filter((t) => isStructuralTag(t));
    const qaTagsRaw = qaFromCol.length
      ? qaFromCol
      : allTags.filter(
          (t) =>
            !isStructuralTag(t) &&
            !categoryFromCol.includes(t) &&
            !discoveryFromCol.includes(t)
        );
    const discoveryTagsRaw =
      categoryFromCol.length || discoveryFromCol.length
        ? [
            ...categoryFromCol,
            ...discoveryFromCol.filter((t) => !categoryFromCol.includes(t)),
          ]
        : [];
    const { qaTags, discoveryTags } = disjointTagLists(qaTagsRaw, discoveryTagsRaw);
    rows.push({
      chatbot_sid: r.chatbot_sid,
      time: r.time,
      user_id: r.user_id,
      num_turns: parseInt(String(r.message_count || ""), 10) || undefined,
      overall_score: Number.isFinite(overall) ? overall : NaN,
      axis1: Number.isFinite(axis1) ? axis1 : NaN,
      axis2: Number.isFinite(axis2) ? axis2 : NaN,
      axis3: Number.isFinite(axis3) ? axis3 : NaN,
      qaTags,
      discoveryTags,
      structuralTags,
      tagReasons: {},
      discoveryTagReasons: {},
      reasoning: r.reasoning,
      tags: [...structuralTags, ...qaTags, ...discoveryTags],
    });
  }
  return rows;
}

export function normalizeRowsFromHtml(htmlText: string): RatingRow[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const cards = doc.querySelectorAll(".session-card[data-manual-sid]");
  const rows: RatingRow[] = [];

  cards.forEach((card) => {
    const sid = (card.getAttribute("data-manual-sid") || "").trim();
    const scoreStr = card.getAttribute("data-score");
    const overall = scoreStr != null ? parseFloat(scoreStr) : NaN;

    let axis1 = NaN;
    let axis2 = NaN;
    let axis3 = NaN;
    card.querySelectorAll(".grid .grid-item").forEach((el) => {
      const label = el.textContent || "";
      const strong = el.querySelector("strong");
      if (!strong) return;
      const m = /^(\d+(?:\.\d+)?)\s*\/\s*5/.exec(strong.textContent || "");
      if (!m) return;
      const v = parseFloat(m[1]);
      if (/Goal Resolution/i.test(label)) axis1 = v;
      else if (/Reliability/i.test(label)) axis2 = v;
      else if (/Sentiment/i.test(label)) axis3 = v;
    });

    const header = card.querySelector(".header");
    let sessionTime = "";
    let userId = "";
    let numTurns: number | undefined;
    if (header) {
      const timeM = /Time:\s*<\/strong>\s*([^<]+)/i.exec(header.innerHTML);
      if (timeM) sessionTime = timeM[1].trim();
      const userM = /User ID:\s*<\/strong>\s*([^<]+)/i.exec(header.innerHTML);
      if (userM) userId = userM[1].trim();
      const turnsM = /Turns:\s*<\/strong>\s*(\d+)/i.exec(header.innerHTML);
      if (turnsM) numTurns = parseInt(turnsM[1], 10);
    }

    const qaTags: string[] = [];
    const discoveryTags: string[] = [];
    const structuralTags: string[] = [];

    if (header) {
      header.querySelectorAll(".badge").forEach((b) => {
        const c = classifyHeaderBadge(b);
        if (!c) return;
        if (c.kind === "qa" && !qaTags.includes(c.tag)) qaTags.push(c.tag);
        else if (c.kind === "discovery" && !discoveryTags.includes(c.tag)) discoveryTags.push(c.tag);
        else if (c.kind === "structural" && !structuralTags.includes(c.tag)) structuralTags.push(c.tag);
      });
    }

    card.querySelectorAll(".discovery-tags-row .badge.discovery-tag, .category-tags-row .badge.category-tag").forEach((b) => {
      const t = (b.textContent || "").trim();
      if (t && !discoveryTags.includes(t)) discoveryTags.push(t);
    });

    const categoryFromData = (card.getAttribute("data-category-tags") || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const t of categoryFromData) {
      if (!discoveryTags.includes(t)) discoveryTags.push(t);
    }

    const discoveryFromData = (card.getAttribute("data-discovery-tags") || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const t of discoveryFromData) {
      if (!discoveryTags.includes(t)) discoveryTags.push(t);
    }

    const issueFromData = (card.getAttribute("data-issue-tags") || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const t of issueFromData) {
      if (!qaTags.includes(t)) qaTags.push(t);
    }

    const reasonBlocks = card.querySelectorAll(".tag-reasons-block");
    let tagReasons: Record<string, string> = {};
    let discoveryTagReasons: Record<string, string> = {};
    reasonBlocks.forEach((block) => {
      const heading = (block.querySelector("strong")?.textContent || "").toLowerCase();
      const list = block.querySelector("ul.tag-reason-list");
      if (/discovery/.test(heading)) {
        discoveryTagReasons = { ...discoveryTagReasons, ...parseTagReasonsFromList(list) };
      } else {
        tagReasons = { ...tagReasons, ...parseTagReasonsFromList(list) };
      }
    });

    for (const t of Object.keys(tagReasons)) {
      if (!qaTags.includes(t)) qaTags.push(t);
    }
    for (const t of Object.keys(discoveryTagReasons)) {
      if (!discoveryTags.includes(t)) discoveryTags.push(t);
    }

    const disjoint = disjointTagLists(qaTags, discoveryTags);

    let reasoning = "";
    const summaryEl = card.querySelector(".reasoning");
    if (summaryEl) {
      reasoning = (summaryEl.textContent || "")
        .replace(/^(AI Reasoning|Session summary):\s*/i, "")
        .trim();
    }

    rows.push({
      chatbot_sid: sid,
      time: sessionTime,
      user_id: userId,
      num_turns: numTurns,
      overall_score: overall,
      axis1,
      axis2,
      axis3,
      qaTags: disjoint.qaTags,
      discoveryTags: disjoint.discoveryTags,
      structuralTags,
      tagReasons,
      discoveryTagReasons,
      reasoning,
      tags: [...structuralTags, ...disjoint.qaTags, ...disjoint.discoveryTags],
    });
  });

  return rows;
}

export function disjointTagLists(
  qaTags: string[],
  discoveryTags: string[]
): { qaTags: string[]; discoveryTags: string[] } {
  const discSet = new Set(discoveryTags);
  return {
    qaTags: qaTags.filter((t) => !discSet.has(t)),
    discoveryTags,
  };
}

export function isLowRated(r: RatingRow): boolean {
  return Number.isFinite(r.overall_score) && r.overall_score <= 5;
}

/** Session where LLM rating failed (issue tag Error or reasoning "Error: …"). */
export function isErrorSession(row: RatingRow): boolean {
  if (row.qaTags.includes("Error")) return true;
  if (row.tags.includes("Error")) return true;
  return /^Error:/i.test(String(row.reasoning || "").trim());
}

export function excludeErrorSessions(rows: RatingRow[]): RatingRow[] {
  return rows.filter((r) => !isErrorSession(r));
}

export function batchesExcludingErrors(batches: LoadedBatch[]): LoadedBatch[] {
  return batches.map((b) => ({ ...b, rows: excludeErrorSessions(b.rows) }));
}

export function computeTagStats(
  pool: RatingRow[],
  pickTags: (r: RatingRow) => string[],
  totalCount: number
): TagStatRow[] {
  const byTag: Record<string, number> = {};
  for (const r of pool) {
    for (const t of pickTags(r)) {
      byTag[t] = (byTag[t] || 0) + 1;
    }
  }
  const denom = pool.length || 1;
  const total = totalCount || 1;
  return Object.entries(byTag)
    .map(([tag, count]) => ({
      tag,
      count,
      pctOfPool: (100 * count) / denom,
      pctOfTotal: (100 * count) / total,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Tag stats with names that appear only in one list (tags vs categories). */
export function computeExclusiveTagStats(
  pool: RatingRow[],
  kind: "qa" | "discovery",
  totalCount: number
): TagStatRow[] {
  const otherTags = new Set(pool.flatMap((r) => (kind === "qa" ? r.discoveryTags : r.qaTags)));
  const pick = kind === "qa" ? (r: RatingRow) => r.qaTags : (r: RatingRow) => r.discoveryTags;
  return computeTagStats(pool, pick, totalCount).filter((row) => !otherTags.has(row.tag));
}

/** @deprecated use computeTagStats */
export function computeTagStatsForLowPool(lowRows: RatingRow[]): Record<string, number> {
  const byTag: Record<string, number> = {};
  for (const r of lowRows) {
    for (const t of r.qaTags || []) {
      byTag[t] = (byTag[t] || 0) + 1;
    }
  }
  return byTag;
}

export type FunnelOrder = "categories-first" | "tags-first";

export type TagFilterState = {
  qaTags: string[];
  discoveryTags: string[];
  /** Sessions must include every selected tag (funnel AND). */
  matchMode: "all" | "any";
  maxScore: number | null;
  lowScoreOnly: boolean;
  /** Order of sequential funnel steps in the Funnel tab */
  funnelOrder: FunnelOrder;
};

export function defaultTagFilter(): TagFilterState {
  return {
    qaTags: [],
    discoveryTags: [],
    matchMode: "all",
    maxScore: null,
    lowScoreOnly: true,
    funnelOrder: "categories-first",
  };
}

export function rowMatchesTagFilter(row: RatingRow, filter: TagFilterState): boolean {
  if (filter.lowScoreOnly && !isLowRated(row)) return false;
  if (filter.maxScore != null && Number.isFinite(row.overall_score) && row.overall_score > filter.maxScore) {
    return false;
  }

  const qaSel = filter.qaTags;
  const discSel = filter.discoveryTags;
  if (!qaSel.length && !discSel.length) return true;

  const matchList = (selected: string[], have: string[]) => {
    if (!selected.length) return true;
    if (filter.matchMode === "any") {
      return selected.some((t) => have.includes(t));
    }
    return selected.every((t) => have.includes(t));
  };

  return matchList(qaSel, row.qaTags) && matchList(discSel, row.discoveryTags);
}

export function filterRowsByTags(rows: RatingRow[], filter: TagFilterState): RatingRow[] {
  return rows.filter((r) => rowMatchesTagFilter(r, filter));
}

export function mergeAndDedupeByChatbotSid(rows: RatingRow[]): RatingRow[] {
  const bySid = new Map<string, RatingRow>();
  const noSid: RatingRow[] = [];
  for (const r of rows) {
    const sid = String(r.chatbot_sid || "").trim();
    if (!sid) {
      noSid.push(r);
      continue;
    }
    const prev = bySid.get(sid);
    if (!prev) {
      bySid.set(sid, r);
      continue;
    }
    const tp = parseSessionTime(prev.time)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tn = parseSessionTime(r.time)?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (tn >= tp) bySid.set(sid, r);
  }
  return [...bySid.values(), ...noSid];
}

export function setDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Infer a human-readable period label and sort date from filename or row times. */
export function inferPeriodFromFile(
  fileName: string,
  rows: RatingRow[]
): { label: string; periodDate: Date | null } {
  const base = fileName.replace(/\.(html|csv)$/i, "");

  const yymmdd = /(?:^|[_-])(\d{2})(\d{2})(\d{2})(?:[_-]|$)/.exec(base);
  if (yymmdd) {
    const yy = parseInt(yymmdd[1], 10);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const month = parseInt(yymmdd[2], 10) - 1;
    const day = parseInt(yymmdd[3], 10);
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) {
      return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), periodDate: d };
    }
  }

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(base);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    if (!Number.isNaN(d.getTime())) {
      return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), periodDate: d };
    }
  }

  const calendarDay = /calendar[_-]?day[_-]?(\d{4})-(\d{2})-(\d{2})/i.exec(base);
  if (calendarDay) {
    const d = new Date(parseInt(calendarDay[1], 10), parseInt(calendarDay[2], 10) - 1, parseInt(calendarDay[3], 10));
    if (!Number.isNaN(d.getTime())) {
      return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), periodDate: d };
    }
  }

  const monthRange = /([A-Za-z]+)_(\d+)-([A-Za-z]+)_(\d+)/.exec(base);
  if (monthRange) {
    return { label: `${monthRange[1]} ${monthRange[2]} – ${monthRange[3]} ${monthRange[4]}`, periodDate: null };
  }

  const times = rows.map((r) => parseSessionTime(r.time)).filter(Boolean) as Date[];
  if (times.length) {
    times.sort((a, b) => a.getTime() - b.getTime());
    const median = times[Math.floor(times.length / 2)];
    return {
      label: median.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      periodDate: median,
    };
  }

  const short = base.length > 40 ? `${base.slice(0, 37)}…` : base;
  return { label: short, periodDate: null };
}

export function createBatch(fileName: string, rows: RatingRow[]): LoadedBatch {
  const id = `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { label, periodDate } = inferPeriodFromFile(fileName, rows);
  const tagged = rows.map((r) => ({ ...r, batchId: id }));
  return { id, fileName, label, rows: tagged, periodDate };
}

export function updateBatchLabel(batch: LoadedBatch, label: string): LoadedBatch {
  return { ...batch, label };
}
