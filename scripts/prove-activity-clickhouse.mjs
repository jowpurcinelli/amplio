/** Bounded, isolated real-SQL proof. Requires an existing ClickHouse binary; installs nothing. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildActivity } from "../packages/query/dist/index.js";

const binary = process.env.CLICKHOUSE_BINARY;
const root = process.env.CLICKHOUSE_PROOF_ROOT;
if (!binary || !root) throw new Error("Set CLICKHOUSE_BINARY and CLICKHOUSE_PROOF_ROOT to an existing binary and scratch directory");
mkdirSync(root, { recursive: true });
const runPath = mkdtempSync(join(root, "activity-"));
const source = readFileSync(fileURLToPath(new URL("../apps/ingest/src/clickhouse.ts", import.meta.url)), "utf8");
const ddl = source.match(/CREATE TABLE IF NOT EXISTS \$\{database\}\.events[\s\S]*?SETTINGS index_granularity = 8192/)?.[0]
  .replace("${database}.events", "events");
if (!ddl) throw new Error("Could not extract exact production event DDL");
const fixture = [
  ["a", "signup", "u1", "", 1100, 1000, 1100],
  ["a", "page_view", "u1", "", 1600, 1000, 1600],
  ["a", "page_view", "u2", "", 1700, 1000, 1700],
  ["a", "page_view", "", "d1", 1200, 1000, 1200],
  ["a", "page_view", "", "d1", 1600, 1000, 1600],
  ["a", "page_view", "", "d2", 1800, -1, 1800],
  ["a", "click", "", "d3", 1900, 1000, 1900],
  ["a", "page_view", "old", "", 500, 500, 5000],
  ["a", "page_view", "future", "", 2000, 2000, 9000],
  ["b", "page_view", "other", "", 1999, 1999, 1999],
];
const insert = "INSERT INTO events (project_id,event_type,user_id,device_id,time_ms,session_id,server_received_time_ms) VALUES "
  + fixture.map(row => "(" + row.map(value => typeof value === "string" ? "'" + value + "'" : value).join(",") + ")").join(",") + ";";
function query(projectId, pageViewEvent = "page_view", range = { from: 1000, to: 2000 }, recentFrom = 1500) {
  const compiled = buildActivity({ projectId, range, recentFrom, pageViewEvent });
  const path = mkdtempSync(join(runPath, "query-"));
  const args = ["local", "--path", path, "--multiquery", "--query", ddl + ";" + insert + compiled.sql + " FORMAT JSONEachRow"];
  for (const [key, value] of Object.entries(compiled.params)) args.push("--param_" + key + "=" + value);
  const output = execFileSync(binary, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  return Object.fromEntries(Object.entries(JSON.parse(output.trim())).map(([key, value]) => [key, Number(value)]));
}
assert.deepEqual(query("a"), {
  identified_users: 2, recent_identified_users: 2, page_views: 5, anonymous_visitors: 2,
  anonymous_visits: 1, anonymous_pages_without_session: 1, observed_events: 8,
  last_event_at: 1900, last_received_at: 5000,
});
assert.deepEqual(query("b"), {
  identified_users: 1, recent_identified_users: 1, page_views: 1, anonymous_visitors: 0,
  anonymous_visits: 0, anonymous_pages_without_session: 0, observed_events: 1,
  last_event_at: 1999, last_received_at: 1999,
});
const absent = query("absent");
assert.equal(absent.observed_events, 0);
assert.equal(absent.identified_users, 0);
assert.equal(absent.page_views, 0);
const hostile = query("a' OR 1=1 --", "page_view' OR 1=1 --");
assert.equal(hostile.observed_events, 0);
assert.equal(hostile.page_views, 0);
const older = query("a", "page_view", { from: 0, to: 1000 }, 0);
assert.equal(older.identified_users, 1);
assert.equal(older.recent_identified_users, 1);
assert.equal(older.last_received_at, 5000);
console.log("PASS: real ClickHouse exact DDL, distinct actors/sessions, two projects, missing sessions, absent project, bound hostile inputs, event-time windows and delayed backfill");
console.log("Isolated proof scratch: " + runPath);
