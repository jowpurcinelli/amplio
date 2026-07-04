import type { CompiledQuery, FunnelQuery } from "./types.js";
import { ACTOR, Params, compileFilters, rangeClause } from "./sql.js";

/**
 * Funnel: for an ordered list of steps, how many actors reached each step
 * within the conversion window. Uses ClickHouse windowFunnel to compute the
 * furthest step each actor reached, then counts actors at level >= i per step.
 */
export function buildFunnel(q: FunnelQuery): CompiledQuery {
  if (q.steps.length < 2) {
    throw new Error("a funnel needs at least 2 steps");
  }

  const p = new Params();
  const projectId = p.bind(q.projectId, "String");
  const range = rangeClause(q.range, p);
  const filters = compileFilters(q.filters, p);
  const windowSec = p.bind(q.windowSeconds, "UInt64");

  // windowFunnel conditions, one per step.
  const stepConds = q.steps
    .map((s) => `event_type = ${p.bind(s, "String")}`)
    .join(",\n        ");

  // Only scan the events that can participate in the funnel.
  const stepNames = p.bind(q.steps, "Array(String)");

  // Per-step reached counts: countIf(level >= i).
  const reached = q.steps
    .map((_, i) => `countIf(level >= ${i + 1}) AS step_${i + 1}`)
    .join(",\n  ");

  const sql = `SELECT
  ${reached}
FROM (
  SELECT
    ${ACTOR} AS actor,
    windowFunnel(${windowSec})(
      toDateTime(time),
      ${stepConds}
    ) AS level
  FROM events
  WHERE project_id = ${projectId}
    AND event_type IN ${stepNames}
    AND ${range}
    ${filters}
  GROUP BY actor
)`;

  return { sql, params: p.values };
}
