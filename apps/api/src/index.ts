import { makeStore } from "@amplio/db";
import { loadApiConfig } from "./config.js";
import { buildApi, makeApiClient } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadApiConfig();
  const clickhouse = makeApiClient(cfg);
  const store = makeStore(cfg.dbSpec);
  const app = buildApi({ cfg, clickhouse, store });

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
  app.log.info({ port: cfg.port, metadata: Boolean(store) }, "amplio query api listening");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
