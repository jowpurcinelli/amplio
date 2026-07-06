import { describe, it, expect, vi } from "vitest";
import { loadApiConfig } from "./config.js";
import { isUniqueViolation } from "./server.js";

describe("loadApiConfig auth secret", () => {
  it("uses SESSION_SECRET when provided", () => {
    const cfg = loadApiConfig({ SESSION_SECRET: "a-real-secret" } as NodeJS.ProcessEnv);
    expect(cfg.authSecret).toBe("a-real-secret");
  });

  it("refuses to boot in production without SESSION_SECRET", () => {
    expect(() => loadApiConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET is required/);
  });

  it("refuses to boot in production when SESSION_SECRET is blank", () => {
    expect(() => loadApiConfig({ NODE_ENV: "production", SESSION_SECRET: "   " } as NodeJS.ProcessEnv)).toThrow(
      /SESSION_SECRET is required/,
    );
  });

  it("falls back to the dev default outside production, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = loadApiConfig({} as NodeJS.ProcessEnv);
    expect(cfg.authSecret).toBe("amplio-dev-session-secret");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("isUniqueViolation", () => {
  it("detects a Postgres unique violation by SQLSTATE", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects a SQLite unique violation by message or code", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: users.email"))).toBe(true);
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
  });

  it("does not classify an unrelated error as a conflict", () => {
    expect(isUniqueViolation(new Error("connection terminated"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("nope")).toBe(false);
  });
});
