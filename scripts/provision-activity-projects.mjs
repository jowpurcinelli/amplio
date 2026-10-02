/** Explicit local/server operator command. Never invoked during boot or deployment. */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
const { Pool } = createRequire(new URL("../packages/db/package.json", import.meta.url))("pg");
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath || !process.env.DATABASE_URL) throw new Error("Require manifest path, new private output path and DATABASE_URL");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (resolve(outputPath).startsWith(repository + "/")) throw new Error("Credential output must be outside the checkout");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuid.test(manifest.organization?.id) || !manifest.organization?.name || !Array.isArray(manifest.projects) || !manifest.projects.length) throw new Error("Invalid organization/project manifest");
const scopes = new Set();
const projectIds = new Set();
let tenant;
for (const project of manifest.projects) {
  if (!uuid.test(project.id) || !project.name || !project.tenantId || !project.surfaceId) throw new Error("Each project requires explicit UUID, name, tenantId and surfaceId");
  tenant ??= project.tenantId;
  if (tenant !== project.tenantId) throw new Error("One manifest/organization must contain exactly one tenant");
  const scope = project.tenantId + ":" + project.surfaceId;
  if (scopes.has(scope) || projectIds.has(project.id)) throw new Error("Duplicate scope or project id");
  scopes.add(scope); projectIds.add(project.id);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let client;
let outputCreated = false;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("INSERT INTO organizations (id,name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [manifest.organization.id, manifest.organization.name]);
  const org = await client.query("SELECT name FROM organizations WHERE id=$1", [manifest.organization.id]);
  if (org.rows[0]?.name !== manifest.organization.name) throw new Error("Existing organization differs from manifest");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [manifest.organization.id]);
  const projects = [];
  for (const project of manifest.projects) {
    await client.query("INSERT INTO projects (id,org_id,name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [project.id,manifest.organization.id,project.name]);
    const existing = await client.query("SELECT org_id,name FROM projects WHERE id=$1", [project.id]);
    if (existing.rows[0]?.org_id !== manifest.organization.id || existing.rows[0]?.name !== project.name) throw new Error("Existing project differs from manifest");
    const keys = {};
    for (const kind of ["read", "write"]) {
      const label = "Activity integration " + kind;
      const found = await client.query("SELECT key FROM api_keys WHERE project_id=$1 AND kind=$2 AND label=$3 AND revoked_at IS NULL ORDER BY created_at LIMIT 1", [project.id,kind,label]);
      let key = found.rows[0]?.key;
      if (!key) {
        key = "amp_" + (kind === "read" ? "rd" : "wr") + "_" + randomBytes(32).toString("hex");
        await client.query("INSERT INTO api_keys(project_id,kind,key,label) VALUES($1,$2,$3,$4)", [project.id,kind,key,label]);
      }
      keys[kind + "Key"] = key;
    }
    projects.push({ ...project, ...keys });
  }
  // Exclusive owner-only file creation: secrets never go to stdout or logs.
  writeFileSync(outputPath, JSON.stringify({ organizationId: manifest.organization.id, projects }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  outputCreated = true;
  await client.query("COMMIT");
  console.log("Provisioned " + projects.length + " isolated projects. Private credentials written to the specified output file.");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  if (outputCreated) { try { unlinkSync(outputPath); } catch {} }
  // Do not expose database connection strings or driver details.
  console.error("Provisioning failed or commit outcome is unconfirmed; verify database and output permissions privately before retrying.");
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
