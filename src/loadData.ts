import Papa from "papaparse";
import type { LoadedBatch, RatingRow } from "./parsing";
import {
  createBatch,
  mergeAndDedupeByChatbotSid,
  normalizeRowsFromCsv,
  normalizeRowsFromHtml,
} from "./parsing";

export type ParsedFile = {
  fileName: string;
  rows: RatingRow[];
  htmlSource?: { name: string; text: string };
};

export type LoadedData = {
  batches: LoadedBatch[];
  merged: RatingRow[];
  htmlSources: { name: string; text: string }[];
  skippedFiles?: string[];
};

export function parseFileContent(fileName: string, text: string): ParsedFile {
  const name = fileName.toLowerCase();
  const isHtml = name.endsWith(".html");
  const rows = isHtml
    ? normalizeRowsFromHtml(text)
    : normalizeRowsFromCsv(
        Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data
      );
  return {
    fileName,
    rows,
    htmlSource: isHtml ? { name: fileName, text } : undefined,
  };
}

export function buildLoadedData(parsed: ParsedFile[]): LoadedData {
  const batches: LoadedBatch[] = [];
  const combined: RatingRow[] = [];
  const htmlSources: { name: string; text: string }[] = [];
  for (const file of parsed) {
    const batch = createBatch(file.fileName, file.rows);
    batches.push(batch);
    combined.push(...batch.rows);
    if (file.htmlSource) htmlSources.push(file.htmlSource);
  }
  return {
    batches,
    merged: mergeAndDedupeByChatbotSid(combined),
    htmlSources,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.text();
}

export function resolveDataUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const clean = pathOrUrl.replace(/^\//, "");
  if (clean.startsWith("data/")) {
    return `${import.meta.env.BASE_URL}${clean}`;
  }
  return `${import.meta.env.BASE_URL}data/${clean}`;
}

export function fileNameFromPath(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.split("?")[0];
  const parts = withoutQuery.split("/");
  return parts[parts.length - 1] || pathOrUrl;
}

export async function loadManifest(): Promise<string[]> {
  const url = `${import.meta.env.BASE_URL}data/manifest.json?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const manifest = (await res.json()) as { files?: string[] };
    return manifest.files ?? [];
  } catch {
    return [];
  }
}

/** Optional `?data=file.csv,https://...` query param for ad-hoc loads. */
export function getUrlDataParam(): string[] {
  const raw = new URLSearchParams(window.location.search).get("data");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function loadDataSources(
  paths: string[]
): Promise<{ parsed: ParsedFile[]; skipped: string[] }> {
  const parsed: ParsedFile[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    try {
      const url = resolveDataUrl(path);
      const text = await fetchText(url);
      parsed.push(parseFileContent(fileNameFromPath(path), text));
    } catch (err) {
      console.warn(`Skipping data file: ${path}`, err);
      skipped.push(path);
    }
  }
  return { parsed, skipped };
}

export async function loadBundledData(): Promise<LoadedData | null> {
  const paths = [...(await loadManifest()), ...getUrlDataParam()];
  if (!paths.length) return null;
  const { parsed, skipped } = await loadDataSources(paths);
  if (!parsed.length) return null;
  return { ...buildLoadedData(parsed), skippedFiles: skipped.length ? skipped : undefined };
}
