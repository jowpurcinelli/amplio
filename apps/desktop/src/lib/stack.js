"use strict";
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
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

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Bring up ClickHouse + Postgres via the repo's docker compose. */
async function ensureDataStores(repoRoot, log) {
  const composeFile = path.join(repoRoot, "deploy", "docker-compose.yml");
  log(`starting data stores (docker compose)…`);
  await new Promise((resolve) => {
    const p = spawn("docker", ["compose", "-f", composeFile, "up", "-d"], { stdio: "ignore" });
    p.on("error", () => resolve()); // docker missing: fall through, health check will report
    p.on("exit", () => resolve());
  });
  const chReady = await waitUntil(() => httpOk("http://127.0.0.1:8123/ping"), { timeoutMs: 90000 });
  const pgReady = await waitUntil(() => tcpOpen("127.0.0.1", 5433), { timeoutMs: 90000 });
  if (!chReady || !pgReady) {
    throw new Error(
      "data stores not reachable. Is Docker running? ClickHouse:" + chReady + " Postgres:" + pgReady,
    );
  }
  log("data stores ready");
}

/** Spawn the ingest and api services as node child processes (electron-as-node). */
function startServices(repoRoot, log) {
  const nodeExe = process.execPath;
  const baseEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    LOG_LEVEL: "warn",
    CLICKHOUSE_URL: "http://127.0.0.1:8123",
    CLICKHOUSE_DATABASE: "amplio",
    DATABASE_URL: "postgres://amplio:amplio@127.0.0.1:5433/amplio",
  };

  const ingest = spawn(nodeExe, [path.join(repoRoot, "apps/ingest/dist/index.js")], {
    cwd: path.join(repoRoot, "apps/ingest"),
    env: { ...baseEnv, PORT: "8787", AMPLIO_DEV_API_KEYS: "dev-key:dev-project" },
    stdio: "ignore",
  });
  const api = spawn(nodeExe, [path.join(repoRoot, "apps/api/dist/index.js")], {
    cwd: path.join(repoRoot, "apps/api"),
    env: { ...baseEnv, API_PORT: "8788", AMPLIO_READ_KEYS: "dev-read-key:dev-project" },
    stdio: "ignore",
  });
  ingest.on("error", (e) => log(`ingest error: ${e.message}`));
  api.on("error", (e) => log(`api error: ${e.message}`));

  const stop = () => {
    try { ingest.kill(); } catch { /* ignore */ }
    try { api.kill(); } catch { /* ignore */ }
  };
  return { stop };
}

/** Wait until the query API answers health. */
function waitForApi() {
  return waitUntil(() => httpOk("http://127.0.0.1:8788/health"), { timeoutMs: 30000 });
}

module.exports = { ensureDataStores, startServices, waitForApi, httpOk };
