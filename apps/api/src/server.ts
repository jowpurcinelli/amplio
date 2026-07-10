import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  buildSegmentation,
  buildFunnel,
  buildRetention,
  buildEventNames,
  buildPropertyKeys,
  buildUserActivity,
  buildUserSummary,
  buildLiveEvents,
  buildStats,
  buildExperiment,
  buildReplayList,
  buildReplayEvents,
  buildProjectUsage,
  type CompiledQuery,
} from "@amplio/query";
import { makeStore, hashPassword, verifyPassword, signToken, verifyToken, PLANS, DEFAULT_PLAN, isPlanId, planLimit, type Store } from "@amplio/db";
import type { ApiConfig } from "./config.js";
import { randomBytes } from "node:crypto";
import { funnelBody, retentionBody, segmentationBody, userBody, experimentBody, chartBody, dashboardBody, cohortBody, keyBody, flagBody, signupBody, loginBody, inviteBody, memberRoleBody, acceptInviteBody, projectBody, planBody, passwordBody, orgNameBody } from "./schemas.js";

export interface ApiDeps {
  cfg: ApiConfig;
  clickhouse?: ClickHouseClient;
  store?: Store | null;
}

/**
 * A unique-constraint violation, across both store backends: Postgres surfaces
 * SQLSTATE 23505; node:sqlite throws with "UNIQUE constraint failed" in the
 * message. Anything else is a real error and must not be reported as a conflict.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && /UNIQUE constraint failed/i.test(message);
}

export function makeApiClient(cfg: ApiConfig): ClickHouseClient {
  return createClient({
    url: cfg.clickhouse.url,
    username: cfg.clickhouse.username,
    password: cfg.clickhouse.password,
    database: cfg.clickhouse.database,
  });
}

/** Short-lived cache so a read key is not re-resolved against Postgres per request. */
class KeyCache {
  private map = new Map<string, { projectId: string; exp: number }>();
  constructor(private readonly ttlMs = 30_000) {}
  get(key: string): string | null {
    const hit = this.map.get(key);
    if (hit && hit.exp > Date.now()) return hit.projectId;
    return null;
  }
  set(key: string, projectId: string): void {
    this.map.set(key, { projectId, exp: Date.now() + this.ttlMs });
  }
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { cfg } = deps;
  const clickhouse = deps.clickhouse ?? makeApiClient(cfg);
  const store = deps.store ?? makeStore(cfg.dbSpec);
  const cache = new KeyCache();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.register(cors, { origin: true });

  // Map a malformed UUID path param (Postgres 22P02) to a clean 400 instead of
  // letting the driver error surface as a 500.
  app.setErrorHandler((err, _req, reply) => {
    if ((err as { code?: string }).code === "22P02") {
      return reply.status(400).send({ error: "invalid id" });
    }
    reply.log.error(err);
    reply.status(500).send({ error: "internal error" });
  });

  const extractKey = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return (header.startsWith("Bearer ") ? header.slice(7) : header).trim();
  };

  /** Resolve a read key to a project id: Postgres first, then env fallback. */
  const resolveReadProject = async (key: string): Promise<string | null> => {
    if (!key) return null;
    const cached = cache.get(key);
    if (cached) return cached;
    if (store) {
      const resolved = await store.resolveKey(key);
      if (resolved && resolved.kind === "read") {
        cache.set(key, resolved.projectId);
        return resolved.projectId;
      }
      // A store is configured: it is the source of truth. Do NOT accept the
      // env fallback keys (the built-in dev-read-key must never work in prod).
      return null;
    }
    const envProject = cfg.readKeys.get(key);
    if (envProject) {
      cache.set(key, envProject);
      return envProject;
    }
    return null;
  };

  /** Guard: resolve the request's project or 401. */
  const auth = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const projectId = await resolveReadProject(extractKey(req));
    if (!projectId) {
      reply.status(401).send({ error: "invalid read key" });
      return null;
    }
    return projectId;
  };

  const requireStore = (reply: FastifyReply): Store | null => {
    if (!store) {
      reply.status(503).send({ error: "metadata store not configured (set AMPLIO_DB or DATABASE_URL)" });
      return null;
    }
    return store;
  };

  const run = async (reply: FastifyReply, compiled: CompiledQuery) => {
    const rs = await clickhouse.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
    });
    reply.send({ data: await rs.json() });
  };

  app.get("/health", async () => ({ status: "ok", service: "amplio-api", metadata: Boolean(store) }));

  // --- user auth (session tokens; additive, does not affect the API-key path) ---
  app.post("/auth/signup", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const parsed = signupBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    // Fail fast on a known-duplicate email before provisioning anything, so the
    // common case never creates an org just to roll it back.
    if (await s.getCredentials(parsed.data.email)) {
      return reply.status(409).send({ error: "an account with that email already exists" });
    }
    // Provision a full workspace so a fresh signup lands on a working project:
    // an org, a default project, and read + write keys, all linked to the user.
    let org: { id: string } | null = null;
    try {
      org = await s.createOrg(`${parsed.data.email}'s workspace`);
      const project = await s.createProject(org.id, "Default project");
      await s.createApiKey(project.id, "write", "Default write key");
      await s.createApiKey(project.id, "read", "Default read key");
      const user = await s.createUser({
        orgId: org.id,
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        passwordHash: hashPassword(parsed.data.password),
      });
      await s.addMember(org.id, user.id, "owner");
      const token = signToken({ sub: user.id, email: user.email }, cfg.authSecret);
      reply.send({ token, user });
    } catch (err) {
      // Roll the just-created org back so a failure never leaks an orphaned
      // org/project/keys.
      if (org) await s.deleteOrg(org.id).catch(() => {});
      // A duplicate email that slipped past the pre-check (a race) is a 409;
      // anything else is a real server error and must surface as 5xx so it is
      // not masked as "account already exists".
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: "an account with that email already exists" });
      }
      req.log.error(err, "signup provisioning failed");
      return reply.status(500).send({ error: "could not create the account" });
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const creds = await s.getCredentials(parsed.data.email);
    if (!creds || !verifyPassword(parsed.data.password, creds.passwordHash)) {
      return reply.status(401).send({ error: "invalid email or password" });
    }
    const token = signToken({ sub: creds.user.id, email: creds.user.email }, cfg.authSecret);
    reply.send({ token, user: creds.user });
  });

  app.get("/auth/me", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const payload = verifyToken(extractKey(req), cfg.authSecret);
    if (!payload) return reply.status(401).send({ error: "not authenticated" });
    const user = await s.getUser(payload.sub);
    if (!user) return reply.status(401).send({ error: "not authenticated" });
    reply.send({ user });
  });

  // Projects the authed user can drive from the dashboard, each with its keys,
  // so the UI can pick a read key automatically instead of manual entry.
  app.get("/me/projects", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const payload = verifyToken(extractKey(req), cfg.authSecret);
    if (!payload) return reply.status(401).send({ error: "not authenticated" });
    const projects = await s.getUserProjects(payload.sub);
    reply.send({ projects });
  });

  // --- org, members, invites, project management (session-token auth) ---
  // Resolve the session user id from the bearer token, or 401.
  const sessionSub = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const payload = verifyToken(extractKey(req), cfg.authSecret);
    if (!payload) {
      reply.status(401).send({ error: "not authenticated" });
      return null;
    }
    return payload.sub;
  };
  const ROLE_RANK: Record<string, number> = { member: 1, admin: 2, owner: 3 };
  // Require the caller to be a member of orgId with at least `min` privilege.
  const requireOrgRole = async (
    s: Store,
    req: FastifyRequest,
    reply: FastifyReply,
    orgId: string,
    min: "owner" | "admin" | "member",
  ): Promise<{ sub: string; role: string } | null> => {
    const sub = sessionSub(req, reply);
    if (!sub) return null;
    const role = await s.getMemberRole(orgId, sub);
    if (!role) {
      // Do not reveal whether the org exists to a non-member.
      reply.status(404).send({ error: "not found" });
      return null;
    }
    if (ROLE_RANK[role]! < ROLE_RANK[min]!) {
      reply.status(403).send({ error: "insufficient permissions" });
      return null;
    }
    return { sub, role };
  };

  app.get("/orgs", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const sub = sessionSub(req, reply);
    if (!sub) return;
    reply.send({ orgs: await s.listUserOrgs(sub) });
  });

  app.get("/orgs/:orgId/members", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "member"))) return;
    reply.send({ members: await s.listMembers(orgId) });
  });

  app.patch("/orgs/:orgId/members/:userId", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const ctx = await requireOrgRole(s, req, reply, orgId, "admin");
    if (!ctx) return;
    const parsed = memberRoleBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    // Only an owner may grant or change ownership.
    if ((parsed.data.role === "owner" || (await s.getMemberRole(orgId, userId)) === "owner") && ctx.role !== "owner") {
      return reply.status(403).send({ error: "only an owner can manage owners" });
    }
    // Never leave an org with no owner.
    if ((await s.getMemberRole(orgId, userId)) === "owner" && parsed.data.role !== "owner") {
      if ((await s.countMembersWithRole(orgId, "owner")) <= 1) {
        return reply.status(409).send({ error: "an org must keep at least one owner" });
      }
    }
    const ok = await s.setMemberRole(orgId, userId, parsed.data.role);
    if (!ok) return reply.status(404).send({ error: "member not found" });
    reply.send({ ok: true });
  });

  app.delete("/orgs/:orgId/members/:userId", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const ctx = await requireOrgRole(s, req, reply, orgId, "admin");
    if (!ctx) return;
    const target = await s.getMemberRole(orgId, userId);
    if (target === "owner") {
      if (ctx.role !== "owner") return reply.status(403).send({ error: "only an owner can remove an owner" });
      if ((await s.countMembersWithRole(orgId, "owner")) <= 1) {
        return reply.status(409).send({ error: "an org must keep at least one owner" });
      }
    }
    const ok = await s.removeMember(orgId, userId);
    if (!ok) return reply.status(404).send({ error: "member not found" });
    reply.send({ ok: true });
  });

  app.get("/orgs/:orgId/invites", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    reply.send({ invites: await s.listInvites(orgId) });
  });

  app.post("/orgs/:orgId/invites", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    const ctx = await requireOrgRole(s, req, reply, orgId, "admin");
    if (!ctx) return;
    const parsed = inviteBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    if (parsed.data.role === "owner" && ctx.role !== "owner") {
      return reply.status(403).send({ error: "only an owner can invite an owner" });
    }
    const token = randomBytes(24).toString("base64url");
    const invite = await s.createInvite(orgId, parsed.data.email, parsed.data.role, token);
    reply.send({ invite });
  });

  app.delete("/orgs/:orgId/invites/:inviteId", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId, inviteId } = req.params as { orgId: string; inviteId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    const ok = await s.deleteInvite(orgId, inviteId);
    if (!ok) return reply.status(404).send({ error: "invite not found" });
    reply.send({ ok: true });
  });

  // Accept an invite as the logged-in user: join the org with the invited role.
  app.post("/invites/accept", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const sub = sessionSub(req, reply);
    if (!sub) return;
    const parsed = acceptInviteBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const invite = await s.getInviteByToken(parsed.data.token);
    if (!invite || invite.acceptedAt) return reply.status(404).send({ error: "invite not found or already used" });
    // Bind the invite to the address it was sent to: only that person can redeem
    // it. Without this, anyone holding the token (e.g. a lower-privileged member
    // who can see it) could join, or escalate their own role, via the invite.
    const acceptor = await s.getUser(sub);
    if (!acceptor || acceptor.email.toLowerCase() !== invite.email.toLowerCase()) {
      return reply.status(403).send({ error: "this invite was sent to a different email" });
    }
    // Never let acceptance change an existing membership's role. Otherwise an
    // owner could accept a lower-role invite for their own address and demote
    // themselves below the last-owner floor, leaving the org unmanageable.
    const existing = await s.getMemberRole(invite.orgId, sub);
    if (existing) {
      await s.markInviteAccepted(invite.id);
      return reply.send({ ok: true, orgId: invite.orgId, role: existing });
    }
    await s.addMember(invite.orgId, sub, invite.role);
    await s.markInviteAccepted(invite.id);
    reply.send({ ok: true, orgId: invite.orgId, role: invite.role });
  });

  app.post("/orgs/:orgId/projects", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const project = await s.createProject(orgId, parsed.data.name);
    const write = await s.createApiKey(project.id, "write", "Default write key");
    const read = await s.createApiKey(project.id, "read", "Default read key");
    reply.send({ project: { id: project.id, name: parsed.data.name, readKey: read.key, writeKey: write.key } });
  });

  app.patch("/orgs/:orgId/projects/:projectId", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const ok = await s.renameProject(orgId, projectId, parsed.data.name);
    if (!ok) return reply.status(404).send({ error: "project not found" });
    reply.send({ ok: true });
  });

  app.delete("/orgs/:orgId/projects/:projectId", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    const ok = await s.deleteProject(orgId, projectId);
    if (!ok) return reply.status(404).send({ error: "project not found" });
    reply.send({ ok: true });
  });

  // --- usage metering + plan (billing scaffolding) ---
  // This month's event count for the org, per project, against its plan limit.
  app.get("/orgs/:orgId/usage", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "member"))) return;
    const planRaw = (await s.getOrgPlan(orgId)) ?? DEFAULT_PLAN;
    const plan = isPlanId(planRaw) ? planRaw : DEFAULT_PLAN;
    const projects = await s.listOrgProjects(orgId);
    const now = new Date();
    const periodStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    let byProject: { id: string; name: string; events: number }[] = [];
    if (projects.length > 0) {
      const compiled = buildProjectUsage(
        projects.map((p) => p.id),
        periodStart,
      );
      const rs = await clickhouse.query({
        query: compiled.sql,
        query_params: compiled.params,
        format: "JSONEachRow",
      });
      const rows = (await rs.json()) as { project_id: string; events: string | number }[];
      const counts = new Map(rows.map((r) => [r.project_id, Number(r.events)]));
      byProject = projects.map((p) => ({ id: p.id, name: p.name, events: counts.get(p.id) ?? 0 }));
    }
    const events = byProject.reduce((n, p) => n + p.events, 0);
    reply.send({ plan, limit: planLimit(plan), events, projects: byProject, periodStart, plans: PLANS });
  });

  // Record a plan change. Real payment is not wired here (self-host is free and
  // unrestricted); this just persists the choice so a hosted layer can bill on it.
  app.post("/orgs/:orgId/plan", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "owner"))) return;
    const parsed = planBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    await s.setOrgPlan(orgId, parsed.data.plan);
    reply.send({ ok: true, plan: parsed.data.plan });
  });

  app.patch("/orgs/:orgId/name", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const { orgId } = req.params as { orgId: string };
    if (!(await requireOrgRole(s, req, reply, orgId, "admin"))) return;
    const parsed = orgNameBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const ok = await s.renameOrg(orgId, parsed.data.name);
    if (!ok) return reply.status(404).send({ error: "org not found" });
    reply.send({ ok: true });
  });

  // --- account management (session-token auth) ---
  app.post("/auth/password", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const sub = sessionSub(req, reply);
    if (!sub) return;
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const user = await s.getUser(sub);
    if (!user) return reply.status(401).send({ error: "not authenticated" });
    const creds = await s.getCredentials(user.email);
    if (!creds || !verifyPassword(parsed.data.currentPassword, creds.passwordHash)) {
      return reply.status(401).send({ error: "current password is incorrect" });
    }
    await s.updatePassword(sub, hashPassword(parsed.data.newPassword));
    reply.send({ ok: true });
  });

  // Delete the signed-in user's account. Orgs they solely own are removed with
  // them; orgs where they are the sole owner but others remain are refused so a
  // team is never left ownerless.
  app.delete("/auth/account", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    const sub = sessionSub(req, reply);
    if (!sub) return;
    const orgs = await s.listUserOrgs(sub);
    // Decide every org's fate from counts snapshotted BEFORE any mutation. This
    // matters because deleting the user's solo home org cascade-removes their
    // user row (and thus their memberships in other orgs); if we re-queried
    // counts mid-loop, a still-shared org could be misread as solo and wiped.
    const plan: { orgId: string; action: "delete" | "leave" }[] = [];
    for (const o of orgs) {
      if (o.role !== "owner") {
        plan.push({ orgId: o.orgId, action: "leave" });
        continue;
      }
      const members = (await s.listMembers(o.orgId)).length;
      if (members <= 1) {
        plan.push({ orgId: o.orgId, action: "delete" }); // only member: remove the org
      } else if ((await s.countMembersWithRole(o.orgId, "owner")) <= 1) {
        return reply.status(409).send({
          error: `you are the sole owner of "${o.orgName}"; transfer ownership before deleting your account`,
        });
      } else {
        plan.push({ orgId: o.orgId, action: "leave" }); // other owners remain
      }
    }
    // Leave shared orgs first (while the user still exists), then delete solo
    // orgs (which may cascade the user away), then remove the account. The plan
    // is fixed, so a cascade cannot change any remaining decision.
    for (const p of plan) if (p.action === "leave") await s.removeMember(p.orgId, sub);
    for (const p of plan) if (p.action === "delete") await s.deleteOrg(p.orgId);
    await s.deleteUser(sub);
    reply.send({ ok: true });
  });

  // --- instance admin console (superadmin emails via AMPLIO_ADMIN_EMAILS) ---
  // True when the bearer token is a valid session for an allow-listed admin email.
  const isAdmin = (req: FastifyRequest): boolean => {
    const payload = verifyToken(extractKey(req), cfg.authSecret);
    return payload ? cfg.adminEmails.has(payload.email.toLowerCase()) : false;
  };

  app.get("/admin/me", async (req, reply) => {
    reply.send({ isAdmin: isAdmin(req) });
  });

  app.get("/admin/overview", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    if (!isAdmin(req)) return reply.status(403).send({ error: "admin access required" });
    const [orgs, users] = await Promise.all([s.listAllOrgs(), s.countUsers()]);
    reply.send({ totals: { orgs: orgs.length, users }, orgs });
  });

  app.post("/admin/orgs/:orgId/plan", async (req, reply) => {
    const s = requireStore(reply);
    if (!s) return;
    if (!isAdmin(req)) return reply.status(403).send({ error: "admin access required" });
    const { orgId } = req.params as { orgId: string };
    const parsed = planBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const ok = await s.setOrgPlan(orgId, parsed.data.plan);
    if (!ok) return reply.status(404).send({ error: "org not found" });
    reply.send({ ok: true, plan: parsed.data.plan });
  });

  // --- metadata pickers ---
  app.get("/meta/events", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    await run(reply, buildEventNames(projectId));
  });

  app.get("/meta/properties", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const q = req.query as { event?: string; scope?: string };
    if (!q.event) return reply.status(400).send({ error: "event query param is required" });
    await run(reply, buildPropertyKeys(projectId, q.event, q.scope === "user" ? "user" : "event"));
  });

  // --- analytics queries ---
  app.post("/query/segmentation", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const parsed = segmentationBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    await run(reply, buildSegmentation({ projectId, ...parsed.data }));
  });

  app.post("/query/funnel", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const parsed = funnelBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    await run(reply, buildFunnel({ projectId, ...parsed.data }));
  });

  app.post("/query/retention", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const parsed = retentionBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    await run(reply, buildRetention({ projectId, ...parsed.data }));
  });

  // --- real-time feed + stats ---
  app.get("/live", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const q = req.query as { since?: string; limit?: string };
    const since = Number(q.since ?? 0) || 0;
    const limit = Number(q.limit ?? 100) || 100;
    const compiled = buildLiveEvents(projectId, since, limit);
    const rs = await clickhouse.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
    });
    const events = (await rs.json()) as Array<{ recv: string }>;
    const cursor = events.reduce((max, e) => Math.max(max, Number(e.recv)), since);
    reply.send({ events, cursor });
  });

  app.get("/stats", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const compiled = buildStats(projectId, Date.now());
    const rs = await clickhouse.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{ total: string; last_hour: string }>;
    const row = rows[0] ?? { total: "0", last_hour: "0" };
    reply.send({ total: Number(row.total), lastHour: Number(row.last_hour) });
  });

  // --- session replay ---
  app.get("/replays", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const q = req.query as { from?: string; to?: string };
    const to = Number(q.to) || Date.now();
    const from = Number(q.from) || to - 30 * 86_400_000;
    await run(reply, buildReplayList(projectId, { from, to }));
  });

  app.get("/replays/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    await run(reply, buildReplayEvents(projectId, (req.params as { id: string }).id));
  });

  // --- experiment readout ---
  app.post("/query/experiment", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const parsed = experimentBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    await run(reply, buildExperiment({ projectId, ...parsed.data }));
  });

  // --- user lookup ---
  app.post("/query/user", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const parsed = userBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const { userId, limit } = parsed.data;
    const summary = buildUserSummary(projectId, userId);
    const activity = buildUserActivity(projectId, userId, limit);
    const [summaryRs, activityRs] = await Promise.all([
      clickhouse.query({ query: summary.sql, query_params: summary.params, format: "JSONEachRow" }),
      clickhouse.query({ query: activity.sql, query_params: activity.params, format: "JSONEachRow" }),
    ]);
    reply.send({
      summary: (await summaryRs.json())[0] ?? null,
      activity: await activityRs.json(),
    });
  });

  // --- saved charts ---
  app.get("/charts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    reply.send({ data: await p.listCharts(projectId) });
  });
  app.post("/charts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = chartBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await p.createChart(projectId, parsed.data) });
  });
  app.get("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const chart = await p.getChart(projectId, (req.params as { id: string }).id);
    if (!chart) return reply.status(404).send({ error: "not found" });
    reply.send({ data: chart });
  });
  app.put("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = chartBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const chart = await p.updateChart(projectId, (req.params as { id: string }).id, parsed.data);
    if (!chart) return reply.status(404).send({ error: "not found" });
    reply.send({ data: chart });
  });
  app.delete("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const ok = await p.deleteChart(projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- dashboards ---
  app.get("/dashboards", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    reply.send({ data: await p.listDashboards(projectId) });
  });
  app.post("/dashboards", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = dashboardBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await p.createDashboard(projectId, parsed.data) });
  });
  app.get("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const dash = await p.getDashboard(projectId, (req.params as { id: string }).id);
    if (!dash) return reply.status(404).send({ error: "not found" });
    reply.send({ data: dash });
  });
  app.put("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = dashboardBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const dash = await p.updateDashboard(projectId, (req.params as { id: string }).id, parsed.data);
    if (!dash) return reply.status(404).send({ error: "not found" });
    reply.send({ data: dash });
  });
  app.delete("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const ok = await p.deleteDashboard(projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- cohorts ---
  app.get("/cohorts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    reply.send({ data: await p.listCohorts(projectId) });
  });
  app.post("/cohorts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = cohortBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await p.createCohort(projectId, parsed.data) });
  });
  app.delete("/cohorts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const ok = await p.deleteCohort(projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- feature flags (management; evaluation lives on the ingest service) ---
  app.get("/flags", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    reply.send({ data: await p.listFlags(projectId) });
  });
  app.post("/flags", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = flagBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await p.createFlag(projectId, parsed.data) });
  });
  app.put("/flags/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = flagBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const flag = await p.updateFlag(projectId, (req.params as { id: string }).id, parsed.data);
    if (!flag) return reply.status(404).send({ error: "not found" });
    reply.send({ data: flag });
  });
  app.delete("/flags/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const ok = await p.deleteFlag(projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- API key management (project-scoped) ---
  app.get("/keys", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    reply.send({ data: await p.listApiKeys(projectId) });
  });
  app.post("/keys", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const parsed = keyBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await p.createApiKey(projectId, parsed.data.kind, parsed.data.label ?? null) });
  });
  app.delete("/keys/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requireStore(reply);
    if (!p) return;
    const ok = await p.revokeApiKey(projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  return app;
}
