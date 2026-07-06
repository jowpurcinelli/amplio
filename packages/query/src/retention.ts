import type { CompiledQuery, RetentionQuery } from "./types.js";
import { ACTOR, Params, compileFilters, rangeClause } from "./sql.js";

/**
 * Retention: for the cohort of actors whose first `startEvent` falls in the
 * range, how many return (do `returnEvent`) at each day offset.
 *
 * Offset 0 is always the full cohort size (the 100% base), matching how
 * product-analytics tools anchor a retention curve. Offsets 1..days count
 * distinct cohort actors who did the return event that many days after their
 * first start event. Filters constrain the cohort definition.
 */
export function buildRetention(q: RetentionQuery): CompiledQuery {
  const p = new Params();
  const returnEvent = q.returnEvent ?? q.startEvent;

  const projectId = p.bind(q.projectId, "String");
  const startEvent = p.bind(q.startEvent, "String");
  const cohortRange = rangeClause(q.range, p);
  const cohortFilters = compileFilters(q.filters, p);
  const retEvent = p.bind(returnEvent, "String");
  // The return window must extend `days` beyond the cohort window, or recent
  // cohorts (whose first event is near range.to) could never be observed at
  // later day offsets and retention would be undercounted at its right edge.
  const retRange = rangeClause({ from: q.range.from, to: q.range.to + q.days * 86_400_000 }, p);
  const maxDays = p.bind(q.days, "UInt32");

  const sql = `WITH cohort AS (
  SELECT ${ACTOR} AS actor, toStartOfDay(min(time)) AS cohort_day
  FROM events
  WHERE project_id = ${projectId}
    AND event_type = ${startEvent}
    AND ${cohortRange}
    ${cohortFilters}
  GROUP BY actor
)
SELECT offset, retained FROM (
  SELECT 0 AS offset, uniqExact(actor) AS retained FROM cohort
  UNION ALL
  SELECT
    dateDiff('day', c.cohort_day, a.activity_day) AS offset,
    uniqExact(c.actor) AS retained
  FROM cohort AS c
  INNER JOIN (
    SELECT DISTINCT ${ACTOR} AS actor, toStartOfDay(time) AS activity_day
    FROM events
    WHERE project_id = ${projectId}
      AND event_type = ${retEvent}
      AND ${retRange}
  ) AS a ON c.actor = a.actor
  WHERE dateDiff('day', c.cohort_day, a.activity_day) BETWEEN 1 AND ${maxDays}
  GROUP BY offset
)
ORDER BY offset ASC`;

  return { sql, params: p.values };
}
