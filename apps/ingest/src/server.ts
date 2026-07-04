import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ingestRequest, type IngestResponse, type StoredEvent } from "@amplio/schema";
import type { ClickHouseClient } from "@clickhouse/client";
import type { Config } from "./config.js";
import { resolveProject } from "./auth.js";
import { normalize } from "./normalize.js";
import { insertEvents } from "./clickhouse.js";

export interface ServerDeps {
  cfg: Config;
  clickhouse: ClickHouseClient;
  /** Injectable clock for deterministic tests. Returns epoch ms. */
  now?: () => number;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { cfg, clickhouse } = deps;
  const now = deps.now ?? (() => Date.now());

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 20 * 1024 * 1024,
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", service: "amplio-ingest" }));

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
    const projectId = resolveProject(cfg, api_key);
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
