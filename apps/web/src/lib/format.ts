// Consistent number formatting for the whole dashboard. We pin en-US so a
// viewer's machine locale never turns "1,000" into "1.000" (which reads as one
// in English) and counts look the same in every screenshot and deployment.

const grouped = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** A whole count with thousands separators: 5486 -> "5,486". */
export function formatNumber(n: number): string {
  return grouped.format(Math.round(n));
}

/** A compact count for tight spots (axis ticks, tiles): 5486 -> "5.5K". */
export function formatCompact(n: number): string {
  return compact.format(n);
}

/** A percentage with one decimal: 0.5432 -> "54.3%". */
export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "0%";
  return `${(fraction * 100).toFixed(digits)}%`;
}
