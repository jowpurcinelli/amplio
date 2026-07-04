import type { CompiledQuery } from "./types.js";
import { Params } from "./sql.js";

/**
 * Events ingested since a cursor, newest first, for a real-time feed. The
 * cursor is server-receive time in epoch ms, so it reflects ingestion order
 * and is not thrown off by clients sending historical `time` values.
 */
export function buildLiveEvents(projectId: string, sinceMs: number, limit = 100): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const since = p.bind(Math.max(sinceMs, 0), "UInt64");
  const lim = p.bind(Math.min(Math.max(limit, 1), 500), "UInt32");
  const sql = `SELECT
  server_received_time_ms AS recv,
  toString(time) AS time,
  event_type,
  user_id,
  device_id,
  event_properties,
  platform
FROM events
WHERE project_id = ${project}
  AND server_received_time_ms > ${since}
ORDER BY server_received_time_ms DESC
LIMIT ${lim}`;
  return { sql, params: p.values };
}

/** Headline counts for a status indicator: total and last-hour ingestion. */
export function buildStats(projectId: string, nowMs: number): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const hourAgo = p.bind(Math.max(nowMs - 3_600_000, 0), "UInt64");
  const sql = `SELECT
  count() AS total,
  countIf(server_received_time_ms > ${hourAgo}) AS last_hour
FROM events
WHERE project_id = ${project}`;
  return { sql, params: p.values };
}
