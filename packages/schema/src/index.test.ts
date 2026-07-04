import { describe, it, expect } from "vitest";
import { eventInput, ingestRequest } from "./index.js";

describe("eventInput", () => {
  it("accepts a minimal event with user_id", () => {
    const r = eventInput.safeParse({ event_type: "signup", user_id: "u1" });
    expect(r.success).toBe(true);
  });

  it("accepts a minimal event with device_id", () => {
    const r = eventInput.safeParse({ event_type: "signup", device_id: "d1" });
    expect(r.success).toBe(true);
  });

  it("rejects an event without user_id or device_id", () => {
    const r = eventInput.safeParse({ event_type: "signup" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty event_type", () => {
    const r = eventInput.safeParse({ event_type: "", user_id: "u1" });
    expect(r.success).toBe(false);
  });

  it("accepts rich properties", () => {
    const r = eventInput.safeParse({
      event_type: "purchase",
      user_id: "u1",
      event_properties: { plan: "pro", amount: 42, gift: true, tags: ["a", "b"] },
      groups: { company: "acme", teams: ["x", "y"] },
    });
    expect(r.success).toBe(true);
  });
});

describe("ingestRequest", () => {
  it("requires api_key and at least one event", () => {
    expect(ingestRequest.safeParse({ api_key: "k", events: [] }).success).toBe(false);
    expect(
      ingestRequest.safeParse({
        api_key: "k",
        events: [{ event_type: "e", user_id: "u" }],
      }).success,
    ).toBe(true);
  });
});
