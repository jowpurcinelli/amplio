import { describe, it, expect } from "vitest";
import { buildActivity } from "./activity.js";
const base = { projectId: "tenant-a", range: { from: 1000, to: 2000 }, recentFrom: 1500, pageViewEvent: "page_view" };
describe("project activity aggregate", () => {
  it("binds project and hostile event names without interpolating either", () => {
    const evil = "x' OR 1=1 --";
    const q = buildActivity({ ...base, projectId: evil, pageViewEvent: evil });
    expect(q.sql).not.toContain(evil);
    expect(q.params.p0).toBe(evil);
    expect(q.params.p4).toBe(evil);
    expect(q.sql).toContain("WHERE project_id = {p0:String}");
    expect(q.sql).toContain("time < fromUnixTimestamp64Milli({p2:UInt64})");
  });
  it("separates identified actors and anonymous page sessions", () => {
    const q = buildActivity(base);
    expect(q.sql).toContain("uniqExactIf(user_id,");
    expect(q.sql).toContain("user_id != ''");
    expect(q.sql).toContain("uniqExactIf(tuple(device_id, session_id)");
    expect(q.sql).toContain("session_id > 0");
    expect(q.sql).toContain("anonymous_pages_without_session");
    expect(q.sql).toContain("max(server_received_time_ms)");
    expect(q.sql).not.toContain("event_properties");
  });
  it.each([
    { range: { from: 2000, to: 1000 } },
    { range: { from: 1000, to: 1000 } },
    { range: { from: 0, to: 32 * 86_400_000 } },
    { recentFrom: 999 }, { recentFrom: 2000 }, { recentFrom: NaN },
  ])("rejects invalid window %j", (changes) => {
    expect(() => buildActivity({ ...base, ...changes })).toThrow("invalid activity window");
  });
});
