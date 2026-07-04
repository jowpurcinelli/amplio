import { describe, it, expect } from "vitest";
import { generateKey, makePool } from "./index.js";

describe("generateKey", () => {
  it("prefixes by kind", () => {
    expect(generateKey("write")).toMatch(/^amp_wr_/);
    expect(generateKey("read")).toMatch(/^amp_rd_/);
  });

  it("produces unique, url-safe keys", () => {
    const a = generateKey("write");
    const b = generateKey("write");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^amp_wr_[A-Za-z0-9_-]+$/);
  });
});

describe("makePool", () => {
  it("returns null when no url is configured", () => {
    expect(makePool(undefined)).toBeNull();
  });

  it("returns a pool for a connection url", async () => {
    const pool = makePool("postgres://amplio:amplio@localhost:5433/amplio");
    expect(pool).not.toBeNull();
    await pool!.end(); // no connection is opened until a query runs
  });
});
