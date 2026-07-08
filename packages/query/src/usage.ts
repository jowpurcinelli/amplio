import type { CompiledQuery } from "./types.js";
import { Params } from "./sql.js";

/**
 * Event counts per project since a cutoff (epoch ms), for usage metering and
 * billing. One scan over the events table, grouped by project. Projects with no
 * events in the window simply do not appear in the result; the caller fills 0.
 */
export function buildProjectUsage(projectIds: string[], sinceMs: number): CompiledQuery {
  const p = new Params();
  const ids = p.bind(projectIds, "Array(String)");
  const since = p.bind(Math.max(sinceMs, 0), "UInt64");
  const sql = `SELECT project_id, count() AS events
FROM events
WHERE project_id IN ${ids}
  AND time >= fromUnixTimestamp64Milli(${since})
GROUP BY project_id`;
  return { sql, params: p.values };
}
