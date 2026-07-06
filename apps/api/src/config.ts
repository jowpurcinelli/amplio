export interface ApiConfig {
  port: number;
  host: string;
  clickhouse: {
    url: string;
    username: string;
    password: string;
    database: string;
  };
  /**
   * Metadata store spec: "postgres://…" or "sqlite:/path" (or "sqlite::memory:").
   * When set, keys and metadata come from the store.
   */
  dbSpec: string | undefined;
  /** Fallback read key -> project id when no store is configured. */
  readKeys: Map<string, string>;
  /** HMAC secret for signing session tokens. */
  authSecret: string;
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

const DEV_AUTH_SECRET = "amplio-dev-session-secret";

/**
 * Resolve the session-signing secret. A convenient default keeps local dev and
 * the single-user desktop app zero-config, but that default is public (it lives
 * in this open-source repo), so anyone could forge session tokens with it. In
 * production we therefore refuse to boot on the default rather than silently
 * signing tokens with a known key.
 */
function resolveAuthSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production: the built-in default is public and would let anyone forge session tokens. Set SESSION_SECRET to a long random value.",
    );
  }
  // Dev / desktop: allow the default but make the weakness visible.
  console.warn(
    "[amplio] SESSION_SECRET is unset; using an insecure built-in default. Set SESSION_SECRET before exposing this API.",
  );
  return DEV_AUTH_SECRET;
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
    dbSpec: env.AMPLIO_DB ?? env.DATABASE_URL,
    readKeys: parseReadKeys(env.AMPLIO_READ_KEYS),
    authSecret: resolveAuthSecret(env),
  };
}
