import type { Granularity, PropertyFilter, TimeRange } from "./types.js";

/**
 * Accumulates ClickHouse query parameters and emits `{name:Type}` placeholders.
 * Using bound parameters everywhere keeps user-supplied values out of the SQL
 * string, so the builders are injection-safe by construction.
 */
export class Params {
  private i = 0;
  readonly values: Record<string, unknown> = {};

  bind(value: unknown, type: string): string {
    const name = `p${this.i++}`;
    this.values[name] = value;
    return `{${name}:${type}}`;
  }
}

/** Amplitude-style actor: identified user if present, else the device. */
export const ACTOR = "if(user_id != '', user_id, device_id)";

/** ClickHouse expression that buckets `time` to the given granularity. */
export function bucketExpr(g: Granularity): string {
  switch (g) {
    case "hour":
      return "toStartOfHour(time)";
    case "day":
      return "toStartOfDay(time)";
    case "week":
      return "toStartOfWeek(time, 1)"; // mode 1 = week starts Monday
    case "month":
      return "toStartOfMonth(time)";
  }
}

/** Half-open time range clause: [from, to). */
export function rangeClause(range: TimeRange, p: Params): string {
  return `time >= fromUnixTimestamp64Milli(${p.bind(range.from, "UInt64")}) AND time < fromUnixTimestamp64Milli(${p.bind(range.to, "UInt64")})`;
}

function propColumn(scope: "event" | "user"): string {
  return scope === "event" ? "event_properties" : "user_properties";
}

/** Compile a single property filter into a ClickHouse boolean expression. */
export function compileFilter(f: PropertyFilter, p: Params): string {
  const col = propColumn(f.scope);
  const key = p.bind(f.key, "String");
  const cell = `${col}[${key}]`;
  const values = f.values ?? [];

  switch (f.op) {
    case "is":
      return `${cell} IN ${p.bind(values, "Array(String)")}`;
    case "is_not":
      return `${cell} NOT IN ${p.bind(values, "Array(String)")}`;
    case "contains":
      return `position(${cell}, ${p.bind(values[0] ?? "", "String")}) > 0`;
    case "gt":
      return `toFloat64OrNull(${cell}) > ${p.bind(Number(values[0] ?? 0), "Float64")}`;
    case "lt":
      return `toFloat64OrNull(${cell}) < ${p.bind(Number(values[0] ?? 0), "Float64")}`;
    case "set":
      return `mapContains(${col}, ${key})`;
    case "not_set":
      return `NOT mapContains(${col}, ${key})`;
  }
}

/** Compile a list of filters into AND-joined clauses (empty string if none). */
export function compileFilters(filters: PropertyFilter[] | undefined, p: Params): string {
  if (!filters || filters.length === 0) return "";
  return filters.map((f) => `AND ${compileFilter(f, p)}`).join("\n  ");
}
