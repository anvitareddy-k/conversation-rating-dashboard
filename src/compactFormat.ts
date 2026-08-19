/** Compact on-disk format produced by scripts/pack-data.mjs */

export type ScoreBucketId = "6plus" | "5" | "4" | "3" | "2" | "1" | "unknown";
export type LowScoreBandId = "1-2" | "2-3" | "3-4" | "4-5";

export type DaySlice = {
  total: number;
  lowRated: number;
  buckets: Record<ScoreBucketId, number>;
  turnSum: number;
  withTurns: number;
  qa: Record<string, number>;
  cat: Record<string, number>;
  disc: Record<string, number>;
  qaLow: Record<string, number>;
  catLow: Record<string, number>;
  ask?: Record<string, number>;
  askLow?: Record<string, number>;
  bands: Record<LowScoreBandId, number>;
};

export type CompactDayMeta = {
  date: string;
  label: string;
  fileName: string;
  file: string;
  rows: number;
};

export type CompactAggregates = {
  version: string;
  days: {
    date: string;
    label: string;
    fileName: string;
    all: DaySlice;
    noError: DaySlice;
  }[];
};

export type CompactManifest = {
  version: string;
  days: CompactDayMeta[];
};

/** sid, time, turns, score, a1, a2, a3, qaIdx[], catIdx[], discIdx[], err, askIdx|-1 */
export type CompactRowTuple = [
  string,
  string | 0,
  number,
  number,
  number,
  number,
  number,
  number[],
  number[],
  number[],
  0 | 1,
  number?,
];

export type CompactDayFile = {
  date: string;
  label: string;
  fileName: string;
  dict: string[];
  rows: CompactRowTuple[];
};

export const EMPTY_REASONS: Record<string, string> = {};
