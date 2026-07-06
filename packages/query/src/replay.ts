import type { CompiledQuery, TimeRange } from "./types.js";
import { Params } from "./sql.js";

/** Half-open range clause on the replay_events `ts` column. */
function tsRange(range: TimeRange, p: Params): string {
  return `ts >= fromUnixTimestamp64Milli(${p.bind(range.from, "UInt64")}) AND ts < fromUnixTimestamp64Milli(${p.bind(range.to, "UInt64")})`;
}

/** One row per recorded session: who, when, how long, how many events. */
export function buildReplayList(projectId: string, range: TimeRange): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const sql = `SELECT
  replay_id,
  any(user_id) AS user_id,
  any(device_id) AS device_id,
  toString(min(ts)) AS started,
  count() AS events,
  dateDiff('second', min(ts), max(ts)) AS duration_s
FROM replay_events
WHERE project_id = ${project}
  AND ${tsRange(range, p)}
GROUP BY replay_id
ORDER BY min(ts) DESC
LIMIT 100`;
  return { sql, params: p.values };
}

/** All recorded events for one replay, in order, for the player. */
export function buildReplayEvents(projectId: string, replayId: string): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const rid = p.bind(replayId, "String");
  const sql = `SELECT seq, ts_ms, data
FROM replay_events
WHERE project_id = ${project}
  AND replay_id = ${rid}
ORDER BY seq
LIMIT 100000`;
  return { sql, params: p.values };
}
