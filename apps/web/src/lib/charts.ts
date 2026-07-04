import type { SegmentationRow, RetentionRow } from "../api.js";
import type { Series } from "../components/LineChart.js";
import { bucketLabel, SERIES_VARS } from "./time.js";

/** Pivot segmentation rows into aligned line-chart series. */
export function segmentationSeries(
  rows: SegmentationRow[],
  granularity: string,
  grouped: boolean,
): { labels: string[]; series: Series[] } {
  const buckets = Array.from(new Set(rows.map((r) => r.bucket))).sort();
  const labels = buckets.map((b) => bucketLabel(b, granularity));
  if (!grouped) {
    const byBucket = new Map(rows.map((r) => [r.bucket, Number(r.value)]));
    return {
      labels,
      series: [{ name: "value", color: SERIES_VARS[0]!, values: buckets.map((b) => byBucket.get(b) ?? 0) }],
    };
  }
  const groups = Array.from(new Set(rows.map((r) => r.group_key ?? "(none)"))).slice(0, 8);
  const series = groups.map((g, i) => {
    const byBucket = new Map(
      rows.filter((r) => (r.group_key ?? "(none)") === g).map((r) => [r.bucket, Number(r.value)]),
    );
    return {
      name: g || "(empty)",
      color: SERIES_VARS[i % SERIES_VARS.length]!,
      values: buckets.map((b) => byBucket.get(b) ?? 0),
    };
  });
  return { labels, series };
}

/** Turn retention rows into a percent-of-cohort curve. */
export function retentionCurve(
  rows: RetentionRow[],
  offsets: number,
): { labels: string[]; values: number[]; cohort: number } {
  const byOffset = new Map(rows.map((r) => [Number(r.offset), Number(r.retained)]));
  const cohort = byOffset.get(0) ?? 0;
  const labels = Array.from({ length: offsets + 1 }, (_, i) => `Day ${i}`);
  const values = labels.map((_, i) => (cohort > 0 ? ((byOffset.get(i) ?? 0) / cohort) * 100 : 0));
  return { labels, values, cohort };
}
