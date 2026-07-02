/** Shared Chart.js options for the light dashboard theme. */
import type { Plugin } from "chart.js";

export const CHART = {
  text: "#334155",
  muted: "#64748b",
  grid: "#e2e8f0",
  accent: "#2563eb",
  colors: [
    "#2563eb",
    "#7c3aed",
    "#059669",
    "#dc2626",
    "#d97706",
    "#0891b2",
    "#ea580c",
    "#4f46e5",
  ],
};

export const axisLight = {
  ticks: { color: CHART.muted, font: { size: 12 } },
  grid: { color: CHART.grid },
};

export function legendLight() {
  return { labels: { color: CHART.text, font: { size: 12 }, boxWidth: 14, padding: 16 } };
}

/** Draw % labels at the end of horizontal bar segments. */
export const pctBarLabelPlugin: Plugin<"bar"> = {
  id: "pctBarLabels",
  afterDatasetsDraw(chart) {
    const dataset = chart.data.datasets[0];
    if (!dataset || !(dataset as { showPctLabels?: boolean }).showPctLabels) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((bar, index) => {
      const value = dataset.data[index];
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const label = `${value.toFixed(1)}%`;
      const { x, y, base } = bar.getProps(["x", "y", "base"], true);
      const barEnd = Math.max(x, base);
      ctx.save();
      ctx.fillStyle = CHART.text;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const textX = Math.min(barEnd + 6, chartArea.right - 4);
      ctx.fillText(label, textX, y);
      ctx.restore();
    });
  },
};

export function horizontalPctBarOptions() {
  return {
    responsive: true as const,
    indexAxis: "y" as const,
    layout: { padding: { right: 52 } },
    plugins: { legend: legendLight() },
    scales: {
      x: { ...axisLight, beginAtZero: true, max: 100 },
      y: axisLight,
    },
  };
}

export function timelineChartOptions(opts?: {
  yFormat?: (v: number | string) => string;
}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#fff",
        titleColor: CHART.text,
        bodyColor: CHART.muted,
        borderColor: CHART.grid,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        titleFont: { size: 12, weight: "bold" as const },
        bodyFont: { size: 12 },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: "#94a3b8", font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
      },
      y: {
        beginAtZero: true,
        grid: { color: "#f1f5f9" },
        border: { display: false },
        ticks: {
          color: "#94a3b8",
          font: { size: 11 },
          padding: 8,
          callback: opts?.yFormat ?? ((v: number | string) => String(v)),
        },
      },
    },
  };
}

export function barLineOptions(opts?: {
  yLabel?: string;
  yFormat?: (v: number | string) => string;
  dualAxis?: boolean;
}) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: legendLight(),
      tooltip: {
        backgroundColor: "#fff",
        titleColor: CHART.text,
        bodyColor: CHART.muted,
        borderColor: CHART.grid,
        borderWidth: 1,
        padding: 12,
      },
    },
    scales: {
      x: {
        ...axisLight,
        ticks: { ...axisLight.ticks, maxRotation: 45, minRotation: 0 },
      },
      y: {
        ...axisLight,
        beginAtZero: true,
        title: opts?.yLabel
          ? { display: true, text: opts.yLabel, color: CHART.muted, font: { size: 12 } }
          : undefined,
        ticks: {
          ...axisLight.ticks,
          callback: opts?.yFormat ?? ((v: number | string) => String(v)),
        },
      },
      ...(opts?.dualAxis
        ? {
            y1: {
              position: "right" as const,
              ...axisLight,
              grid: { drawOnChartArea: false },
              beginAtZero: true,
              ticks: axisLight.ticks,
            },
          }
        : {}),
    },
  };
}
