import { describe, it, expect } from "vitest";
import { generateKey, makeStore, SqliteStore } from "./index.js";

const PROJECT = "00000000-0000-0000-0000-0000000000a1";

describe("generateKey", () => {
  it("prefixes by kind and is url-safe", () => {
    expect(generateKey("write")).toMatch(/^amp_wr_[A-Za-z0-9_-]+$/);
    expect(generateKey("read")).toMatch(/^amp_rd_/);
    expect(generateKey("write")).not.toBe(generateKey("write"));
  });
});

describe("makeStore", () => {
  it("returns null for no spec or an unknown driver", () => {
    expect(makeStore(undefined)).toBeNull();
    expect(makeStore("mysql://x")).toBeNull();
  });
  it("builds a SqliteStore for sqlite: specs", async () => {
    const s = makeStore("sqlite::memory:");
    expect(s).toBeInstanceOf(SqliteStore);
    await s!.close();
  });
});

describe("SqliteStore", () => {
  it("seeds dev keys and resolves them", async () => {
    const s = new SqliteStore(":memory:");
    expect(await s.resolveKey("dev-key")).toEqual({ projectId: PROJECT, kind: "write" });
    expect(await s.resolveKey("dev-read-key")).toEqual({ projectId: PROJECT, kind: "read" });
    expect(await s.resolveKey("nope")).toBeNull();
    await s.close();
  });

  it("does chart CRUD with a JSON round-trip", async () => {
    const s = new SqliteStore(":memory:");
    const c = await s.createChart(PROJECT, {
      name: "Signups",
      kind: "segmentation",
      definition: { eventType: "signup", n: 3 },
    });
    expect(c.id).toBeTruthy();
    expect(c.definition).toEqual({ eventType: "signup", n: 3 });
    expect((await s.listCharts(PROJECT)).length).toBe(1);
    const u = await s.updateChart(PROJECT, c.id, {
      name: "Signups v2",
      kind: "segmentation",
      definition: { eventType: "signup" },
    });
    expect(u?.name).toBe("Signups v2");
    expect(await s.deleteChart(PROJECT, c.id)).toBe(true);
    expect((await s.listCharts(PROJECT)).length).toBe(0);
    await s.close();
  });

  it("manages api keys, dashboards, and cohorts", async () => {
    const s = new SqliteStore(":memory:");
    const k = await s.createApiKey(PROJECT, "write", "CI");
    expect(k.key).toMatch(/^amp_wr_/);
    expect((await s.listApiKeys(PROJECT)).some((x) => x.key === k.key)).toBe(true);
    expect(await s.revokeApiKey(PROJECT, k.id)).toBe(true);

    const d = await s.createDashboard(PROJECT, { name: "Growth", layout: ["a", "b"] });
    expect(d.layout).toEqual(["a", "b"]);
    expect(await s.deleteDashboard(PROJECT, d.id)).toBe(true);

    const co = await s.createCohort(PROJECT, { name: "Purchasers", definition: { eventType: "purchase" } });
    expect(co.definition).toEqual({ eventType: "purchase" });
    expect(await s.deleteCohort(PROJECT, co.id)).toBe(true);
    await s.close();
  });

  it("scopes reads to the project", async () => {
    const s = new SqliteStore(":memory:");
    await s.createChart(PROJECT, { name: "Mine", kind: "funnel", definition: {} });
    expect((await s.listCharts("other-project")).length).toBe(0);
    await s.close();
  });
});
