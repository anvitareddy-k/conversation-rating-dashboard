import { useMemo } from "react";
import {
  appliedRangeFromStrings,
  formatDateLabel,
  setDateInputValue,
  type AppliedTimeRange,
  type LoadedBatch,
} from "../parsing";

export type DateRangePresetId = "all" | "latest" | "last7" | "last14" | "custom";

type DateRangeBarProps = {
  batches: LoadedBatch[];
  startStr: string;
  endStr: string;
  appliedRange: AppliedTimeRange | null;
  onChange: (startStr: string, endStr: string, applied: AppliedTimeRange | null) => void;
};

function uniqueSortedDays(batches: LoadedBatch[]): Date[] {
  const byKey = new Map<string, Date>();
  for (const b of batches) {
    if (!b.periodDate) continue;
    const key = setDateInputValue(b.periodDate);
    if (!byKey.has(key)) byKey.set(key, b.periodDate);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, d]) => d);
}

function daysFromSessionBounds(batches: LoadedBatch[]): { min: string; max: string } | null {
  let minT = Infinity;
  let maxT = -Infinity;
  for (const b of batches) {
    if (b.periodDate) {
      const t = b.periodDate.getTime();
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;
  return {
    min: setDateInputValue(new Date(minT)),
    max: setDateInputValue(new Date(maxT)),
  };
}

function detectPreset(
  startStr: string,
  endStr: string,
  appliedRange: AppliedTimeRange | null,
  days: Date[],
  bounds: { min: string; max: string } | null
): DateRangePresetId {
  if (appliedRange === null || (!startStr && !endStr)) return "all";
  if (!days.length || !bounds) return "custom";
  if (startStr === bounds.min && endStr === bounds.max) return "all";

  const latest = setDateInputValue(days[days.length - 1]);
  if (startStr === latest && endStr === latest) return "latest";

  if (days.length >= 2) {
    const last7 = days.slice(-Math.min(7, days.length));
    if (
      startStr === setDateInputValue(last7[0]) &&
      endStr === setDateInputValue(last7[last7.length - 1])
    ) {
      return "last7";
    }
  }
  if (days.length >= 2) {
    const last14 = days.slice(-Math.min(14, days.length));
    if (
      startStr === setDateInputValue(last14[0]) &&
      endStr === setDateInputValue(last14[last14.length - 1])
    ) {
      return "last14";
    }
  }
  return "custom";
}

export function DateRangeBar({
  batches,
  startStr,
  endStr,
  appliedRange,
  onChange,
}: DateRangeBarProps) {
  const days = useMemo(() => uniqueSortedDays(batches), [batches]);
  const bounds = useMemo(() => daysFromSessionBounds(batches), [batches]);

  const activePreset = useMemo(
    () => detectPreset(startStr, endStr, appliedRange, days, bounds),
    [startStr, endStr, appliedRange, days, bounds]
  );

  const summary = useMemo(() => {
    if (!startStr && !endStr) return "All loaded days";
    const start = appliedRange?.start ?? (startStr ? new Date(`${startStr}T00:00:00`) : null);
    const end = appliedRange?.end ?? (endStr ? new Date(`${endStr}T00:00:00`) : null);
    if (start && end) {
      const sameDay = setDateInputValue(start) === setDateInputValue(end);
      if (sameDay) return formatDateLabel(start);
      return `${formatDateLabel(start)} – ${formatDateLabel(end)}`;
    }
    if (start) return `From ${formatDateLabel(start)}`;
    if (end) return `Through ${formatDateLabel(end)}`;
    return "All loaded days";
  }, [startStr, endStr, appliedRange]);

  const applyDates = (nextStart: string, nextEnd: string, clear = false) => {
    let s = nextStart;
    let e = nextEnd;
    if (s && e && s > e) {
      // Keep range valid if user picks an inverted pair.
      [s, e] = [e, s];
    }
    if (clear || (!s && !e)) {
      onChange(bounds?.min ?? "", bounds?.max ?? "", null);
      return;
    }
    onChange(s, e, appliedRangeFromStrings(s, e));
  };

  const applyPreset = (id: DateRangePresetId) => {
    if (!days.length || !bounds) {
      onChange("", "", null);
      return;
    }
    if (id === "all") {
      applyDates(bounds.min, bounds.max, true);
      return;
    }
    if (id === "latest") {
      const d = setDateInputValue(days[days.length - 1]);
      applyDates(d, d);
      return;
    }
    if (id === "last7") {
      const slice = days.slice(-Math.min(7, days.length));
      applyDates(setDateInputValue(slice[0]), setDateInputValue(slice[slice.length - 1]));
      return;
    }
    if (id === "last14") {
      const slice = days.slice(-Math.min(14, days.length));
      applyDates(setDateInputValue(slice[0]), setDateInputValue(slice[slice.length - 1]));
    }
  };

  if (!batches.length) return null;

  const minAttr = bounds?.min;
  const maxAttr = bounds?.max;

  return (
    <div className="date-range-bar">
      <div className="date-range-bar-top">
        <div className="date-range-bar-title">
          <span className="date-range-label">Date range</span>
          <span className="date-range-summary">{summary}</span>
        </div>
        <div className="date-range-presets" role="group" aria-label="Date range presets">
          {(
            [
              { id: "all" as const, label: "All days", show: true },
              { id: "latest" as const, label: "Latest day", show: days.length >= 1 },
              { id: "last7" as const, label: "Last 7", show: days.length > 1 },
              { id: "last14" as const, label: "Last 14", show: days.length > 7 },
            ] as const
          )
            .filter((p) => p.show)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={`date-range-preset ${activePreset === p.id ? "active" : ""}`}
                onClick={() => applyPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
        </div>
      </div>

      <div className="date-range-inputs">
        <label className="date-range-field">
          <span>From</span>
          <input
            type="date"
            value={startStr}
            min={minAttr}
            max={endStr || maxAttr}
            onChange={(e) => applyDates(e.target.value, endStr || e.target.value)}
          />
        </label>
        <span className="date-range-sep" aria-hidden>
          →
        </span>
        <label className="date-range-field">
          <span>To</span>
          <input
            type="date"
            value={endStr}
            min={startStr || minAttr}
            max={maxAttr}
            onChange={(e) => applyDates(startStr || e.target.value, e.target.value)}
          />
        </label>
        {activePreset !== "all" ? (
          <button type="button" className="date-range-reset" onClick={() => applyPreset("all")}>
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
