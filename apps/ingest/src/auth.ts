import type { Config } from "./config.js";

/**
 * Resolve an API key to a project id.
 *
 * Phase 1 uses the dev key map from config. Phase 2 replaces this with a
 * Postgres-backed lookup (with an in-memory cache) so keys are managed from
 * the dashboard. The signature stays the same so callers do not change.
 */
export function resolveProject(cfg: Config, apiKey: string): string | null {
  return cfg.devApiKeys.get(apiKey) ?? null;
}
