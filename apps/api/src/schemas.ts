import { z } from "zod";

const timeRange = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

const propertyFilter = z.object({
  scope: z.enum(["event", "user"]),
  key: z.string().min(1),
  op: z.enum(["is", "is_not", "contains", "gt", "lt", "set", "not_set"]),
  values: z.array(z.string()).optional(),
});

/** Request bodies omit projectId; it is resolved from the read key. */
const cohortDef = z.object({
  eventType: z.string().min(1),
  filters: z.array(propertyFilter).optional(),
});

export const segmentationBody = z.object({
  eventType: z.string().min(1),
  range: timeRange,
  granularity: z.enum(["hour", "day", "week", "month"]),
  measure: z.enum(["total", "unique"]),
  filters: z.array(propertyFilter).optional(),
  groupBy: z.object({ scope: z.enum(["event", "user"]), key: z.string().min(1) }).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  cohort: cohortDef.optional(),
});

export const funnelBody = z.object({
  steps: z.array(z.string().min(1)).min(2).max(20),
  range: timeRange,
  windowSeconds: z.number().int().positive(),
  filters: z.array(propertyFilter).optional(),
});

export const retentionBody = z.object({
  startEvent: z.string().min(1),
  returnEvent: z.string().min(1).optional(),
  range: timeRange,
  days: z.number().int().positive().max(180),
  filters: z.array(propertyFilter).optional(),
});

export const userBody = z.object({
  userId: z.string().min(1).max(512),
  limit: z.number().int().positive().max(1000).optional(),
});

export const chartBody = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["segmentation", "funnel", "retention"]),
  definition: z.record(z.unknown()),
});

export const dashboardBody = z.object({
  name: z.string().min(1).max(200),
  layout: z.array(z.unknown()).default([]),
});

export const cohortBody = z.object({
  name: z.string().min(1).max(200),
  definition: z.record(z.unknown()),
});

export const keyBody = z.object({
  kind: z.enum(["write", "read"]),
  label: z.string().max(200).optional(),
});
