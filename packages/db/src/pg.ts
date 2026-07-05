import pg from "pg";
import type { Pool as PoolType } from "pg";
import { generateKey } from "./keys.js";
import type {
  ApiKey,
  Chart,
  ChartInput,
  Cohort,
  CohortInput,
  Dashboard,
  DashboardInput,
  Flag,
  FlagInput,
  KeyKind,
  ResolvedKey,
  Store,
} from "./types.js";

const { Pool } = pg;

/** Postgres-backed metadata store. Schema comes from deploy/postgres/init.sql. */
export class PgStore implements Store {
  private pool: PoolType;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async resolveKey(key: string): Promise<ResolvedKey | null> {
    const r = await this.pool.query(
      `SELECT project_id, kind FROM api_keys WHERE key = $1 AND revoked_at IS NULL`,
      [key],
    );
    const row = r.rows[0];
    return row ? { projectId: row.project_id, kind: row.kind } : null;
  }

  async listApiKeys(projectId: string): Promise<ApiKey[]> {
    const r = await this.pool.query(
      `SELECT id, project_id, kind, key, label, created_at, revoked_at
       FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return r.rows.map(mapKey);
  }

  async createApiKey(projectId: string, kind: KeyKind, label: string | null): Promise<ApiKey> {
    const r = await this.pool.query(
      `INSERT INTO api_keys (project_id, kind, key, label) VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, kind, key, label, created_at, revoked_at`,
      [projectId, kind, generateKey(kind), label],
    );
    return mapKey(r.rows[0]);
  }

  async revokeApiKey(projectId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE api_keys SET revoked_at = now()
       WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`,
      [id, projectId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listCharts(projectId: string): Promise<Chart[]> {
    const r = await this.pool.query(
      `SELECT id, project_id, name, kind, definition, created_at, updated_at
       FROM charts WHERE project_id = $1 ORDER BY updated_at DESC`,
      [projectId],
    );
    return r.rows.map(mapChart);
  }

  async getChart(projectId: string, id: string): Promise<Chart | null> {
    const r = await this.pool.query(
      `SELECT id, project_id, name, kind, definition, created_at, updated_at
       FROM charts WHERE id = $1 AND project_id = $2`,
      [id, projectId],
    );
    return r.rows[0] ? mapChart(r.rows[0]) : null;
  }

  async createChart(projectId: string, input: ChartInput): Promise<Chart> {
    const r = await this.pool.query(
      `INSERT INTO charts (project_id, name, kind, definition) VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, name, kind, definition, created_at, updated_at`,
      [projectId, input.name, input.kind, JSON.stringify(input.definition)],
    );
    return mapChart(r.rows[0]);
  }

  async updateChart(projectId: string, id: string, input: ChartInput): Promise<Chart | null> {
    const r = await this.pool.query(
      `UPDATE charts SET name = $3, kind = $4, definition = $5, updated_at = now()
       WHERE id = $1 AND project_id = $2
       RETURNING id, project_id, name, kind, definition, created_at, updated_at`,
      [id, projectId, input.name, input.kind, JSON.stringify(input.definition)],
    );
    return r.rows[0] ? mapChart(r.rows[0]) : null;
  }

  async deleteChart(projectId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM charts WHERE id = $1 AND project_id = $2`, [id, projectId]);
    return (r.rowCount ?? 0) > 0;
  }

  async listDashboards(projectId: string): Promise<Dashboard[]> {
    const r = await this.pool.query(
      `SELECT id, project_id, name, layout, created_at, updated_at
       FROM dashboards WHERE project_id = $1 ORDER BY updated_at DESC`,
      [projectId],
    );
    return r.rows.map(mapDashboard);
  }

  async getDashboard(projectId: string, id: string): Promise<Dashboard | null> {
    const r = await this.pool.query(
      `SELECT id, project_id, name, layout, created_at, updated_at
       FROM dashboards WHERE id = $1 AND project_id = $2`,
      [id, projectId],
    );
    return r.rows[0] ? mapDashboard(r.rows[0]) : null;
  }

  async createDashboard(projectId: string, input: DashboardInput): Promise<Dashboard> {
    const r = await this.pool.query(
      `INSERT INTO dashboards (project_id, name, layout) VALUES ($1, $2, $3)
       RETURNING id, project_id, name, layout, created_at, updated_at`,
      [projectId, input.name, JSON.stringify(input.layout ?? [])],
    );
    return mapDashboard(r.rows[0]);
  }

  async updateDashboard(projectId: string, id: string, input: DashboardInput): Promise<Dashboard | null> {
    const r = await this.pool.query(
      `UPDATE dashboards SET name = $3, layout = $4, updated_at = now()
       WHERE id = $1 AND project_id = $2
       RETURNING id, project_id, name, layout, created_at, updated_at`,
      [id, projectId, input.name, JSON.stringify(input.layout ?? [])],
    );
    return r.rows[0] ? mapDashboard(r.rows[0]) : null;
  }

  async deleteDashboard(projectId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM dashboards WHERE id = $1 AND project_id = $2`, [id, projectId]);
    return (r.rowCount ?? 0) > 0;
  }

  async listCohorts(projectId: string): Promise<Cohort[]> {
    const r = await this.pool.query(
      `SELECT id, project_id, name, definition, created_at
       FROM cohorts WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return r.rows.map(mapCohort);
  }

  async createCohort(projectId: string, input: CohortInput): Promise<Cohort> {
    const r = await this.pool.query(
      `INSERT INTO cohorts (project_id, name, definition) VALUES ($1, $2, $3)
       RETURNING id, project_id, name, definition, created_at`,
      [projectId, input.name, JSON.stringify(input.definition)],
    );
    return mapCohort(r.rows[0]);
  }

  async deleteCohort(projectId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM cohorts WHERE id = $1 AND project_id = $2`, [id, projectId]);
    return (r.rowCount ?? 0) > 0;
  }

  async listFlags(projectId: string): Promise<Flag[]> {
    const r = await this.pool.query(
      `SELECT id, project_id, key, description, enabled, rollout, variants, created_at, updated_at
       FROM flags WHERE project_id = $1 ORDER BY key`,
      [projectId],
    );
    return r.rows.map(mapFlag);
  }

  async getFlag(projectId: string, key: string): Promise<Flag | null> {
    const r = await this.pool.query(
      `SELECT id, project_id, key, description, enabled, rollout, variants, created_at, updated_at
       FROM flags WHERE project_id = $1 AND key = $2`,
      [projectId, key],
    );
    return r.rows[0] ? mapFlag(r.rows[0]) : null;
  }

  async createFlag(projectId: string, input: FlagInput): Promise<Flag> {
    const r = await this.pool.query(
      `INSERT INTO flags (project_id, key, description, enabled, rollout, variants)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, key, description, enabled, rollout, variants, created_at, updated_at`,
      [projectId, input.key, input.description ?? null, input.enabled, input.rollout, JSON.stringify(input.variants ?? [])],
    );
    return mapFlag(r.rows[0]);
  }

  async updateFlag(projectId: string, id: string, input: FlagInput): Promise<Flag | null> {
    const r = await this.pool.query(
      `UPDATE flags SET key = $3, description = $4, enabled = $5, rollout = $6, variants = $7, updated_at = now()
       WHERE id = $1 AND project_id = $2
       RETURNING id, project_id, key, description, enabled, rollout, variants, created_at, updated_at`,
      [id, projectId, input.key, input.description ?? null, input.enabled, input.rollout, JSON.stringify(input.variants ?? [])],
    );
    return r.rows[0] ? mapFlag(r.rows[0]) : null;
  }

  async deleteFlag(projectId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`DELETE FROM flags WHERE id = $1 AND project_id = $2`, [id, projectId]);
    return (r.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Row mappers. `any` is intentional at the pg driver boundary where rows are
// untyped; each mapper is the single place that pins the shape.
function mapKey(row: any): ApiKey {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    key: row.key,
    label: row.label,
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}
function mapChart(row: any): Chart {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    definition: row.definition,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapDashboard(row: any): Dashboard {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    layout: row.layout,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapCohort(row: any): Cohort {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    definition: row.definition,
    createdAt: String(row.created_at),
  };
}
function mapFlag(row: any): Flag {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    description: row.description ?? null,
    enabled: Boolean(row.enabled),
    rollout: Number(row.rollout),
    variants: typeof row.variants === "string" ? JSON.parse(row.variants) : row.variants,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
