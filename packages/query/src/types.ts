/** Time bucketing for time-series results. */
export type Granularity = "hour" | "day" | "week" | "month";

/** How to count: total events, or unique performing users. */
export type Measure = "total" | "unique";

/** Whether a property lives on the event or the user. */
export type PropertyScope = "event" | "user";

/** A filter on an event or user property. */
export interface PropertyFilter {
  scope: PropertyScope;
  key: string;
  op: "is" | "is_not" | "contains" | "gt" | "lt" | "set" | "not_set";
  /** Values for is / is_not / contains (OR-ed). Numeric string for gt / lt. */
  values?: string[];
}

export interface TimeRange {
  /** Inclusive lower bound, epoch ms. */
  from: number;
  /** Exclusive upper bound, epoch ms. */
  to: number;
}

/**
 * A cohort: the set of actors who performed `eventType` (optionally matching
 * `filters`) within the query's range. Used to restrict a query to that set.
 */
export interface CohortDef {
  eventType: string;
  filters?: PropertyFilter[];
}

/** Segmentation: event counts / unique users over time, optionally split. */
export interface SegmentationQuery {
  projectId: string;
  eventType: string;
  range: TimeRange;
  granularity: Granularity;
  measure: Measure;
  filters?: PropertyFilter[];
  /** Optional property to break the series down by. */
  groupBy?: { scope: PropertyScope; key: string };
  /** Cap on distinct groups returned. */
  limit?: number;
  /** Restrict to actors in this cohort. */
  cohort?: CohortDef;
}

/** Funnel: ordered step conversion within a window. */
export interface FunnelQuery {
  projectId: string;
  /** Ordered event names, 2 or more. */
  steps: string[];
  range: TimeRange;
  /** Conversion window in seconds. Users must complete steps within it. */
  windowSeconds: number;
  filters?: PropertyFilter[];
}

/** Retention: cohort activity by day offset. */
export interface RetentionQuery {
  projectId: string;
  /** Event that defines the cohort (first occurrence = day 0). */
  startEvent: string;
  /** Event that counts as "returned". Defaults to startEvent if omitted. */
  returnEvent?: string;
  range: TimeRange;
  /** Number of day offsets to compute (e.g. 30 -> day 0..30). */
  days: number;
  filters?: PropertyFilter[];
}

/** A compiled query: parameterized SQL plus its ClickHouse query params. */
export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}
