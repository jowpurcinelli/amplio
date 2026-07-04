import type { CompiledQuery, PropertyScope, TimeRange } from "./types.js";
import { Params, rangeClause } from "./sql.js";

/** Distinct event names seen for a project, most useful for pickers. */
export function buildEventNames(projectId: string, range?: TimeRange): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const where = range ? `\n  AND ${rangeClause(range, p)}` : "";
  const sql = `SELECT event_type AS name, count() AS volume
FROM events
WHERE project_id = ${project}${where}
GROUP BY event_type
ORDER BY volume DESC
LIMIT 1000`;
  return { sql, params: p.values };
}

/** Distinct property keys for an event, for breakdown and filter pickers. */
export function buildPropertyKeys(
  projectId: string,
  eventType: string,
  scope: PropertyScope,
): CompiledQuery {
  const p = new Params();
  const project = p.bind(projectId, "String");
  const event = p.bind(eventType, "String");
  const column = scope === "event" ? "event_properties" : "user_properties";
  const sql = `SELECT DISTINCT arrayJoin(mapKeys(${column})) AS key
FROM events
WHERE project_id = ${project}
  AND event_type = ${event}
ORDER BY key
LIMIT 500`;
  return { sql, params: p.values };
}
