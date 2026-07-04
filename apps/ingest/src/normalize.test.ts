import { describe, it, expect } from "vitest";
import { normalize, flattenProps } from "./normalize.js";
import type { EventInput } from "@amplio/schema";

const NOW = 1_700_000_000_000;

describe("flattenProps", () => {
  it("keeps strings, stringifies the rest, drops null", () => {
    expect(
      flattenProps({ a: "x", n: 3, b: true, arr: [1, 2], nothing: null }),
    ).toEqual({ a: "x", n: "3", b: "true", arr: "[1,2]" });
  });

  it("returns empty object for undefined", () => {
    expect(flattenProps(undefined)).toEqual({});
  });
});

describe("normalize", () => {
  it("fills server fields and defaults time to now", () => {
    const input: EventInput = { event_type: "signup", user_id: "u1" };
    const e = normalize(input, "proj", NOW);
    expect(e.project_id).toBe("proj");
    expect(e.event_type).toBe("signup");
    expect(e.user_id).toBe("u1");
    expect(e.device_id).toBe("");
    expect(e.time).toBe(NOW);
    expect(e.server_received_time).toBe(NOW);
    expect(e.session_id).toBe(-1);
    expect(e.insert_id).toBeTruthy();
  });

  it("preserves client time when provided", () => {
    const e = normalize(
      { event_type: "play", device_id: "d1", time: 123 },
      "proj",
      NOW,
    );
    expect(e.time).toBe(123);
    expect(e.server_received_time).toBe(NOW);
  });

  it("uses insert_id as the stable event id", () => {
    const e = normalize(
      { event_type: "x", user_id: "u", insert_id: "ins-1" },
      "proj",
      NOW,
    );
    expect(e.event_id).toBe("ins-1");
    expect(e.insert_id).toBe("ins-1");
  });

  it("derives revenue from price * quantity when revenue absent", () => {
    const e = normalize(
      { event_type: "purchase", user_id: "u", price: 9.99, quantity: 2 },
      "proj",
      NOW,
    );
    expect(e.revenue).toBeCloseTo(19.98);
  });
});
