import { describe, it, expect } from "vitest";
import { evaluateFlag } from "./flags.js";
import { SqliteStore } from "./sqlite.js";
import type { Flag } from "./types.js";

const PROJECT = "00000000-0000-0000-0000-0000000000a1";

function flag(over: Partial<Flag> = {}): Flag {
  return {
    id: "f",
    projectId: PROJECT,
    key: "test-flag",
    description: null,
    enabled: true,
    rollout: 100,
    variants: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("evaluateFlag", () => {
  it("is off when disabled", () => {
    expect(evaluateFlag(flag({ enabled: false }), "u1")).toEqual({ on: false, variant: null });
  });

  it("is on for everyone at 100% rollout, off at 0%", () => {
    const f100 = flag({ rollout: 100 });
    const f0 = flag({ rollout: 0 });
    for (const u of ["a", "b", "c", "d", "e"]) {
      expect(evaluateFlag(f100, u).on).toBe(true);
      expect(evaluateFlag(f0, u).on).toBe(false);
    }
  });

  it("is deterministic for the same unit", () => {
    const f = flag({ rollout: 50 });
    expect(evaluateFlag(f, "stable-user")).toEqual(evaluateFlag(f, "stable-user"));
  });

  it("rolls out to roughly the configured percentage", () => {
    const f = flag({ rollout: 30 });
    let on = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (evaluateFlag(f, `user_${i}`).on) on++;
    const pct = (on / N) * 100;
    expect(pct).toBeGreaterThan(24);
    expect(pct).toBeLessThan(36);
  });

  it("assigns weighted variants deterministically among included units", () => {
    const f = flag({ rollout: 100, variants: [{ key: "control", weight: 50 }, { key: "treatment", weight: 50 }] });
    const counts: Record<string, number> = { control: 0, treatment: 0 };
    for (let i = 0; i < 2000; i++) {
      const v = evaluateFlag(f, `u_${i}`).variant!;
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts.control).toBeGreaterThan(800);
    expect(counts.treatment).toBeGreaterThan(800);
    // sticky
    expect(evaluateFlag(f, "u_5").variant).toBe(evaluateFlag(f, "u_5").variant);
  });
});

describe("SqliteStore flags", () => {
  it("CRUDs flags with variant round-trip", async () => {
    const s = new SqliteStore(":memory:");
    const created = await s.createFlag(PROJECT, {
      key: "new-checkout",
      description: "The redesigned checkout",
      enabled: true,
      rollout: 40,
      variants: [{ key: "a", weight: 1 }, { key: "b", weight: 1 }],
    });
    expect(created.id).toBeTruthy();
    expect(created.enabled).toBe(true);
    expect(created.variants).toEqual([{ key: "a", weight: 1 }, { key: "b", weight: 1 }]);

    expect((await s.getFlag(PROJECT, "new-checkout"))?.rollout).toBe(40);
    expect((await s.listFlags(PROJECT)).length).toBe(1);

    const updated = await s.updateFlag(PROJECT, created.id, {
      key: "new-checkout",
      enabled: false,
      rollout: 0,
      variants: [],
    });
    expect(updated?.enabled).toBe(false);
    expect(updated?.variants).toEqual([]);

    expect(await s.deleteFlag(PROJECT, created.id)).toBe(true);
    expect((await s.listFlags(PROJECT)).length).toBe(0);
    await s.close();
  });
});
