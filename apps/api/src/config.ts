export interface ApiConfig {
  port: number;
  host: string;
  clickhouse: {
    url: string;
    username: string;
    password: string;
    database: string;
  };
  /** Read key -> project id. Postgres-backed in a later phase. */
  readKeys: Map<string, string>;
}

function parseReadKeys(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) {
    map.set("dev-read-key", "dev-project");
    return map;
  }
  for (const pair of raw.split(",")) {
    const [key, project] = pair.split(":");
    if (key && project) map.set(key.trim(), project.trim());
  }
  return map;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.API_PORT ?? 8788),
    host: env.HOST ?? "0.0.0.0",
    clickhouse: {
      url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: env.CLICKHOUSE_USER ?? "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      database: env.CLICKHOUSE_DATABASE ?? "amplio",
    },
    readKeys: parseReadKeys(env.AMPLIO_READ_KEYS),
  };
}
