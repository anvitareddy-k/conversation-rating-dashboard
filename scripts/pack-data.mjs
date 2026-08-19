/**
 * Pack public/data CSVs into compact JSON for the dashboard runtime.
 * Writes public/compact/aggregates.json, manifest.json, and days/*.json
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

const CATEGORY_VOCAB = new Set([
  "Gibberish / Unintelligible",
  "Non-Academic",
  "Academic",
  "Mock / Practice Questions",
  "Previous Year Questions",
  "Outside School Level Questions",
  "Non-CBSE Board",
  "Class 5 and Below CBSE",
  "Not Math/Science",
  "Image Upload",
  "Speech to Text",
  "Slotfill",
  "Blurry / Unclear Image",
  "Specific Named Resource",
  "Direct Response",
]);

const STRUCTURAL_TAGS = new Set([
  "Image_Slotfill",
  "Image Upload Tag",
  "Slot-filling",
  "User actions",
  "Video",
  "Image upload",
  "Speech to text",
]);

function isStructuralTag(tag) {
  const t = String(tag || "").trim();
  return STRUCTURAL_TAGS.has(t) || t.startsWith("Slotfill ·");
}

function splitTags(cell) {
  if (cell == null || String(cell).trim() === "") return [];
  return String(cell)
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvColumn(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  const norm = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().replace(/^\uFEFF/, "").toLowerCase(), v])
  );
  for (const name of names) {
    const v = norm.get(name.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

function splitCategoryAndDiscovery(categoryFromCol, discoveryFromCol) {
  const categoryTags = [];
  const discoveryTags = [];
  const ingest = (tag) => {
    const t = tag.trim();
    if (!t) return;
    if (CATEGORY_VOCAB.has(t)) {
      if (!categoryTags.includes(t)) categoryTags.push(t);
      return;
    }
    if (!discoveryTags.includes(t)) discoveryTags.push(t);
  };
  for (const t of categoryFromCol) ingest(t);
  for (const t of discoveryFromCol) ingest(t);
  return { categoryTags, discoveryTags };
}

function disjointTagLists(qaTags, categoryTags, discoveryTags) {
  const catSet = new Set(categoryTags);
  const discSet = new Set(discoveryTags);
  const nonQa = new Set([...catSet, ...discSet]);
  return {
    qaTags: qaTags.filter((t) => !nonQa.has(t)),
    categoryTags,
    discoveryTags: discoveryTags.filter((t) => !catSet.has(t)),
  };
}

function parseOverall(r) {
  const raw = csvColumn(r, "overall_score", "overall_rating", "overall rating");
  if (raw == null || String(raw).trim() === "") return NaN;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : NaN;
}

function scoreBucket(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score > 5) return "6plus";
  if (score > 4) return "5";
  if (score > 3) return "4";
  if (score > 2) return "3";
  if (score > 1) return "2";
  return "1";
}

function lowScoreBand(score) {
  if (!Number.isFinite(score) || score > 5) return null;
  if (score < 2) return "1-2";
  if (score < 3) return "2-3";
  if (score < 4) return "3-4";
  return "4-5";
}

function emptySlice() {
  return {
    total: 0,
    lowRated: 0,
    buckets: { "6plus": 0, "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, unknown: 0 },
    turnSum: 0,
    withTurns: 0,
    qa: {},
    cat: {},
    disc: {},
    qaLow: {},
    catLow: {},
    ask: {},
    askLow: {},
    bands: { "1-2": 0, "2-3": 0, "3-4": 0, "4-5": 0 },
  };
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function addRowToSlice(slice, row) {
  slice.total += 1;
  slice.buckets[scoreBucket(row.score)] += 1;
  const low = Number.isFinite(row.score) && row.score <= 5;
  if (low) {
    slice.lowRated += 1;
    const band = lowScoreBand(row.score);
    if (band) slice.bands[band] += 1;
  }
  if (row.turns > 0) {
    slice.turnSum += row.turns;
    slice.withTurns += 1;
  }
  for (const t of row.qa) {
    bump(slice.qa, t);
    if (low) bump(slice.qaLow, t);
  }
  for (const t of row.cat) {
    bump(slice.cat, t);
    if (low) bump(slice.catLow, t);
  }
  for (const t of row.disc) bump(slice.disc, t);
  if (row.ask) {
    bump(slice.ask, row.ask);
    if (low) bump(slice.askLow, row.ask);
  }
}

function inferDate(fileName, times) {
  const base = fileName.replace(/\.(html|csv)$/i, "");
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(base);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const yymmdd = /(?:^|[_-])(\d{2})(\d{2})(\d{2})(?:[_-]|$)/.exec(base);
  if (yymmdd) {
    const yy = parseInt(yymmdd[1], 10);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const d = new Date(year, parseInt(yymmdd[2], 10) - 1, parseInt(yymmdd[3], 10));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const parsed = times.map((t) => new Date(t)).filter((d) => !Number.isNaN(d.getTime()));
  if (parsed.length) {
    parsed.sort((a, b) => a.getTime() - b.getTime());
    return parsed[Math.floor(parsed.length / 2)];
  }
  return null;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function labelFor(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function normalizeCsvRow(r) {
  const overall = parseOverall(r);
  const allTags = splitTags(csvColumn(r, "tags"));
  const categoryFromCol = splitTags(csvColumn(r, "category_tags", "category tags"));
  const discoveryFromCol = splitTags(csvColumn(r, "discovery_tags", "discovery tags"));
  const qaFromCol = splitTags(csvColumn(r, "qa_tags", "issue_tags", "qa tags", "issue tags"));
  const { categoryTags, discoveryTags } = splitCategoryAndDiscovery(categoryFromCol, discoveryFromCol);
  const taggedInCols = new Set([...categoryFromCol, ...discoveryFromCol]);
  const qaTagsRaw = qaFromCol.length
    ? qaFromCol
    : allTags.filter((t) => !isStructuralTag(t) && !taggedInCols.has(t));
  const disjoint = disjointTagLists(qaTagsRaw, categoryTags, discoveryTags);
  const reasoning = csvColumn(r, "reasoning");
  const qa =
    disjoint.qaTags.includes("Error") || /^Error:/i.test(String(reasoning || "").trim())
      ? disjoint.qaTags.includes("Error")
        ? disjoint.qaTags
        : [...disjoint.qaTags, "Error"]
      : disjoint.qaTags;
  const turnsRaw = csvColumn(r, "message_count", "turns", "num_turns", "num turns");
  const turns = parseInt(String(turnsRaw || ""), 10) || 0;
  const ask = String(csvColumn(r, "learning_ask_type", "learning ask type") || "").trim();
  return {
    sid: String(csvColumn(r, "chatbot_sid", "chatbot sid") || "").trim(),
    t: String(csvColumn(r, "time") || "").trim(),
    turns,
    score: Number.isFinite(overall) ? overall : NaN,
    a1: parseFloat(csvColumn(r, "axis1") ?? "") || 0,
    a2: parseFloat(csvColumn(r, "axis2") ?? "") || 0,
    a3: parseFloat(csvColumn(r, "axis3") ?? "") || 0,
    qa,
    cat: disjoint.categoryTags,
    disc: disjoint.discoveryTags,
    ask: ask || "",
    err: qa.includes("Error") ? 1 : 0,
  };
}

function intern(dict, indexOf, tag) {
  let i = indexOf.get(tag);
  if (i == null) {
    i = dict.length;
    dict.push(tag);
    indexOf.set(tag, i);
  }
  return i;
}

export function packData(root = process.cwd()) {
  const dataDir = join(root, "public", "data");
  const compactDir = join(root, "public", "compact");
  const daysDir = join(compactDir, "days");

  const csvFiles = existsSync(dataDir)
    ? readdirSync(dataDir)
        .filter((name) => /\.csv$/i.test(name))
        .sort()
    : [];

  const hash = createHash("sha256");
  for (const name of csvFiles) {
    const st = statSync(join(dataDir, name));
    hash.update(`${name}:${st.size}:${Math.trunc(st.mtimeMs)}`);
  }
  hash.update("format:ask-v2");
  const version = hash.digest("hex").slice(0, 16);

  const existingVersionPath = join(compactDir, "manifest.json");
  if (existsSync(existingVersionPath)) {
    try {
      const prev = JSON.parse(readFileSync(existingVersionPath, "utf8"));
      if (prev.version === version && csvFiles.length === (prev.days?.length ?? -1)) {
        console.log(`Compact data up to date (${version}, ${csvFiles.length} days).`);
        return { version, days: csvFiles.length, skipped: true };
      }
    } catch {
      /* rebuild */
    }
  }

  if (existsSync(daysDir)) rmSync(daysDir, { recursive: true, force: true });
  mkdirSync(daysDir, { recursive: true });

  const dayAggs = [];
  const manifestDays = [];

  for (const name of csvFiles) {
    const text = readFileSync(join(dataDir, name), "utf8");
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = [];
    const times = [];
    for (const rec of parsed.data) {
      if (!rec || typeof rec !== "object") continue;
      const row = normalizeCsvRow(rec);
      if (row.t) times.push(row.t);
      rows.push(row);
    }
    const period = inferDate(name, times) ?? new Date();
    const date = ymd(period);
    const label = labelFor(period);
    const dict = [];
    const indexOf = new Map();
    const tuples = [];
    const all = emptySlice();
    const noError = emptySlice();

    for (const row of rows) {
      addRowToSlice(all, row);
      if (!row.err) addRowToSlice(noError, row);
      tuples.push([
        row.sid,
        row.t || 0,
        row.turns,
        Number.isFinite(row.score) ? Math.round(row.score * 1000) / 1000 : 0,
        Number.isFinite(row.a1) ? row.a1 : 0,
        Number.isFinite(row.a2) ? row.a2 : 0,
        Number.isFinite(row.a3) ? row.a3 : 0,
        row.qa.map((t) => intern(dict, indexOf, t)),
        row.cat.map((t) => intern(dict, indexOf, t)),
        row.disc.map((t) => intern(dict, indexOf, t)),
        row.err,
        row.ask ? intern(dict, indexOf, row.ask) : -1,
      ]);
    }

    const file = `days/${date}.json`;
    writeFileSync(
      join(compactDir, file),
      JSON.stringify({ date, label, fileName: name, dict, rows: tuples })
    );
    dayAggs.push({ date, label, fileName: name, all, noError });
    manifestDays.push({ date, label, fileName: name, file, rows: tuples.length });
    console.log(`Packed ${name} → ${file} (${tuples.length} rows)`);
  }

  writeFileSync(join(compactDir, "aggregates.json"), JSON.stringify({ version, days: dayAggs }));
  writeFileSync(join(compactDir, "manifest.json"), JSON.stringify({ version, days: manifestDays }));
  console.log(`Wrote compact pack ${version} with ${manifestDays.length} day(s).`);
  return { version, days: manifestDays.length, skipped: false };
}

const isMain = process.argv[1] && process.argv[1].includes("pack-data");
if (isMain) packData();
