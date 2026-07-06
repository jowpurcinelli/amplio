import type { CompiledQuery, TimeRange } from "./types.js";
import { ACTOR, Params, rangeClause } from "./sql.js";

export interface ExperimentQuery {
  projectId: string;
  /** The flag key; events are split by the event property $flag_<flagKey>. */
  flagKey: string;
  /** Event that marks a user was exposed to the experiment (the denominator). */
  exposureEvent: string;
  /** Event that counts as a conversion (the numerator). */
  goalEvent: string;
  range: TimeRange;
}

/**
 * Experiment readout: for each variant of a flag, the unique users exposed and
 * the unique users who converted, in a single scan. Conversion rate is
 * converted / exposed. Unique-over-range counts (not summed daily uniques), so
 * the numbers are correct regardless of how active users are.
 */
export function buildExperiment(q: ExperimentQuery): CompiledQuery {
  const p = new Params();
  const projectId = p.bind(q.projectId, "String");
  const prop = p.bind(`$flag_${q.flagKey}`, "String");
  const exposure = p.bind(q.exposureEvent, "String");
  const goal = p.bind(q.goalEvent, "String");
  const range = rangeClause(q.range, p);

  const sql = `SELECT
  event_properties[${prop}] AS variant,
  uniqExactIf(${ACTOR}, event_type = ${exposure}) AS exposed,
  uniqExactIf(${ACTOR}, event_type = ${goal}) AS converted
FROM events
WHERE project_id = ${projectId}
  AND event_type IN (${exposure}, ${goal})
  AND event_properties[${prop}] != ''
  AND ${range}
GROUP BY variant
ORDER BY variant`;

  return { sql, params: p.values };
}
