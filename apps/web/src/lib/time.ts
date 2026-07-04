export interface Preset {
  key: string;
  label: string;
  days: number;
}

export const PRESETS: Preset[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "180d", label: "Last 180 days", days: 180 },
];

export function presetRange(days: number): { from: number; to: number } {
  const to = Date.now();
  return { from: to - days * 86_400_000, to };
}

/** Turn a ClickHouse datetime string into a short axis label by granularity. */
export function bucketLabel(raw: string, granularity: string): string {
  const d = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  if (granularity === "hour") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  if (granularity === "month") {
    return d.toLocaleString(undefined, { month: "short", year: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export const SERIES_VARS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
].map((v) => `var(${v})`);
