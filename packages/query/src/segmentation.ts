import type { CompiledQuery, SegmentationQuery } from "./types.js";
import { ACTOR, Params, bucketExpr, compileFilters, rangeClause } from "./sql.js";

/**
 * Segmentation: an events-over-time series, either total event volume or
 * unique performing users, optionally broken down by a property.
 */
export function buildSegmentation(q: SegmentationQuery): CompiledQuery {
  const p = new Params();
  const bucket = bucketExpr(q.granularity);
  const value =
    q.measure === "unique" ? `uniqExact(${ACTOR})` : "count()";

  const projectId = p.bind(q.projectId, "String");
  const eventType = p.bind(q.eventType, "String");
  const range = rangeClause(q.range, p);
  const filters = compileFilters(q.filters, p);

  const groupSelect = q.groupBy
    ? `,\n  ${q.groupBy.scope === "event" ? "event_properties" : "user_properties"}[${p.bind(q.groupBy.key, "String")}] AS group_key`
    : "";
  const groupByCols = q.groupBy ? "bucket, group_key" : "bucket";
  const limit = q.groupBy ? `\nLIMIT ${p.bind(q.limit ?? 100, "UInt32")} BY bucket` : "";

  const sql = `SELECT
  ${bucket} AS bucket${groupSelect},
  ${value} AS value
FROM events
WHERE project_id = ${projectId}
  AND event_type = ${eventType}
  AND ${range}
  ${filters}
GROUP BY ${groupByCols}
ORDER BY bucket ASC${q.groupBy ? ", value DESC" : ""}${limit}`;

  return { sql, params: p.values };
}
