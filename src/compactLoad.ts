import type { CompactAggregates, CompactDayFile, CompactManifest } from "./compactFormat";
import { EMPTY_REASONS } from "./compactFormat";
import type { LoadedBatch, RatingRow } from "./parsing";

function compactUrl(path: string, version: string): string {
  const base = `${import.meta.env.BASE_URL}compact/${path.replace(/^\//, "")}`;
  return `${base}?v=${encodeURIComponent(version)}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

export function decodeCompactDay(file: CompactDayFile): RatingRow[] {
  const { dict, rows, date } = file;
  return rows.map((tuple) => {
    const [sid, t, turns, score, a1, a2, a3, qaIdx, catIdx, discIdx, err, askIdx] = tuple;
    const qaTags = qaIdx.map((i) => dict[i]).filter(Boolean);
    const categoryTags = catIdx.map((i) => dict[i]).filter(Boolean);
    const discoveryTags = discIdx.map((i) => dict[i]).filter(Boolean);
    if (err && !qaTags.includes("Error")) qaTags.push("Error");
    const tags = [...qaTags, ...categoryTags, ...discoveryTags];
    const learningAskType =
      typeof askIdx === "number" && askIdx >= 0 ? dict[askIdx] || undefined : undefined;
    return {
      chatbot_sid: sid || undefined,
      time: t ? String(t) : undefined,
      num_turns: turns > 0 ? turns : undefined,
      overall_score: score,
      axis1: a1,
      axis2: a2,
      axis3: a3,
      qaTags,
      categoryTags,
      discoveryTags,
      structuralTags: [],
      learningAskType,
      tagReasons: EMPTY_REASONS,
      discoveryTagReasons: EMPTY_REASONS,
      tags,
      batchId: date,
    };
  });
}

function periodFromDate(date: string): Date {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function batchesFromAggregates(agg: CompactAggregates): LoadedBatch[] {
  return agg.days.map((day) => ({
    id: day.date,
    fileName: day.fileName,
    label: day.label,
    rows: [],
    periodDate: periodFromDate(day.date),
    slices: { all: day.all, noError: day.noError },
  }));
}

export async function loadCompactManifest(): Promise<CompactManifest | null> {
  const url = `${import.meta.env.BASE_URL}compact/manifest.json?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as CompactManifest;
  } catch {
    return null;
  }
}

export async function loadCompactAggregates(version: string): Promise<CompactAggregates> {
  return fetchJson<CompactAggregates>(compactUrl("aggregates.json", version));
}

export async function loadCompactDays(
  dates: string[],
  manifest: CompactManifest
): Promise<Record<string, RatingRow[]>> {
  const byDate = new Map(manifest.days.map((d) => [d.date, d]));
  const unique = [...new Set(dates)].filter((d) => byDate.has(d));
  if (!unique.length) return {};

  const urls = unique.map((date) => compactUrl(byDate.get(date)!.file, manifest.version));

  let files: CompactDayFile[];
  try {
    files = await loadDaysInWorker(urls);
  } catch {
    files = await Promise.all(urls.map((u) => fetchJson<CompactDayFile>(u)));
  }

  const out: Record<string, RatingRow[]> = {};
  for (const file of files) {
    out[file.date] = decodeCompactDay(file);
  }
  return out;
}

function loadDaysInWorker(urls: string[]): Promise<CompactDayFile[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workers/loadDays.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Day-load worker timed out"));
    }, 120000);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; files?: CompactDayFile[]; error?: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok && e.data.files) resolve(e.data.files);
      else reject(new Error(e.data.error || "Day-load worker failed"));
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ urls });
  });
}

export function lastNDates(dates: string[], n: number): string[] {
  const sorted = [...dates].sort();
  return sorted.slice(-Math.min(n, sorted.length));
}
