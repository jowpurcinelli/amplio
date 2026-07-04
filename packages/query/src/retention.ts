import type { CompiledQuery, RetentionQuery } from "./types.js";
import { ACTOR, Params, compileFilters, rangeClause } from "./sql.js";

/**
 * Retention: for the cohort of actors whose first `startEvent` falls in the
 * range, how many are still active (did `returnEvent`) at each day offset.
 *
 * Offset 0 is the cohort's first-activity day. When returnEvent === startEvent,
 * offset 0 equals the cohort size and later offsets are the classic retention
 * curve. Filters constrain the cohort definition (the start-event subquery).
 */
export function buildRetention(q: RetentionQuery): CompiledQuery {
  const p = new Params();
  const returnEvent = q.returnEvent ?? q.startEvent;

  const projectId = p.bind(q.projectId, "String");
  const startEvent = p.bind(q.startEvent, "String");
  const cohortRange = rangeClause(q.range, p);
  const cohortFilters = compileFilters(q.filters, p);
  const retEvent = p.bind(returnEvent, "String");
  const retRange = rangeClause(q.range, p);
  const maxDays = p.bind(q.days, "UInt32");

  const sql = `SELECT
  offset,
  uniqExact(actor) AS retained
FROM (
  SELECT
    c.actor AS actor,
    dateDiff('day', c.cohort_day, a.activity_day) AS offset
  FROM (
    SELECT ${ACTOR} AS actor, toStartOfDay(min(time)) AS cohort_day
    FROM events
    WHERE project_id = ${projectId}
      AND event_type = ${startEvent}
      AND ${cohortRange}
      ${cohortFilters}
    GROUP BY actor
  ) AS c
  INNER JOIN (
    SELECT DISTINCT ${ACTOR} AS actor, toStartOfDay(time) AS activity_day
    FROM events
    WHERE project_id = ${projectId}
      AND event_type = ${retEvent}
      AND ${retRange}
  ) AS a ON c.actor = a.actor
  WHERE a.activity_day >= c.cohort_day
    AND dateDiff('day', c.cohort_day, a.activity_day) <= ${maxDays}
)
GROUP BY offset
ORDER BY offset ASC`;

  return { sql, params: p.values };
}
