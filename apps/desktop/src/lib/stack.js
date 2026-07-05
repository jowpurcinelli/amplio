"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Spawn the ingest and api services as node child processes (electron-as-node),
 * pointed at the local managed ClickHouse and an embedded SQLite metadata store.
 * No Docker, no Postgres.
 *
 * ingest starts first and initializes the SQLite schema; api starts only once
 * ingest is healthy, so the two never race to create/migrate the same file.
 * Child output goes to <baseDir>/logs for debugging.
 */
async function startServices(repoRoot, baseDir, log) {
  const nodeExe = process.execPath;
  const logDir = path.join(baseDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const baseEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    LOG_LEVEL: "warn",
    CLICKHOUSE_URL: "http://127.0.0.1:8123",
    CLICKHOUSE_DATABASE: "amplio",
    AMPLIO_DB: `sqlite:${path.join(baseDir, "amplio.db")}`,
    DATABASE_URL: "", // never let an inherited Postgres URL override SQLite
  };

  const spawnSvc = (name, script, env) => {
    const out = fs.openSync(path.join(logDir, `${name}.log`), "a");
    const proc = spawn(nodeExe, [path.join(repoRoot, script)], {
      cwd: path.join(repoRoot, path.dirname(script)),
      env,
      stdio: ["ignore", out, out],
    });
    proc.on("error", (e) => log(`${name} error: ${e.message}`));
    return proc;
  };

  const ingest = spawnSvc("ingest", "apps/ingest/dist/index.js", {
    ...baseEnv,
    PORT: "8787",
    AMPLIO_DEV_API_KEYS: "dev-key:dev-project",
  });
  await waitUntil(() => httpOk("http://127.0.0.1:8787/health"), { timeoutMs: 30000 });

  const api = spawnSvc("api", "apps/api/dist/index.js", {
    ...baseEnv,
    API_PORT: "8788",
    AMPLIO_READ_KEYS: "dev-read-key:dev-project",
  });

  const stop = () => {
    try { ingest.kill(); } catch { /* ignore */ }
    try { api.kill(); } catch { /* ignore */ }
  };
  return { stop };
}

function waitForApi() {
  return waitUntil(() => httpOk("http://127.0.0.1:8788/health"), { timeoutMs: 30000 });
}

module.exports = { startServices, waitForApi, httpOk };
