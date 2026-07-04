export interface Config {
  port: number;
  host: string;
  clickhouse: {
    url: string;
    username: string;
    password: string;
    database: string;
  };
  /**
   * Dev API keys. In production, keys resolve from Postgres (see auth.ts).
   * Format: "key:project_id,key2:project_id2".
   */
  devApiKeys: Map<string, string>;
  flush: {
    maxBatch: number;
    maxIntervalMs: number;
  };
}

function parseDevKeys(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) {
    map.set("dev-key", "dev-project");
    return map;
  }
  for (const pair of raw.split(",")) {
    const [key, project] = pair.split(":");
    if (key && project) map.set(key.trim(), project.trim());
  }
  return map;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    clickhouse: {
      url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: env.CLICKHOUSE_USER ?? "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      database: env.CLICKHOUSE_DATABASE ?? "amplio",
    },
    devApiKeys: parseDevKeys(env.AMPLIO_DEV_API_KEYS),
    flush: {
      maxBatch: Number(env.FLUSH_MAX_BATCH ?? 1000),
      maxIntervalMs: Number(env.FLUSH_MAX_INTERVAL_MS ?? 2000),
    },
  };
}
