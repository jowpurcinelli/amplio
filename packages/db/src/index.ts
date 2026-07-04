import { randomBytes } from "node:crypto";
import pg from "pg";
import type { Pool as PoolType } from "pg";

const { Pool } = pg;

export type { PoolType as Pool };
export type KeyKind = "write" | "read";

export interface ResolvedKey {
  projectId: string;
  kind: KeyKind;
}
export interface ApiKey {
  id: string;
  projectId: string;
  kind: KeyKind;
  key: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export interface Chart {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  definition: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface Dashboard {
  id: string;
  projectId: string;
  name: string;
  layout: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface Cohort {
  id: string;
  projectId: string;
  name: string;
  definition: unknown;
  createdAt: string;
}

/** Create a pool from a connection URL, or null when none is configured. */
export function makePool(url: string | undefined): PoolType | null {
  if (!url) return null;
  return new Pool({ connectionString: url, max: 10 });
}

export function generateKey(kind: KeyKind): string {
  return `amp_${kind === "write" ? "wr" : "rd"}_${randomBytes(18).toString("base64url")}`;
}

// --- API keys ---

export async function resolveKey(pool: PoolType, key: string): Promise<ResolvedKey | null> {
  const r = await pool.query(
    `SELECT project_id, kind FROM api_keys WHERE key = $1 AND revoked_at IS NULL`,
    [key],
  );
  const row = r.rows[0];
  return row ? { projectId: row.project_id, kind: row.kind } : null;
}

export async function listApiKeys(pool: PoolType, projectId: string): Promise<ApiKey[]> {
  const r = await pool.query(
    `SELECT id, project_id, kind, key, label, created_at, revoked_at
     FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return r.rows.map(mapKey);
}

export async function createApiKey(
  pool: PoolType,
  projectId: string,
  kind: KeyKind,
  label: string | null,
): Promise<ApiKey> {
  const key = generateKey(kind);
  const r = await pool.query(
    `INSERT INTO api_keys (project_id, kind, key, label)
     VALUES ($1, $2, $3, $4)
     RETURNING id, project_id, kind, key, label, created_at, revoked_at`,
    [projectId, kind, key, label],
  );
  return mapKey(r.rows[0]);
}

export async function revokeApiKey(pool: PoolType, projectId: string, id: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE api_keys SET revoked_at = now()
     WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`,
    [id, projectId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Charts ---

export async function listCharts(pool: PoolType, projectId: string): Promise<Chart[]> {
  const r = await pool.query(
    `SELECT id, project_id, name, kind, definition, created_at, updated_at
     FROM charts WHERE project_id = $1 ORDER BY updated_at DESC`,
    [projectId],
  );
  return r.rows.map(mapChart);
}

export async function getChart(pool: PoolType, projectId: string, id: string): Promise<Chart | null> {
  const r = await pool.query(
    `SELECT id, project_id, name, kind, definition, created_at, updated_at
     FROM charts WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  return r.rows[0] ? mapChart(r.rows[0]) : null;
}

export async function createChart(
  pool: PoolType,
  projectId: string,
  input: { name: string; kind: string; definition: unknown },
): Promise<Chart> {
  const r = await pool.query(
    `INSERT INTO charts (project_id, name, kind, definition)
     VALUES ($1, $2, $3, $4)
     RETURNING id, project_id, name, kind, definition, created_at, updated_at`,
    [projectId, input.name, input.kind, JSON.stringify(input.definition)],
  );
  return mapChart(r.rows[0]);
}

export async function updateChart(
  pool: PoolType,
  projectId: string,
  id: string,
  input: { name: string; kind: string; definition: unknown },
): Promise<Chart | null> {
  const r = await pool.query(
    `UPDATE charts SET name = $3, kind = $4, definition = $5, updated_at = now()
     WHERE id = $1 AND project_id = $2
     RETURNING id, project_id, name, kind, definition, created_at, updated_at`,
    [id, projectId, input.name, input.kind, JSON.stringify(input.definition)],
  );
  return r.rows[0] ? mapChart(r.rows[0]) : null;
}

export async function deleteChart(pool: PoolType, projectId: string, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM charts WHERE id = $1 AND project_id = $2`, [id, projectId]);
  return (r.rowCount ?? 0) > 0;
}

// --- Dashboards ---

export async function listDashboards(pool: PoolType, projectId: string): Promise<Dashboard[]> {
  const r = await pool.query(
    `SELECT id, project_id, name, layout, created_at, updated_at
     FROM dashboards WHERE project_id = $1 ORDER BY updated_at DESC`,
    [projectId],
  );
  return r.rows.map(mapDashboard);
}

export async function getDashboard(
  pool: PoolType,
  projectId: string,
  id: string,
): Promise<Dashboard | null> {
  const r = await pool.query(
    `SELECT id, project_id, name, layout, created_at, updated_at
     FROM dashboards WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  return r.rows[0] ? mapDashboard(r.rows[0]) : null;
}

export async function createDashboard(
  pool: PoolType,
  projectId: string,
  input: { name: string; layout: unknown },
): Promise<Dashboard> {
  const r = await pool.query(
    `INSERT INTO dashboards (project_id, name, layout)
     VALUES ($1, $2, $3)
     RETURNING id, project_id, name, layout, created_at, updated_at`,
    [projectId, input.name, JSON.stringify(input.layout ?? [])],
  );
  return mapDashboard(r.rows[0]);
}

export async function updateDashboard(
  pool: PoolType,
  projectId: string,
  id: string,
  input: { name: string; layout: unknown },
): Promise<Dashboard | null> {
  const r = await pool.query(
    `UPDATE dashboards SET name = $3, layout = $4, updated_at = now()
     WHERE id = $1 AND project_id = $2
     RETURNING id, project_id, name, layout, created_at, updated_at`,
    [id, projectId, input.name, JSON.stringify(input.layout ?? [])],
  );
  return r.rows[0] ? mapDashboard(r.rows[0]) : null;
}

export async function deleteDashboard(pool: PoolType, projectId: string, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM dashboards WHERE id = $1 AND project_id = $2`, [id, projectId]);
  return (r.rowCount ?? 0) > 0;
}

// --- Cohorts ---

export async function listCohorts(pool: PoolType, projectId: string): Promise<Cohort[]> {
  const r = await pool.query(
    `SELECT id, project_id, name, definition, created_at
     FROM cohorts WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return r.rows.map(mapCohort);
}

export async function createCohort(
  pool: PoolType,
  projectId: string,
  input: { name: string; definition: unknown },
): Promise<Cohort> {
  const r = await pool.query(
    `INSERT INTO cohorts (project_id, name, definition)
     VALUES ($1, $2, $3)
     RETURNING id, project_id, name, definition, created_at`,
    [projectId, input.name, JSON.stringify(input.definition)],
  );
  return mapCohort(r.rows[0]);
}

export async function deleteCohort(pool: PoolType, projectId: string, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM cohorts WHERE id = $1 AND project_id = $2`, [id, projectId]);
  return (r.rowCount ?? 0) > 0;
}

// --- row mappers ---
// `any` is intentional here: these run at the pg driver boundary where rows are
// untyped, and each mapper is the single place that pins the shape.

function mapKey(row: any): ApiKey {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    key: row.key,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}
function mapChart(row: any): Chart {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    definition: row.definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapDashboard(row: any): Dashboard {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    layout: row.layout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapCohort(row: any): Cohort {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    definition: row.definition,
    createdAt: row.created_at,
  };
}
