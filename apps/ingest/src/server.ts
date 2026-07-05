import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ingestRequest, type IngestResponse, type StoredEvent } from "@amplio/schema";
import type { ClickHouseClient } from "@clickhouse/client";
import { evaluateFlag, type Store } from "@amplio/db";
import type { Config } from "./config.js";
import { KeyResolver } from "./auth.js";
import { normalize } from "./normalize.js";
import { insertEvents } from "./clickhouse.js";

export interface ServerDeps {
  cfg: Config;
  clickhouse: ClickHouseClient;
  store?: Store | null;
  /** Injectable clock for deterministic tests. Returns epoch ms. */
  now?: () => number;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { cfg, clickhouse } = deps;
  const now = deps.now ?? (() => Date.now());
  const store = deps.store ?? null;
  const keys = new KeyResolver(cfg, store);

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 20 * 1024 * 1024,
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", service: "amplio-ingest" }));

  // Flag evaluation for SDKs. Uses the same write key as ingestion. Given a
  // unit (user or device id), returns each flag's resolved on/variant state.
  app.post("/flags/evaluate", async (req, reply) => {
    const body = req.body as { api_key?: string; user_id?: string; device_id?: string; keys?: string[] };
    const projectId = await keys.resolve(body.api_key ?? "");
    if (!projectId) return reply.status(401).send({ code: 401, error: "invalid api_key" });
    const unit = body.user_id || body.device_id;
    if (!unit) return reply.status(400).send({ code: 400, error: "user_id or device_id is required" });
    if (!store) return reply.status(503).send({ code: 503, error: "flag store not configured" });

    const all = await store.listFlags(projectId);
    const wanted = Array.isArray(body.keys) && body.keys.length > 0 ? new Set(body.keys) : null;
    const flags: Record<string, { on: boolean; variant: string | null }> = {};
    for (const flag of all) {
      if (wanted && !wanted.has(flag.key)) continue;
      flags[flag.key] = evaluateFlag(flag, unit);
    }
    return reply.send({ flags });
  });

  const handleIngest = async (
    body: unknown,
  ): Promise<{ status: number; response: IngestResponse | { code: number; error: string } }> => {
    const parsed = ingestRequest.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        response: { code: 400, error: parsed.error.issues[0]?.message ?? "invalid payload" },
      };
    }

    const { api_key, events } = parsed.data;
    const projectId = await keys.resolve(api_key);
    if (!projectId) {
      return { status: 401, response: { code: 401, error: "invalid api_key" } };
    }

    const receivedAt = now();
    const stored: StoredEvent[] = events.map((e) => normalize(e, projectId, receivedAt));

    await insertEvents(clickhouse, cfg, stored);

    const response: IngestResponse = {
      code: 200,
      events_ingested: stored.length,
      payload_size_bytes: JSON.stringify(body).length,
      server_upload_time: receivedAt,
    };
    return { status: 200, response };
  };

  // Amplitude HTTP V2 compatible endpoints.
  for (const route of ["/2/httpapi", "/batch"]) {
    app.post(route, async (req, reply) => {
      const { status, response } = await handleIngest(req.body);
      reply.status(status).send(response);
    });
  }

  return app;
}
