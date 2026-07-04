import { DatabaseSync } from "node:sqlite";
import { generateKey, randomUUID } from "./keys.js";
import type {
  ApiKey,
  Chart,
  ChartInput,
  Cohort,
  CohortInput,
  Dashboard,
  DashboardInput,
  KeyKind,
  ResolvedKey,
  Store,
} from "./types.js";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "00000000-0000-0000-0000-0000000000a1";

/**
 * SQLite-backed metadata store. Embedded, zero-config, ideal for the desktop
 * app and single-node self-hosting. JSON columns are stored as TEXT. It creates
 * its schema and seeds the dev keys on first open. Uses Node's built-in
 * node:sqlite, so there is no native dependency to compile.
 */
export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('write','read')),
        key TEXT NOT NULL UNIQUE, label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);
      CREATE TABLE IF NOT EXISTS charts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS charts_project_idx ON charts(project_id);
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS dashboards_project_idx ON dashboards(project_id);
      CREATE TABLE IF NOT EXISTS cohorts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS cohorts_project_idx ON cohorts(project_id);
    `);
    this.db.prepare(`INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Demo Org')`).run(ORG_ID);
    this.db.prepare(`INSERT OR IGNORE INTO projects (id, org_id, name) VALUES (?, ?, 'dev-project')`).run(PROJECT_ID, ORG_ID);
    const seedKey = this.db.prepare(
      `INSERT OR IGNORE INTO api_keys (id, project_id, kind, key, label) VALUES (?, ?, ?, ?, ?)`,
    );
    seedKey.run(randomUUID(), PROJECT_ID, "write", "dev-key", "Local dev write key");
    seedKey.run(randomUUID(), PROJECT_ID, "read", "dev-read-key", "Local dev read key");
  }

  async resolveKey(key: string): Promise<ResolvedKey | null> {
    const row = this.db
      .prepare(`SELECT project_id, kind FROM api_keys WHERE key = ? AND revoked_at IS NULL`)
      .get(key) as { project_id: string; kind: KeyKind } | undefined;
    return row ? { projectId: row.project_id, kind: row.kind } : null;
  }

  async listApiKeys(projectId: string): Promise<ApiKey[]> {
    return this.db
      .prepare(`SELECT * FROM api_keys WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId)
      .map(mapKey);
  }

  async createApiKey(projectId: string, kind: KeyKind, label: string | null): Promise<ApiKey> {
    const row = this.db
      .prepare(
        `INSERT INTO api_keys (id, project_id, kind, key, label) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(randomUUID(), projectId, kind, generateKey(kind), label);
    return mapKey(row);
  }

  async revokeApiKey(projectId: string, id: string): Promise<boolean> {
    const r = this.db
      .prepare(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND project_id = ? AND revoked_at IS NULL`)
      .run(id, projectId);
    return Number(r.changes) > 0;
  }

  async listCharts(projectId: string): Promise<Chart[]> {
    return this.db
      .prepare(`SELECT * FROM charts WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId)
      .map(mapChart);
  }

  async getChart(projectId: string, id: string): Promise<Chart | null> {
    const row = this.db.prepare(`SELECT * FROM charts WHERE id = ? AND project_id = ?`).get(id, projectId);
    return row ? mapChart(row) : null;
  }

  async createChart(projectId: string, input: ChartInput): Promise<Chart> {
    const row = this.db
      .prepare(`INSERT INTO charts (id, project_id, name, kind, definition) VALUES (?, ?, ?, ?, ?) RETURNING *`)
      .get(randomUUID(), projectId, input.name, input.kind, JSON.stringify(input.definition));
    return mapChart(row);
  }

  async updateChart(projectId: string, id: string, input: ChartInput): Promise<Chart | null> {
    const row = this.db
      .prepare(
        `UPDATE charts SET name = ?, kind = ?, definition = ?, updated_at = datetime('now')
         WHERE id = ? AND project_id = ? RETURNING *`,
      )
      .get(input.name, input.kind, JSON.stringify(input.definition), id, projectId);
    return row ? mapChart(row) : null;
  }

  async deleteChart(projectId: string, id: string): Promise<boolean> {
    return this.db.prepare(`DELETE FROM charts WHERE id = ? AND project_id = ?`).run(id, projectId).changes as number > 0;
  }

  async listDashboards(projectId: string): Promise<Dashboard[]> {
    return this.db
      .prepare(`SELECT * FROM dashboards WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId)
      .map(mapDashboard);
  }

  async getDashboard(projectId: string, id: string): Promise<Dashboard | null> {
    const row = this.db.prepare(`SELECT * FROM dashboards WHERE id = ? AND project_id = ?`).get(id, projectId);
    return row ? mapDashboard(row) : null;
  }

  async createDashboard(projectId: string, input: DashboardInput): Promise<Dashboard> {
    const row = this.db
      .prepare(`INSERT INTO dashboards (id, project_id, name, layout) VALUES (?, ?, ?, ?) RETURNING *`)
      .get(randomUUID(), projectId, input.name, JSON.stringify(input.layout ?? []));
    return mapDashboard(row);
  }

  async updateDashboard(projectId: string, id: string, input: DashboardInput): Promise<Dashboard | null> {
    const row = this.db
      .prepare(
        `UPDATE dashboards SET name = ?, layout = ?, updated_at = datetime('now')
         WHERE id = ? AND project_id = ? RETURNING *`,
      )
      .get(input.name, JSON.stringify(input.layout ?? []), id, projectId);
    return row ? mapDashboard(row) : null;
  }

  async deleteDashboard(projectId: string, id: string): Promise<boolean> {
    return this.db.prepare(`DELETE FROM dashboards WHERE id = ? AND project_id = ?`).run(id, projectId).changes as number > 0;
  }

  async listCohorts(projectId: string): Promise<Cohort[]> {
    return this.db
      .prepare(`SELECT * FROM cohorts WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId)
      .map(mapCohort);
  }

  async createCohort(projectId: string, input: CohortInput): Promise<Cohort> {
    const row = this.db
      .prepare(`INSERT INTO cohorts (id, project_id, name, definition) VALUES (?, ?, ?, ?) RETURNING *`)
      .get(randomUUID(), projectId, input.name, JSON.stringify(input.definition));
    return mapCohort(row);
  }

  async deleteCohort(projectId: string, id: string): Promise<boolean> {
    return this.db.prepare(`DELETE FROM cohorts WHERE id = ? AND project_id = ?`).run(id, projectId).changes as number > 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// Row mappers. `any` is intentional at the driver boundary; JSON columns are
// TEXT in SQLite and get parsed back here.
function mapKey(row: any): ApiKey {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    key: row.key,
    label: row.label ?? null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
  };
}
function mapChart(row: any): Chart {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    definition: JSON.parse(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapDashboard(row: any): Dashboard {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    layout: JSON.parse(row.layout),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapCohort(row: any): Cohort {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    definition: JSON.parse(row.definition),
    createdAt: row.created_at,
  };
}
