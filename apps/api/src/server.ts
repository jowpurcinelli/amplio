import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  buildSegmentation,
  buildFunnel,
  buildRetention,
  type CompiledQuery,
} from "@amplio/query";
import type { ApiConfig } from "./config.js";
import { funnelBody, retentionBody, segmentationBody } from "./schemas.js";

export interface ApiDeps {
  cfg: ApiConfig;
  clickhouse?: ClickHouseClient;
}

export function makeApiClient(cfg: ApiConfig): ClickHouseClient {
  return createClient({
    url: cfg.clickhouse.url,
    username: cfg.clickhouse.username,
    password: cfg.clickhouse.password,
    database: cfg.clickhouse.database,
  });
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { cfg } = deps;
  const clickhouse = deps.clickhouse ?? makeApiClient(cfg);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.register(cors, { origin: true });

  /** Resolve the read key from the Authorization header to a project id. */
  const authProject = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const header = req.headers.authorization ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7) : header;
    const projectId = cfg.readKeys.get(key.trim());
    if (!projectId) {
      reply.status(401).send({ error: "invalid read key" });
      return null;
    }
    return projectId;
  };

  const run = async (reply: FastifyReply, compiled: CompiledQuery) => {
    const rs = await clickhouse.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
    });
    const rows = await rs.json();
    reply.send({ data: rows });
  };

  app.get("/health", async () => ({ status: "ok", service: "amplio-api" }));

  app.post("/query/segmentation", async (req, reply) => {
    const projectId = authProject(req, reply);
    if (!projectId) return;
    const parsed = segmentationBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
      return;
    }
    await run(reply, buildSegmentation({ projectId, ...parsed.data }));
  });

  app.post("/query/funnel", async (req, reply) => {
    const projectId = authProject(req, reply);
    if (!projectId) return;
    const parsed = funnelBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
      return;
    }
    await run(reply, buildFunnel({ projectId, ...parsed.data }));
  });

  app.post("/query/retention", async (req, reply) => {
    const projectId = authProject(req, reply);
    if (!projectId) return;
    const parsed = retentionBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
      return;
    }
    await run(reply, buildRetention({ projectId, ...parsed.data }));
  });

  return app;
}
