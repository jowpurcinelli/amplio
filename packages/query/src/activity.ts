import type { CompiledQuery, TimeRange } from "./types.js";
import { Params } from "./sql.js";

export interface ActivityQuery {
  projectId: string;
  range: TimeRange;
  recentFrom: number;
  pageViewEvent: string;
}

/** Aggregate only. Project authorization is supplied by the resolved read key. */
export function buildActivity(q: ActivityQuery): CompiledQuery {
  if (!Number.isSafeInteger(q.range.from) || !Number.isSafeInteger(q.range.to) ||
      q.range.from < 0 || q.range.to <= q.range.from || q.range.to - q.range.from > 31 * 86_400_000 ||
      !Number.isSafeInteger(q.recentFrom) || q.recentFrom < q.range.from || q.recentFrom >= q.range.to) {
    throw new Error("invalid activity window");
  }
  const p = new Params();
  const project = p.bind(q.projectId, "String");
  const from = p.bind(q.range.from, "UInt64");
  const to = p.bind(q.range.to, "UInt64");
  const recent = p.bind(q.recentFrom, "UInt64");
  const page = p.bind(q.pageViewEvent, "String");
  const window = `time >= fromUnixTimestamp64Milli(${from})`;
  const anonPage = `${window} AND event_type = ${page} AND user_id = ''`;
  return { sql: `SELECT
  uniqExactIf(user_id, ${window} AND user_id != '') AS identified_users,
  uniqExactIf(user_id, time >= fromUnixTimestamp64Milli(${recent}) AND user_id != '') AS recent_identified_users,
  countIf(${window} AND event_type = ${page}) AS page_views,
  uniqExactIf(device_id, ${anonPage} AND device_id != '') AS anonymous_visitors,
  uniqExactIf(tuple(device_id, session_id), ${anonPage} AND device_id != '' AND session_id > 0) AS anonymous_visits,
  countIf(${anonPage} AND (device_id = '' OR session_id <= 0)) AS anonymous_pages_without_session,
  count() AS observed_events,
  toUnixTimestamp64Milli(max(time)) AS last_event_at,
  max(server_received_time_ms) AS last_received_at
FROM events
WHERE project_id = ${project}
  AND time < fromUnixTimestamp64Milli(${to})`, params: p.values };
}
