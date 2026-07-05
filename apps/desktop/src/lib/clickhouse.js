"use strict";
// Manages a local, single-binary ClickHouse server so the desktop app needs no
// Docker. On first run it downloads the official ClickHouse binary (~160MB) into
// the app's data directory, then runs `clickhouse server` on 127.0.0.1:8123.
// This keeps our exact ClickHouse SQL (windowFunnel, Map, fromUnixTimestamp64Milli)
// working unchanged over the same HTTP client.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");

/** Map platform/arch to the ClickHouse builds directory. */
function buildDir() {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin") return a === "arm64" ? "macos-aarch64" : "macos";
  if (p === "linux") return a === "arm64" ? "aarch64" : "amd64";
  throw new Error(`managed ClickHouse is not supported on ${p}/${a} yet`);
}

function downloadTo(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadTo(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let got = 0;
      const file = fs.createWriteStream(dest);
      res.on("data", (c) => {
        got += c.length;
        if (onProgress && total) onProgress(got / total);
      });
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Run a SQL statement against the default database over HTTP. */
function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      "http://127.0.0.1:8123/",
      { method: "POST", headers: { "content-length": Buffer.byteLength(sql) } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => (res.statusCode === 200 ? resolve(buf) : reject(new Error(buf))));
      },
    );
    req.on("error", reject);
    req.write(sql);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(1000);
  }
  return false;
}

/** Ensure the ClickHouse binary exists locally, downloading it once if needed. */
async function ensureBinary(baseDir, log, onProgress) {
  const dir = path.join(baseDir, "clickhouse");
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, process.platform === "win32" ? "clickhouse.exe" : "clickhouse");
  if (fs.existsSync(bin) && fs.statSync(bin).size > 1_000_000) return bin;

  const url = `https://builds.clickhouse.com/master/${buildDir()}/clickhouse`;
  log("downloading ClickHouse (~160MB, one time)…");
  await downloadTo(url, bin, onProgress);
  fs.chmodSync(bin, 0o755);
  if (process.platform === "darwin") {
    try {
      spawnSync("xattr", ["-d", "com.apple.quarantine", bin]);
    } catch {
      /* not fatal */
    }
  }
  log("ClickHouse downloaded");
  return bin;
}

function writeConfig(dir, dataDir) {
  const configPath = path.join(dir, "config.xml");
  const usersPath = path.join(dir, "users.xml");
  fs.writeFileSync(
    configPath,
    `<clickhouse>
  <logger><level>warning</level><log>${path.join(dir, "clickhouse.log")}</log><errorlog>${path.join(dir, "clickhouse.err.log")}</errorlog></logger>
  <http_port>8123</http_port>
  <tcp_port>9000</tcp_port>
  <listen_host>127.0.0.1</listen_host>
  <!-- pin the interserver host so a single-node server never fails on a
       .local hostname that mDNS cannot resolve in a detached process -->
  <interserver_http_host>127.0.0.1</interserver_http_host>
  <path>${dataDir}/</path>
  <tmp_path>${dataDir}/tmp/</tmp_path>
  <user_directories><users_xml><path>${usersPath}</path></users_xml></user_directories>
  <mark_cache_size>536870912</mark_cache_size>
  <mlock_executable>false</mlock_executable>
</clickhouse>`,
  );
  fs.writeFileSync(
    usersPath,
    `<clickhouse>
  <profiles><default/></profiles>
  <users><default>
    <password></password>
    <networks><ip>127.0.0.1</ip></networks>
    <profile>default</profile><quota>default</quota>
    <access_management>1</access_management>
  </default></users>
  <quotas><default/></quotas>
</clickhouse>`,
  );
  return configPath;
}

/** Download (if needed) and start a local ClickHouse server; resolves once healthy. */
async function startClickHouse(baseDir, log, onProgress) {
  const bin = await ensureBinary(baseDir, log, onProgress);
  const dir = path.join(baseDir, "clickhouse");
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = writeConfig(dir, dataDir);

  log("starting ClickHouse…");
  const proc = spawn(bin, ["server", "--config-file", configPath], { stdio: "ignore" });
  proc.on("error", (e) => log(`clickhouse error: ${e.message}`));

  const ok = await waitUntil(() => httpOk("http://127.0.0.1:8123/ping"), 60000);
  if (!ok) throw new Error("managed ClickHouse did not become healthy");
  // A fresh server has no databases; create ours before the services connect.
  await runQuery("CREATE DATABASE IF NOT EXISTS amplio");
  log("ClickHouse ready");
  return {
    stop: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { startClickHouse, ensureBinary };
