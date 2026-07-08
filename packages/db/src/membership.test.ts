import { describe, it, expect } from "vitest";
import { SqliteStore } from "./sqlite.js";
import { hashPassword } from "./auth.js";

async function seedOrgWithOwner(s: SqliteStore, email = "owner@x.com") {
  const org = await s.createOrg("Acme");
  const project = await s.createProject(org.id, "Default project");
  await s.createApiKey(project.id, "write", null);
  await s.createApiKey(project.id, "read", null);
  const user = await s.createUser({ orgId: org.id, email, name: null, passwordHash: hashPassword("pw") });
  await s.addMember(org.id, user.id, "owner");
  return { org, project, user };
}

describe("SqliteStore memberships", () => {
  it("lists members and resolves a user's role", async () => {
    const s = new SqliteStore(":memory:");
    const { org, user } = await seedOrgWithOwner(s);
    const members = await s.listMembers(org.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: user.id, email: "owner@x.com", role: "owner" });
    expect(await s.getMemberRole(org.id, user.id)).toBe("owner");
    expect(await s.getMemberRole(org.id, "nobody")).toBeNull();
    await s.close();
  });

  it("adds a second member, updates and counts roles", async () => {
    const s = new SqliteStore(":memory:");
    const { org } = await seedOrgWithOwner(s);
    const bob = await s.createUser({ orgId: null, email: "bob@x.com", name: null, passwordHash: hashPassword("pw") });
    await s.addMember(org.id, bob.id, "member");
    expect(await s.countMembersWithRole(org.id, "owner")).toBe(1);
    expect(await s.countMembersWithRole(org.id, "member")).toBe(1);
    expect(await s.setMemberRole(org.id, bob.id, "admin")).toBe(true);
    expect(await s.getMemberRole(org.id, bob.id)).toBe("admin");
    expect(await s.removeMember(org.id, bob.id)).toBe(true);
    expect(await s.getMemberRole(org.id, bob.id)).toBeNull();
    await s.close();
  });

  it("addMember is idempotent and upserts the role", async () => {
    const s = new SqliteStore(":memory:");
    const { org, user } = await seedOrgWithOwner(s);
    await s.addMember(org.id, user.id, "admin"); // same (org,user) -> update role
    expect(await s.getMemberRole(org.id, user.id)).toBe("admin");
    expect(await s.listMembers(org.id)).toHaveLength(1);
    await s.close();
  });

  it("surfaces a user's orgs and their projects with org + role", async () => {
    const s = new SqliteStore(":memory:");
    const { org, user, project } = await seedOrgWithOwner(s);
    const orgs = await s.listUserOrgs(user.id);
    expect(orgs).toEqual([{ orgId: org.id, orgName: "Acme", role: "owner" }]);
    const projects = await s.getUserProjects(user.id);
    expect(projects[0]).toMatchObject({ id: project.id, orgId: org.id, orgName: "Acme", role: "owner" });
    expect(projects[0]!.readKey).toBeTruthy();
    await s.close();
  });
});

describe("SqliteStore invites", () => {
  it("creates, lists, looks up, accepts, and hides accepted invites", async () => {
    const s = new SqliteStore(":memory:");
    const { org } = await seedOrgWithOwner(s);
    const invite = await s.createInvite(org.id, "New@X.com", "member", "tok_123");
    expect(invite.email).toBe("new@x.com"); // lower-cased
    expect(await s.listInvites(org.id)).toHaveLength(1);

    const found = await s.getInviteByToken("tok_123");
    expect(found?.id).toBe(invite.id);
    expect(await s.getInviteByToken("missing")).toBeNull();

    await s.markInviteAccepted(invite.id);
    expect(await s.listInvites(org.id)).toHaveLength(0); // accepted invites drop off the list
    await s.close();
  });

  it("deletes an invite scoped to its org", async () => {
    const s = new SqliteStore(":memory:");
    const { org } = await seedOrgWithOwner(s);
    const invite = await s.createInvite(org.id, "x@x.com", "admin", "tok_del");
    expect(await s.deleteInvite("other-org", invite.id)).toBe(false);
    expect(await s.deleteInvite(org.id, invite.id)).toBe(true);
    expect(await s.listInvites(org.id)).toHaveLength(0);
    await s.close();
  });
});

describe("SqliteStore project management", () => {
  it("renames and deletes projects, scoped to the org", async () => {
    const s = new SqliteStore(":memory:");
    const { org, project } = await seedOrgWithOwner(s);
    expect(await s.renameProject(org.id, project.id, "Renamed")).toBe(true);
    expect(await s.renameProject("other-org", project.id, "Nope")).toBe(false);
    expect(await s.deleteProject(org.id, project.id)).toBe(true);
    expect(await s.deleteProject(org.id, project.id)).toBe(false); // already gone
    await s.close();
  });

  it("deleteProject with a foreign org id never touches the project's keys", async () => {
    const s = new SqliteStore(":memory:");
    const a = await seedOrgWithOwner(s, "a@x.com");
    const b = await seedOrgWithOwner(s, "b@x.com");
    // Org A tries to delete org B's project. Must be a no-op, keys intact.
    expect(await s.deleteProject(a.org.id, b.project.id)).toBe(false);
    const bKey = (await s.listApiKeys(b.project.id)).find((k) => k.kind === "read");
    expect(bKey).toBeTruthy();
    expect(await s.resolveKey(bKey!.key)).not.toBeNull(); // B's key still works
    await s.close();
  });
});
