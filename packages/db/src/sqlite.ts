import { DatabaseSync } from "node:sqlite";
import { generateKey, randomUUID } from "./keys.js";
import type {
  AdminOrg,
  ApiKey,
  Chart,
  ChartInput,
  Cohort,
  CohortInput,
  Dashboard,
  DashboardInput,
  Flag,
  FlagInput,
  Invite,
  KeyKind,
  Member,
  NewUser,
  OrgMembership,
  ResolvedKey,
  Role,
  Store,
  User,
  UserProject,
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
    if (path !== ":memory:") {
      // busy_timeout MUST come first: several processes (ingest + api) open the
      // same file and the WAL switch + migration take locks. Without it, a
      // concurrent open fails immediately with "database is locked".
      this.db.exec("PRAGMA busy_timeout = 5000");
      this.db.exec("PRAGMA journal_mode = WAL");
    }
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0, rollout INTEGER NOT NULL DEFAULT 0,
        variants TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, key)
      );
      CREATE INDEX IF NOT EXISTS flags_project_idx ON flags(project_id);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, org_id TEXT, email TEXT NOT NULL UNIQUE, name TEXT,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memberships (
        org_id TEXT NOT NULL, user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), accepted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS invites_org_idx ON invites(org_id);
    `);
    // Add the plan column for orgs created before billing (SQLite has no
    // ADD COLUMN IF NOT EXISTS, so ignore the "duplicate column" error).
    try {
      this.db.exec(`ALTER TABLE organizations ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'`);
    } catch {
      /* column already exists */
    }
    // Backfill a membership for any user that predates this table.
    this.db.exec(
      `INSERT OR IGNORE INTO memberships (org_id, user_id, role)
       SELECT org_id, id, 'owner' FROM users WHERE org_id IS NOT NULL`,
    );
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

  async createUser(input: NewUser): Promise<User> {
    const row = this.db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(randomUUID(), input.orgId, input.email.toLowerCase(), input.name, input.passwordHash);
    return mapUser(row);
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    return row ? mapUser(row) : null;
  }

  async getCredentials(email: string): Promise<{ user: User; passwordHash: string } | null> {
    const row = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as
      | { password_hash: string }
      | undefined;
    return row ? { user: mapUser(row), passwordHash: row.password_hash } : null;
  }

  async createOrg(name: string): Promise<{ id: string }> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO organizations (id, name) VALUES (?, ?)`).run(id, name);
    return { id };
  }

  async getOrgPlan(id: string): Promise<string | null> {
    const row = this.db.prepare(`SELECT plan FROM organizations WHERE id = ?`).get(id) as { plan: string } | undefined;
    return row?.plan ?? null;
  }

  async setOrgPlan(id: string, plan: string): Promise<boolean> {
    const r = this.db.prepare(`UPDATE organizations SET plan = ? WHERE id = ?`).run(plan, id);
    return r.changes > 0;
  }

  async renameOrg(id: string, name: string): Promise<boolean> {
    const r = this.db.prepare(`UPDATE organizations SET name = ? WHERE id = ?`).run(name, id);
    return r.changes > 0;
  }

  async listOrgProjects(orgId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .prepare(`SELECT id, name FROM projects WHERE org_id = ? ORDER BY created_at`)
      .all(orgId) as Array<{ id: string; name: string }>;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const r = this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
    return r.changes > 0;
  }

  async deleteUser(userId: string): Promise<boolean> {
    this.db.prepare(`DELETE FROM memberships WHERE user_id = ?`).run(userId);
    const r = this.db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    return r.changes > 0;
  }

  async listAllOrgs(): Promise<AdminOrg[]> {
    const rows = this.db
      .prepare(
        `SELECT o.id, o.name, o.plan, o.created_at,
           (SELECT count(*) FROM memberships m WHERE m.org_id = o.id) AS members,
           (SELECT count(*) FROM projects p WHERE p.org_id = o.id) AS projects
         FROM organizations o ORDER BY o.created_at DESC`,
      )
      .all() as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      plan: row.plan as string,
      members: Number(row.members),
      projects: Number(row.projects),
      createdAt: row.created_at as string,
    }));
  }

  async countUsers(): Promise<number> {
    const row = this.db.prepare(`SELECT count(*) AS n FROM users`).get() as { n: number };
    return row.n;
  }

  async deleteOrg(id: string): Promise<void> {
    // SQLite has FKs off, so remove children explicitly.
    this.db
      .prepare(`DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)`)
      .run(id);
    this.db.prepare(`DELETE FROM projects WHERE org_id = ?`).run(id);
    this.db.prepare(`DELETE FROM memberships WHERE org_id = ?`).run(id);
    this.db.prepare(`DELETE FROM invites WHERE org_id = ?`).run(id);
    this.db.prepare(`DELETE FROM users WHERE org_id = ?`).run(id);
    this.db.prepare(`DELETE FROM organizations WHERE id = ?`).run(id);
  }

  async createProject(orgId: string, name: string): Promise<{ id: string }> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO projects (id, org_id, name) VALUES (?, ?, ?)`).run(id, orgId, name);
    return { id };
  }

  async getUserProjects(userId: string): Promise<UserProject[]> {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, o.id AS org_id, o.name AS org_name, m.role,
           (SELECT key FROM api_keys k WHERE k.project_id = p.id AND k.kind = 'read'
              AND k.revoked_at IS NULL ORDER BY created_at LIMIT 1) AS read_key,
           (SELECT key FROM api_keys k WHERE k.project_id = p.id AND k.kind = 'write'
              AND k.revoked_at IS NULL ORDER BY created_at LIMIT 1) AS write_key
         FROM projects p
         JOIN memberships m ON m.org_id = p.org_id
         JOIN organizations o ON o.id = p.org_id
         WHERE m.user_id = ?
         ORDER BY o.created_at, p.created_at`,
      )
      .all(userId) as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      readKey: (row.read_key as string) ?? null,
      writeKey: (row.write_key as string) ?? null,
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      role: row.role as Role,
    }));
  }

  async renameProject(orgId: string, projectId: string, name: string): Promise<boolean> {
    const r = this.db.prepare(`UPDATE projects SET name = ? WHERE id = ? AND org_id = ?`).run(name, projectId, orgId);
    return r.changes > 0;
  }

  async deleteProject(orgId: string, projectId: string): Promise<boolean> {
    // Scope the key delete to the org too, so passing another org's projectId
    // can never wipe that project's keys (the project delete alone is scoped).
    this.db
      .prepare(`DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE id = ? AND org_id = ?)`)
      .run(projectId, orgId);
    const r = this.db.prepare(`DELETE FROM projects WHERE id = ? AND org_id = ?`).run(projectId, orgId);
    return r.changes > 0;
  }

  async addMember(orgId: string, userId: string, role: Role): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(orgId, userId, role);
  }

  async removeMember(orgId: string, userId: string): Promise<boolean> {
    const r = this.db.prepare(`DELETE FROM memberships WHERE org_id = ? AND user_id = ?`).run(orgId, userId);
    return r.changes > 0;
  }

  async setMemberRole(orgId: string, userId: string, role: Role): Promise<boolean> {
    const r = this.db.prepare(`UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?`).run(role, orgId, userId);
    return r.changes > 0;
  }

  async listMembers(orgId: string): Promise<Member[]> {
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ? ORDER BY m.created_at`,
      )
      .all(orgId) as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      userId: row.user_id as string,
      email: row.email as string,
      name: (row.name as string) ?? null,
      role: row.role as Role,
      createdAt: row.created_at as string,
    }));
  }

  async getMemberRole(orgId: string, userId: string): Promise<Role | null> {
    const row = this.db
      .prepare(`SELECT role FROM memberships WHERE org_id = ? AND user_id = ?`)
      .get(orgId, userId) as { role: Role } | undefined;
    return row?.role ?? null;
  }

  async listUserOrgs(userId: string): Promise<OrgMembership[]> {
    const rows = this.db
      .prepare(
        `SELECT o.id AS org_id, o.name AS org_name, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = ? ORDER BY o.created_at`,
      )
      .all(userId) as Array<{ org_id: string; org_name: string; role: Role }>;
    return rows.map((row) => ({ orgId: row.org_id, orgName: row.org_name, role: row.role }));
  }

  async countMembersWithRole(orgId: string, role: Role): Promise<number> {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM memberships WHERE org_id = ? AND role = ?`)
      .get(orgId, role) as { n: number };
    return row.n;
  }

  async createInvite(orgId: string, email: string, role: Role, token: string): Promise<Invite> {
    const row = this.db
      .prepare(
        `INSERT INTO invites (id, org_id, email, role, token) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(randomUUID(), orgId, email.toLowerCase(), role, token);
    return mapInvite(row);
  }

  async listInvites(orgId: string): Promise<Invite[]> {
    return this.db
      .prepare(`SELECT * FROM invites WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`)
      .all(orgId)
      .map(mapInvite);
  }

  async getInviteByToken(token: string): Promise<Invite | null> {
    const row = this.db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token);
    return row ? mapInvite(row) : null;
  }

  async markInviteAccepted(id: string): Promise<void> {
    this.db.prepare(`UPDATE invites SET accepted_at = datetime('now') WHERE id = ?`).run(id);
  }

  async deleteInvite(orgId: string, id: string): Promise<boolean> {
    const r = this.db.prepare(`DELETE FROM invites WHERE id = ? AND org_id = ?`).run(id, orgId);
    return r.changes > 0;
  }

  async listFlags(projectId: string): Promise<Flag[]> {
    return this.db
      .prepare(`SELECT * FROM flags WHERE project_id = ? ORDER BY key`)
      .all(projectId)
      .map(mapFlag);
  }

  async getFlag(projectId: string, key: string): Promise<Flag | null> {
    const row = this.db.prepare(`SELECT * FROM flags WHERE project_id = ? AND key = ?`).get(projectId, key);
    return row ? mapFlag(row) : null;
  }

  async createFlag(projectId: string, input: FlagInput): Promise<Flag> {
    const row = this.db
      .prepare(
        `INSERT INTO flags (id, project_id, key, description, enabled, rollout, variants)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        randomUUID(),
        projectId,
        input.key,
        input.description ?? null,
        input.enabled ? 1 : 0,
        input.rollout,
        JSON.stringify(input.variants ?? []),
      );
    return mapFlag(row);
  }

  async updateFlag(projectId: string, id: string, input: FlagInput): Promise<Flag | null> {
    const row = this.db
      .prepare(
        `UPDATE flags SET key = ?, description = ?, enabled = ?, rollout = ?, variants = ?, updated_at = datetime('now')
         WHERE id = ? AND project_id = ? RETURNING *`,
      )
      .get(
        input.key,
        input.description ?? null,
        input.enabled ? 1 : 0,
        input.rollout,
        JSON.stringify(input.variants ?? []),
        id,
        projectId,
      );
    return row ? mapFlag(row) : null;
  }

  async deleteFlag(projectId: string, id: string): Promise<boolean> {
    return this.db.prepare(`DELETE FROM flags WHERE id = ? AND project_id = ?`).run(id, projectId).changes as number > 0;
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
function mapUser(row: any): User {
  return {
    id: row.id,
    orgId: row.org_id ?? null,
    email: row.email,
    name: row.name ?? null,
    createdAt: row.created_at,
  };
}
function mapInvite(row: any): Invite {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
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
    variants: JSON.parse(row.variants),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
