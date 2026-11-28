import { number, t } from "../language";
import type { Measurement } from "./layout";

export const metricIds = ["cpu", "allocation", "calls"] as const;
export type MetricId = typeof metricIds[number];
export type MapMode = MetricId | "combined";

export const metricDetails = {
  cpu: {
    label: "CPU",
    description: "CPU activity · milliseconds per second",
    legend: "Pulse: CPU activity",
    missing: "No attributed CPU in this interval.",
    unresolved: "Some CPU samples could not be attributed.",
    strength: (perSecond: number) => Math.sqrt(perSecond / 1_000),
    formatRate: (perSecond: number) => `${number(perSecond)} ${t("ms/s")}`
  },
  allocation: {
    label: "Allocation rate",
    description: "Managed allocation rate · bytes per second",
    legend: "Size: allocation rate",
    missing: "No attributed allocation samples in this interval.",
    unresolved: "Some allocation samples could not be attributed.",
    strength: (perSecond: number) => Math.log1p(perSecond / (64 * 1024)) / Math.log1p(1_024),
    formatRate: formatBytes
  },
  calls: {
    label: "Method calls",
    description: "Method entry rate · calls per second",
    legend: "Glow: call rate",
    missing: "No covered method entries in this interval.",
    unresolved: "Some calls could not be attributed.",
    strength: (perSecond: number) => Math.log1p(perSecond) / Math.log1p(50_000),
    formatRate: (perSecond: number) => `${number(perSecond)} ${t("calls/s")}`
  }
} satisfies Record<MetricId, {
  label: string; description: string; legend: string; missing: string; unresolved: string;
  strength: (perSecond: number) => number; formatRate: (perSecond: number) => string;
}>;

export function toRate(value: number, interval: number) {
  return value * 1_000 / interval;
}

export function displayedRate(row: Measurement | undefined, metric: MetricId, interval: number) {
  if (row?.value == null || interval <= 0) return t("Unavailable");
  if (metric === "calls" && !row.complete) return `${number(row.value)} ${t("covered calls")}`;
  return metricDetails[metric].formatRate(toRate(row.value, interval));
}

export function methodLabel(value: string) {
  switch (value) {
    case "windows-etw-on-cpu-sampling": return t("Windows ETW CPU sampling");
    case "dotnet-eventpipe-allocation-ticks": return t(".NET EventPipe allocation ticks");
    case "dotnet-eventpipe-entry-checkpoints": return t(".NET entry checkpoints");
    default: return value;
  }
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${number(value / 1024 ** 3)} ${t("GiB/s")}`;
  if (value >= 1024 ** 2) return `${number(value / 1024 ** 2)} ${t("MiB/s")}`;
  if (value >= 1024) return `${number(value / 1024)} ${t("KiB/s")}`;
  return `${number(value)} ${t("B/s")}`;
}
