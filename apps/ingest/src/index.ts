import { makeStore } from "@amplio/db";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { ensureSchema, makeClient } from "./clickhouse.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clickhouse = makeClient(cfg);
  const store = makeStore(cfg.dbSpec);

  await ensureSchema(clickhouse, cfg);

  const app = buildServer({ cfg, clickhouse, store });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await clickhouse.close();
    if (store) await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(
    { port: cfg.port, clickhouse: cfg.clickhouse.url, metadata: Boolean(store) },
    "amplio ingest listening",
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
