import type { Chart, Plugin } from "chart.js";
import type { TimelineReleaseOverlay } from "./analytics";

const MARKER_COLOR = "#94a3b8";
const MARKER_LABEL_BG = "#f8fafc";
const MARKER_LABEL_TEXT = "#475569";

function pointX(chart: Chart<"line" | "bar">, index: number): number | null {
  const meta = chart.getDatasetMeta(0);
  const el = meta?.data?.[index];
  if (!el) return null;
  const x = el.getProps(["x"], true).x as number;
  return Number.isFinite(x) ? x : null;
}

/** Boundary between period index-1 and index (release starts at index). */
function boundaryX(chart: Chart<"line" | "bar">, index: number): number | null {
  const meta = chart.getDatasetMeta(0);
  if (!meta?.data?.length) return null;

  if (index <= 0) return pointX(chart, 0);

  const prevX = pointX(chart, index - 1);
  const currX = pointX(chart, index);
  if (prevX == null || currX == null) return currX ?? prevX;
  return (prevX + currX) / 2;
}

export function createReleaseMarkerPlugin(
  overlays: TimelineReleaseOverlay[]
): Plugin<"line" | "bar"> {
  return {
    id: `releaseMarkers-${overlays.map((o) => o.markerId).join("-") || "none"}`,
    afterDraw(chart: Chart<"line" | "bar">) {
      const { ctx, chartArea } = chart;
      if (!chartArea || !overlays.length) return;

      overlays.forEach((overlay) => {
        const x = boundaryX(chart, overlay.index);
        if (x == null) return;

        ctx.save();

        // Subtle shaded "after release" region
        ctx.fillStyle = "rgba(37, 99, 235, 0.04)";
        ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top);

        // Vertical release line
        ctx.strokeStyle = MARKER_COLOR;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Minimal label
        const label = overlay.markerLabel || "Release";
        ctx.font = "500 10px system-ui, sans-serif";
        const textW = ctx.measureText(label).width;
        const padX = 5;
        const boxW = textW + padX * 2;
        const boxH = 16;
        let boxX = x + 6;
        boxX = Math.min(boxX, chartArea.right - boxW - 4);
        const boxY = chartArea.top + 6;

        ctx.fillStyle = MARKER_LABEL_BG;
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = MARKER_LABEL_TEXT;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, boxX + padX, boxY + boxH / 2);

        ctx.restore();
      });
    },
  };
}

export const RELEASE_MARKER_LEGEND = {
  color: MARKER_COLOR,
  label: "Release",
};
