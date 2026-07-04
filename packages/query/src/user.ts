import type { CompiledQuery } from "./types.js";
import { Params } from "./sql.js";

/**
 * A single user's chronological event stream. Matches by user_id or device_id
 * so both identified and anonymous activity for the same person show up.
 */
export function buildUserActivity(
  projectId: string,
  userId: string,
  limit = 200,
): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const id = p.bind(userId, "String");
  const lim = p.bind(Math.min(Math.max(limit, 1), 1000), "UInt32");
  const sql = `SELECT
  toString(time) AS time,
  event_type,
  event_properties,
  session_id,
  platform,
  country
FROM events
WHERE project_id = ${project}
  AND (user_id = ${id} OR device_id = ${id})
ORDER BY time DESC
LIMIT ${lim}`;
  return { sql, params: p.values };
}

/** Profile summary for a user: activity span, totals, latest user properties. */
export function buildUserSummary(projectId: string, userId: string): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const id = p.bind(userId, "String");
  const sql = `SELECT
  toString(min(time)) AS first_seen,
  toString(max(time)) AS last_seen,
  count() AS total_events,
  uniqExact(event_type) AS distinct_events,
  argMaxIf(user_properties, time, length(mapKeys(user_properties)) > 0) AS latest_properties
FROM events
WHERE project_id = ${project}
  AND (user_id = ${id} OR device_id = ${id})`;
  return { sql, params: p.values };
}
