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
  type CompiledQuery,
} from "@amplio/query";
import {
  makePool,
  resolveKey,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listCharts,
  getChart,
  createChart,
  updateChart,
  deleteChart,
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  listCohorts,
  createCohort,
  deleteCohort,
  type Pool,
} from "@amplio/db";
import type { ApiConfig } from "./config.js";
import { funnelBody, retentionBody, segmentationBody, userBody, chartBody, dashboardBody, cohortBody, keyBody } from "./schemas.js";

export interface ApiDeps {
  cfg: ApiConfig;
  clickhouse?: ClickHouseClient;
  pool?: Pool | null;
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
  const pool = deps.pool ?? makePool(cfg.databaseUrl);
  const cache = new KeyCache();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.register(cors, { origin: true });

  const extractKey = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return (header.startsWith("Bearer ") ? header.slice(7) : header).trim();
  };

  /** Resolve a read key to a project id: Postgres first, then env fallback. */
  const resolveReadProject = async (key: string): Promise<string | null> => {
    if (!key) return null;
    const cached = cache.get(key);
    if (cached) return cached;
    if (pool) {
      const resolved = await resolveKey(pool, key);
      if (resolved && resolved.kind === "read") {
        cache.set(key, resolved.projectId);
        return resolved.projectId;
      }
      // fall through to env fallback so local dev works without a DB row
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

  const requirePool = (reply: FastifyReply): Pool | null => {
    if (!pool) {
      reply.status(503).send({ error: "metadata store not configured (set DATABASE_URL)" });
      return null;
    }
    return pool;
  };

  const run = async (reply: FastifyReply, compiled: CompiledQuery) => {
    const rs = await clickhouse.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
    });
    reply.send({ data: await rs.json() });
  };

  app.get("/health", async () => ({ status: "ok", service: "amplio-api", metadata: Boolean(pool) }));

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
    const p = requirePool(reply);
    if (!p) return;
    reply.send({ data: await listCharts(p, projectId) });
  });
  app.post("/charts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = chartBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await createChart(p, projectId, parsed.data) });
  });
  app.get("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const chart = await getChart(p, projectId, (req.params as { id: string }).id);
    if (!chart) return reply.status(404).send({ error: "not found" });
    reply.send({ data: chart });
  });
  app.put("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = chartBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const chart = await updateChart(p, projectId, (req.params as { id: string }).id, parsed.data);
    if (!chart) return reply.status(404).send({ error: "not found" });
    reply.send({ data: chart });
  });
  app.delete("/charts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const ok = await deleteChart(p, projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- dashboards ---
  app.get("/dashboards", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    reply.send({ data: await listDashboards(p, projectId) });
  });
  app.post("/dashboards", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = dashboardBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await createDashboard(p, projectId, parsed.data) });
  });
  app.get("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const dash = await getDashboard(p, projectId, (req.params as { id: string }).id);
    if (!dash) return reply.status(404).send({ error: "not found" });
    reply.send({ data: dash });
  });
  app.put("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = dashboardBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    const dash = await updateDashboard(p, projectId, (req.params as { id: string }).id, parsed.data);
    if (!dash) return reply.status(404).send({ error: "not found" });
    reply.send({ data: dash });
  });
  app.delete("/dashboards/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const ok = await deleteDashboard(p, projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- cohorts ---
  app.get("/cohorts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    reply.send({ data: await listCohorts(p, projectId) });
  });
  app.post("/cohorts", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = cohortBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await createCohort(p, projectId, parsed.data) });
  });
  app.delete("/cohorts/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const ok = await deleteCohort(p, projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  // --- API key management (project-scoped) ---
  app.get("/keys", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    reply.send({ data: await listApiKeys(p, projectId) });
  });
  app.post("/keys", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const parsed = keyBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message });
    reply.send({ data: await createApiKey(p, projectId, parsed.data.kind, parsed.data.label ?? null) });
  });
  app.delete("/keys/:id", async (req, reply) => {
    const projectId = await auth(req, reply);
    if (!projectId) return;
    const p = requirePool(reply);
    if (!p) return;
    const ok = await revokeApiKey(p, projectId, (req.params as { id: string }).id);
    reply.status(ok ? 200 : 404).send({ ok });
  });

  return app;
}
