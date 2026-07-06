import { describe, it, expect } from "vitest";
import { buildSegmentation } from "./segmentation.js";
import { buildFunnel } from "./funnel.js";
import { buildRetention } from "./retention.js";
import { buildEventNames, buildPropertyKeys } from "./meta.js";
import { buildUserActivity, buildUserSummary } from "./user.js";
import { buildLiveEvents, buildStats } from "./live.js";
import { buildExperiment } from "./experiment.js";
import { buildReplayList, buildReplayEvents } from "./replay.js";

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

  it("restricts to a cohort with an IN subquery when cohort is set", () => {
    const q = buildSegmentation({
      projectId: "proj",
      eventType: "app_open",
      range,
      granularity: "day",
      measure: "unique",
      cohort: { eventType: "purchase", filters: [{ scope: "event", key: "plan", op: "is", values: ["pro"] }] },
    });
    expect(q.sql).toContain("IN (");
    expect(q.sql).toContain("SELECT if(user_id != '', user_id, device_id) FROM events");
    expect(Object.values(q.params)).toContain("purchase");
    expect(Object.values(q.params)).toContainEqual(["pro"]);
  });

  it("omits the cohort subquery when no cohort is set", () => {
    const q = buildSegmentation({
      projectId: "proj",
      eventType: "app_open",
      range,
      granularity: "day",
      measure: "total",
    });
    expect(q.sql).not.toContain("IN (");
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

describe("live builders", () => {
  it("buildLiveEvents filters on ingestion time and orders newest first", () => {
    const q = buildLiveEvents("p", 1_700_000_000_000, 50);
    expect(q.sql).toContain("server_received_time_ms >");
    expect(q.sql).toContain("ORDER BY server_received_time_ms DESC");
    expect(Object.values(q.params)).toContain(1_700_000_000_000);
    expect(Object.values(q.params)).toContain(50);
  });

  it("buildLiveEvents clamps the limit to 500", () => {
    expect(Object.values(buildLiveEvents("p", 0, 99999).params)).toContain(500);
  });

  it("buildStats counts total and last hour", () => {
    const now = 1_700_003_600_000;
    const q = buildStats("p", now);
    expect(q.sql).toContain("count() AS total");
    expect(q.sql).toContain("countIf(server_received_time_ms >");
    expect(Object.values(q.params)).toContain(now - 3_600_000);
  });
});

describe("replay builders", () => {
  it("buildReplayList groups sessions and orders newest first", () => {
    const q = buildReplayList("proj_xyz", range);
    expect(q.sql).toContain("FROM replay_events");
    expect(q.sql).toContain("GROUP BY replay_id");
    expect(q.sql).toContain("dateDiff('second', min(ts), max(ts))");
    expect(q.sql).toContain("ORDER BY min(ts) DESC");
    expect(Object.values(q.params)).toContain("proj_xyz");
    expect(q.sql).not.toContain("proj_xyz");
  });

  it("buildReplayEvents returns ordered events for a replay, params bound", () => {
    const q = buildReplayEvents("p", "rep_1");
    expect(q.sql).toContain("SELECT seq, ts_ms, data");
    expect(q.sql).toContain("ORDER BY seq");
    expect(Object.values(q.params)).toContain("rep_1");
    expect(q.sql).not.toContain("rep_1");
  });
});

describe("buildExperiment", () => {
  it("splits by the flag property and counts exposed + converted uniques", () => {
    const q = buildExperiment({
      projectId: "p",
      flagKey: "new-checkout",
      exposureEvent: "app_open",
      goalEvent: "purchase",
      range,
    });
    expect(q.sql).toContain("uniqExactIf(if(user_id != '', user_id, device_id), event_type =");
    expect(q.sql).toContain("AS exposed");
    expect(q.sql).toContain("AS converted");
    expect(q.sql).toContain("GROUP BY variant");
    // the flag property is bound as a param, never inlined
    expect(Object.values(q.params)).toContain("$flag_new-checkout");
    expect(q.sql).not.toContain("$flag_new-checkout");
    expect(Object.values(q.params)).toContain("app_open");
    expect(Object.values(q.params)).toContain("purchase");
  });
});
