import type { Chart, Plugin } from "chart.js";
import type { TimelineReleaseOverlay } from "./analytics";

const MARKER_COLOR = "#2563eb";
const MARKER_FILL = "rgba(37, 99, 235, 0.1)";
const MARKER_LABEL_BG = "#eff6ff";
const MARKER_LABEL_BORDER = "#93c5fd";
const MARKER_LABEL_TEXT = "#1d4ed8";

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

        // Shaded "after release" region
        ctx.fillStyle = MARKER_FILL;
        ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top);

        // Vertical release line
        ctx.strokeStyle = MARKER_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label chip on chart
        const label = overlay.markerLabel || "Release";
        ctx.font = "600 11px system-ui, sans-serif";
        const textW = ctx.measureText(label).width;
        const padX = 6;
        const boxW = textW + padX * 2;
        const boxH = 20;
        let boxX = x + 8;
        boxX = Math.min(boxX, chartArea.right - boxW - 4);
        const boxY = chartArea.top + 8;

        ctx.fillStyle = MARKER_LABEL_BG;
        ctx.strokeStyle = MARKER_LABEL_BORDER;
        ctx.lineWidth = 1.25;
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
