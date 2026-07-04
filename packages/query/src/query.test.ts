import { describe, it, expect } from "vitest";
import { buildSegmentation } from "./segmentation.js";
import { buildFunnel } from "./funnel.js";
import { buildRetention } from "./retention.js";
import { buildEventNames, buildPropertyKeys } from "./meta.js";
import { buildUserActivity, buildUserSummary } from "./user.js";

const range = { from: 1_700_000_000_000, to: 1_700_600_000_000 };

describe("buildSegmentation", () => {
  it("counts total events with count()", () => {
    const q = buildSegmentation({
      projectId: "proj",
      eventType: "signup",
      range,
      granularity: "day",
      measure: "total",
    });
    expect(q.sql).toContain("count() AS value");
    expect(q.sql).toContain("toStartOfDay(time) AS bucket");
    expect(q.sql).not.toContain("uniqExact");
  });

  it("counts unique users with uniqExact over the actor", () => {
    const q = buildSegmentation({
      projectId: "proj",
      eventType: "signup",
      range,
      granularity: "week",
      measure: "unique",
    });
    expect(q.sql).toContain("uniqExact(if(user_id != '', user_id, device_id))");
    expect(q.sql).toContain("toStartOfWeek(time, 1)");
  });

  it("adds a group_key column and per-bucket limit when grouped", () => {
    const q = buildSegmentation({
      projectId: "proj",
      eventType: "signup",
      range,
      granularity: "day",
      measure: "total",
      groupBy: { scope: "event", key: "plan" },
      limit: 5,
    });
    expect(q.sql).toContain("AS group_key");
    expect(q.sql).toContain("LIMIT");
    expect(Object.values(q.params)).toContain("plan");
    expect(Object.values(q.params)).toContain(5);
  });

  it("binds user values as params, never inlining them (injection-safe)", () => {
    const evil = "'; DROP TABLE events; --";
    const q = buildSegmentation({
      projectId: evil,
      eventType: "signup",
      range,
      granularity: "day",
      measure: "total",
      filters: [{ scope: "event", key: "country", op: "is", values: ["BR", "US"] }],
    });
    expect(q.sql).not.toContain(evil);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(Object.values(q.params)).toContain(evil);
    expect(Object.values(q.params)).toContainEqual(["BR", "US"]);
  });
});

describe("buildFunnel", () => {
  it("rejects funnels with fewer than 2 steps", () => {
    expect(() =>
      buildFunnel({ projectId: "p", steps: ["only"], range, windowSeconds: 3600 }),
    ).toThrow(/at least 2 steps/);
  });

  it("emits windowFunnel and one reached-count per step", () => {
    const q = buildFunnel({
      projectId: "p",
      steps: ["view", "add_to_cart", "purchase"],
      range,
      windowSeconds: 86400,
    });
    expect(q.sql).toContain("windowFunnel(");
    expect(q.sql).toContain("toDateTime(time)");
    expect(q.sql).toContain("countIf(level >= 1) AS step_1");
    expect(q.sql).toContain("countIf(level >= 2) AS step_2");
    expect(q.sql).toContain("countIf(level >= 3) AS step_3");
    expect(q.sql).not.toContain("step_4");
    expect(Object.values(q.params)).toContainEqual(["view", "add_to_cart", "purchase"]);
  });
});

describe("buildRetention", () => {
  it("defaults returnEvent to startEvent", () => {
    const q = buildRetention({
      projectId: "p",
      startEvent: "login",
      range,
      days: 30,
    });
    const eventParams = Object.values(q.params).filter((v) => v === "login");
    // start event and return event both bound to "login"
    expect(eventParams.length).toBe(2);
    expect(q.sql).toContain("dateDiff('day', c.cohort_day, a.activity_day) AS offset");
  });

  it("supports a distinct return event", () => {
    const q = buildRetention({
      projectId: "p",
      startEvent: "signup",
      returnEvent: "login",
      range,
      days: 7,
    });
    expect(Object.values(q.params)).toContain("signup");
    expect(Object.values(q.params)).toContain("login");
    expect(Object.values(q.params)).toContain(7);
  });
});

describe("meta builders", () => {
  it("buildEventNames binds project and orders by volume", () => {
    const q = buildEventNames("proj_xyz");
    expect(q.sql).toContain("GROUP BY event_type");
    expect(q.sql).toContain("ORDER BY volume DESC");
    expect(Object.values(q.params)).toContain("proj_xyz");
    expect(q.sql).not.toContain("proj_xyz");
  });

  it("buildPropertyKeys targets the right map column per scope", () => {
    expect(buildPropertyKeys("p", "signup", "event").sql).toContain("mapKeys(event_properties)");
    expect(buildPropertyKeys("p", "signup", "user").sql).toContain("mapKeys(user_properties)");
  });
});

describe("user builders", () => {
  it("buildUserActivity matches user_id or device_id and binds values", () => {
    const q = buildUserActivity("proj_xyz", "u_1", 50);
    expect(q.sql).toContain("(user_id = ");
    expect(q.sql).toContain("OR device_id = ");
    expect(q.sql).toContain("ORDER BY time DESC");
    expect(Object.values(q.params)).toContain("u_1");
    expect(Object.values(q.params)).toContain(50);
    expect(q.sql).not.toContain("u_1");
  });

  it("buildUserActivity clamps the limit to 1000", () => {
    expect(Object.values(buildUserActivity("p", "u", 99999).params)).toContain(1000);
  });

  it("buildUserSummary aggregates span and totals", () => {
    const q = buildUserSummary("p", "u_1");
    expect(q.sql).toContain("min(time)");
    expect(q.sql).toContain("max(time)");
    expect(q.sql).toContain("count() AS total_events");
    expect(q.sql).toContain("uniqExact(event_type)");
  });
});
