import { resolveKey, type Pool } from "@amplio/db";
import type { Config } from "./config.js";

/**
 * Resolves a write API key to a project id, Postgres first with an env-map
 * fallback so local dev works without a database. Results are cached briefly to
 * avoid a DB round trip on every ingested batch.
 */
export class KeyResolver {
  private cache = new Map<string, { projectId: string; exp: number }>();

  constructor(
    private readonly cfg: Config,
    private readonly pool: Pool | null,
    private readonly ttlMs = 30_000,
  ) {}

  async resolve(apiKey: string): Promise<string | null> {
    if (!apiKey) return null;
    const hit = this.cache.get(apiKey);
    if (hit && hit.exp > Date.now()) return hit.projectId;

    if (this.pool) {
      const resolved = await resolveKey(this.pool, apiKey);
      if (resolved && resolved.kind === "write") return this.remember(apiKey, resolved.projectId);
    }
    const envProject = this.cfg.devApiKeys.get(apiKey);
    if (envProject) return this.remember(apiKey, envProject);
    return null;
  }

  private remember(apiKey: string, projectId: string): string {
    this.cache.set(apiKey, { projectId, exp: Date.now() + this.ttlMs });
    return projectId;
  }
}
