import { PgStore } from "./pg.js";
import { SqliteStore } from "./sqlite.js";
import type { Store } from "./types.js";

export * from "./types.js";
export { generateKey } from "./keys.js";
export { evaluateFlag, type FlagEvaluation } from "./flags.js";
export { PgStore } from "./pg.js";
export { SqliteStore } from "./sqlite.js";

/**
 * Build a metadata store from a spec string:
 *   - "postgres://…" / "postgresql://…"  -> Postgres
 *   - "sqlite:/path/to/amplio.db"        -> SQLite file
 *   - "sqlite::memory:"                  -> in-memory SQLite
 *   - undefined / unrecognized           -> null (metadata features disabled)
 */
export function makeStore(spec: string | undefined): Store | null {
  if (!spec) return null;
  if (spec.startsWith("sqlite:")) return new SqliteStore(spec.slice("sqlite:".length));
  if (spec.startsWith("postgres://") || spec.startsWith("postgresql://")) return new PgStore(spec);
  return null;
}
