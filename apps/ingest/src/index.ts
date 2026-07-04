import { makePool } from "@amplio/db";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { ensureSchema, makeClient } from "./clickhouse.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clickhouse = makeClient(cfg);
  const pool = makePool(cfg.databaseUrl);

  await ensureSchema(clickhouse, cfg);

  const app = buildServer({ cfg, clickhouse, pool });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await clickhouse.close();
    if (pool) await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(
    { port: cfg.port, clickhouse: cfg.clickhouse.url, metadata: Boolean(pool) },
    "amplio ingest listening",
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
