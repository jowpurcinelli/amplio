import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { buildApi } from "./server.js";
import { loadApiConfig } from "./config.js";
import { activityBody } from "./schemas.js";
const body = { range: { from: 1000, to: 2000 }, recentFrom: 1500 };
function fixture(row: Record<string, string | number> = {}) {
  const query = vi.fn(async (_params: unknown) => ({ json: async () => [row] }));
  const cfg = loadApiConfig({ SESSION_SECRET: "test-session-secret" } as NodeJS.ProcessEnv);
  cfg.readKeys = new Map([["a", "project-a"], ["b", "project-b"]]);
  const app = buildApi({ cfg, clickhouse: { query } as unknown as ClickHouseClient, store: null });
  return { app, query };
}
describe("activity HTTP authorization", () => {
  it("resolves two keys into different bound projects and never trusts client project", async () => {
    const { app, query } = fixture({ observed_events: "1", identified_users: "2", last_event_at: "1234", last_received_at: "1567" });
    try {
      for (const [key, project] of [["a", "project-a"], ["b", "project-b"]]) {
        const response = await app.inject({ method: "POST", url: "/query/activity", headers: { authorization: `Bearer ${key}` }, payload: body });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ projectId: project, summary: { identifiedUsers: 2, onlineUsers: null, lastEventAt: 1234 } });
        expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ query_params: { p0: project } });
      }
      const attack = await app.inject({ method: "POST", url: "/query/activity", headers: { authorization: "Bearer a" }, payload: { ...body, projectId: "project-b" } });
      expect(attack.statusCode).toBe(400);
      const denied = await app.inject({ method: "POST", url: "/query/activity", headers: { authorization: "Bearer invalid" }, payload: body });
      expect(denied.statusCode).toBe(401);
      expect(query).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
  it("preserves missing session coverage and absence of signals as null", async () => {
    const { app } = fixture({ anonymous_pages_without_session: 1 });
    try {
      const r = await app.inject({ method: "POST", url: "/query/activity", headers: { authorization: "Bearer a" }, payload: body });
      expect(r.json().summary).toMatchObject({ anonymousVisits: null, lastEventAt: null, lastReceivedAt: null, onlineUsers: null });
    } finally { await app.close(); }
  });
  it("maps aggregate counts without exposing raw columns and retains a valid zero", async () => {
    const { app } = fixture({ observed_events: 4, identified_users: 2, recent_identified_users: 1,
      page_views: 3, anonymous_visitors: 1, anonymous_visits: 1, anonymous_pages_without_session: 0,
      last_event_at: 1900, last_received_at: 2500, user_id: "must-not-leak" });
    try {
      const r = await app.inject({ method: "POST", url: "/query/activity", headers: { authorization: "Bearer a" }, payload: body });
      expect(r.json().summary).toEqual({ identifiedUsers: 2, recentIdentifiedUsers: 1, pageViews: 3,
        anonymousVisitors: 1, anonymousVisits: 1, lastEventAt: 1900, lastReceivedAt: 2500, onlineUsers: null });
      expect(r.body).not.toContain("must-not-leak");
    } finally { await app.close(); }
    const empty = fixture();
    try {
      const r = await empty.app.inject({ method: "POST", url: "/query/activity", headers: { authorization: "Bearer a" }, payload: body });
      expect(r.json().summary).toMatchObject({ identifiedUsers: 0, anonymousVisits: 0, lastEventAt: null });
    } finally { await empty.app.close(); }
  });
  it("validates clock tolerance, bounded windows, event names and defaults", () => {
    expect(activityBody.parse(body).pageViewEvent).toBe("page_view");
    expect(activityBody.safeParse({ ...body, pageViewEvent: "a".repeat(129) }).success).toBe(false);
    expect(activityBody.safeParse({ range: { from: 0, to: Date.now() + 120_000 }, recentFrom: 0 }).success).toBe(false);
    expect(activityBody.safeParse({ ...body, recentFrom: 2000 }).success).toBe(false);
  });
});
