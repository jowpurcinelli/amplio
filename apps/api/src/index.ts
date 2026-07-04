import { makePool } from "@amplio/db";
import { loadApiConfig } from "./config.js";
import { buildApi, makeApiClient } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadApiConfig();
  const clickhouse = makeApiClient(cfg);
  const pool = makePool(cfg.databaseUrl);
  const app = buildApi({ cfg, clickhouse, pool });

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
  app.log.info({ port: cfg.port, metadata: Boolean(pool) }, "amplio query api listening");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
