import type { Measurement } from "./layout";

export type MetricId = "cpu" | "allocation";
const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const metricDetails = {
  cpu: {
    label: "CPU",
    description: "CPU activity · milliseconds per second",
    legend: "Pulse: CPU activity",
    missing: "No attributed CPU in this interval.",
    unresolved: "Some CPU samples could not be attributed.",
    strength: (perSecond: number) => Math.sqrt(perSecond / 1_000),
    formatRate: (perSecond: number) => `${format.format(perSecond)} ms/s`
  },
  allocation: {
    label: "Allocation rate",
    description: "Managed allocation rate · bytes per second",
    legend: "Size: allocation rate",
    missing: "No attributed allocation samples in this interval.",
    unresolved: "Some allocation samples could not be attributed.",
    strength: (perSecond: number) => Math.log1p(perSecond / (64 * 1024)) / Math.log1p(1_024),
    formatRate: formatBytes
  }
} satisfies Record<MetricId, {
  label: string; description: string; legend: string; missing: string; unresolved: string;
  strength: (perSecond: number) => number; formatRate: (perSecond: number) => string;
}>;

export function toRate(value: number, interval: number) {
  return value * 1_000 / interval;
}

export function displayedRate(row: Measurement | undefined, metric: MetricId, interval: number) {
  return row?.value == null || interval <= 0 ? "Unavailable" : metricDetails[metric].formatRate(toRate(row.value, interval));
}

export function methodLabel(value: string) {
  switch (value) {
    case "windows-etw-on-cpu-sampling": return "Windows ETW CPU sampling";
    case "dotnet-eventpipe-allocation-ticks": return ".NET EventPipe allocation ticks";
    default: return value;
  }
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${format.format(value / 1024 ** 3)} GiB/s`;
  if (value >= 1024 ** 2) return `${format.format(value / 1024 ** 2)} MiB/s`;
  if (value >= 1024) return `${format.format(value / 1024)} KiB/s`;
  return `${format.format(value)} B/s`;
}
