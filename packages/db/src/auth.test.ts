import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signToken, verifyToken } from "./auth.js";
import { SqliteStore } from "./sqlite.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("uses a random salt (different hashes for the same password)", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a signed token", () => {
    const t = signToken({ sub: "u1", email: "a@b.com" }, "secret");
    const p = verifyToken(t, "secret");
    expect(p?.sub).toBe("u1");
    expect(p?.email).toBe("a@b.com");
  });

  it("rejects a token signed with a different secret", () => {
    const t = signToken({ sub: "u1", email: "a@b.com" }, "secret");
    expect(verifyToken(t, "other")).toBeNull();
  });

  it("rejects an expired token", () => {
    const t = signToken({ sub: "u1", email: "a@b.com" }, "secret", -10);
    expect(verifyToken(t, "secret")).toBeNull();
  });

  it("rejects a tampered token", () => {
    const t = signToken({ sub: "u1", email: "a@b.com" }, "secret");
    expect(verifyToken(t.slice(0, -2) + "xx", "secret")).toBeNull();
  });
});

describe("SqliteStore users", () => {
  it("creates a user and fetches credentials by email (case-insensitive)", async () => {
    const s = new SqliteStore(":memory:");
    const created = await s.createUser({
      orgId: null,
      email: "Jane@Example.com",
      name: "Jane",
      passwordHash: hashPassword("pw"),
    });
    expect(created.email).toBe("jane@example.com");
    const creds = await s.getCredentials("JANE@example.com");
    expect(creds?.user.id).toBe(created.id);
    expect(verifyPassword("pw", creds!.passwordHash)).toBe(true);
    expect(await s.getUser(created.id)).not.toBeNull();
    await s.close();
  });
});

describe("SqliteStore workspace provisioning", () => {
  it("lists a user's projects with their read/write keys via the org", async () => {
    const s = new SqliteStore(":memory:");
    const org = await s.createOrg("Acme");
    const project = await s.createProject(org.id, "Default project");
    const write = await s.createApiKey(project.id, "write", null);
    const read = await s.createApiKey(project.id, "read", null);
    const user = await s.createUser({
      orgId: org.id,
      email: "owner@acme.com",
      name: null,
      passwordHash: hashPassword("pw"),
    });

    const projects = await s.getUserProjects(user.id);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: project.id,
      name: "Default project",
      readKey: read.key,
      writeKey: write.key,
    });
    await s.close();
  });

  it("returns no projects for a user with no org", async () => {
    const s = new SqliteStore(":memory:");
    const user = await s.createUser({ orgId: null, email: "solo@x.com", name: null, passwordHash: hashPassword("pw") });
    expect(await s.getUserProjects(user.id)).toEqual([]);
    await s.close();
  });

  it("deleteOrg removes the org, its projects, keys, and users (signup rollback)", async () => {
    const s = new SqliteStore(":memory:");
    const org = await s.createOrg("Doomed");
    const project = await s.createProject(org.id, "P");
    const key = await s.createApiKey(project.id, "read", null);
    const user = await s.createUser({ orgId: org.id, email: "gone@x.com", name: null, passwordHash: hashPassword("pw") });

    await s.deleteOrg(org.id);

    expect(await s.getUser(user.id)).toBeNull();
    expect(await s.getCredentials("gone@x.com")).toBeNull();
    expect(await s.resolveKey(key.key)).toBeNull();
    expect(await s.listApiKeys(project.id)).toEqual([]);
    await s.close();
  });
});
