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
  type CompiledQuery,
} from "@amplio/query";
import { makeStore, hashPassword, verifyPassword, signToken, verifyToken, type Store } from "@amplio/db";
import type { ApiConfig } from "./config.js";
import { funnelBody, retentionBody, segmentationBody, userBody, experimentBody, chartBody, dashboardBody, cohortBody, keyBody, flagBody, signupBody, loginBody } from "./schemas.js";

export interface ApiDeps {
  cfg: ApiConfig;
  clickhouse?: ClickHouseClient;
  store?: Store | null;
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
      const token = signToken({ sub: user.id, email: user.email }, cfg.authSecret);
      reply.send({ token, user });
    } catch {
      // The email is the only uniquely-constrained field, so a failure here is a
      // duplicate account. Roll the just-created org back so we do not leak an
      // orphaned org/project/keys on the retry.
      if (org) await s.deleteOrg(org.id).catch(() => {});
      reply.status(409).send({ error: "an account with that email already exists" });
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
