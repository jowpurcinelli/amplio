"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const { serveSpa } = require("./lib/serve.js");
const { startServices, waitForApi } = require("./lib/stack.js");
const { startClickHouse } = require("./lib/clickhouse.js");
const { emit, fetchStats } = require("./lib/telemetry.js");

app.setName("Amplio"); // keeps userData at ~/Library/Application Support/Amplio

// In dev, run the services and dashboard from the monorepo's build outputs.
// When packaged, they are bundled under Resources/build (see build.mjs +
// electron-builder extraResources), self-contained with no node_modules.
const REPO_ROOT = path.resolve(__dirname, "../../..");
function resolvePaths() {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, "build");
    return {
      web: path.join(base, "web"),
      scripts: { ingest: path.join(base, "ingest.cjs"), api: path.join(base, "api.cjs") },
    };
  }
  return {
    web: path.join(REPO_ROOT, "apps/web/dist"),
    scripts: {
      ingest: path.join(REPO_ROOT, "apps/ingest/dist/index.js"),
      api: path.join(REPO_ROOT, "apps/api/dist/index.js"),
    },
  };
}

let win = null;
let tray = null;
let services = null;
let clickhouse = null;
let renderer = null;
let heartbeat = null;
let trayPoll = null;
let lastStats = { total: 0, lastHour: 0 };

function log(msg) {
  process.stdout.write(`[amplio-desktop] ${msg}\n`);
}

/** A minimal inline page shown while the local stack boots. */
function bootPage(title, detail) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d0d0d;color:#fff;display:grid;place-items:center}
    .box{text-align:center;max-width:520px;padding:24px}
    .dot{width:16px;height:16px;border-radius:5px;background:linear-gradient(135deg,#2a78d6,#4a3aa7);display:inline-block;vertical-align:middle;margin-right:10px}
    h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0 0 8px}
    p{color:#c3c2b7;line-height:1.5}
  </style></head><body><div class="box"><h1><span class="dot"></span>Amplio</h1><p>${title}</p><p id="detail" style="color:#898781;font-size:13px">${detail || ""}</p></div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

/** Update the boot screen's detail line without a full reload. */
function setBootDetail(text) {
  if (win && !win.isDestroyed()) {
    win.webContents
      .executeJavaScript(`(()=>{const el=document.getElementById('detail');if(el)el.textContent=${JSON.stringify(text)};})()`)
      .catch(() => {});
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0d0d0d",
    title: "Amplio",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
    },
  });
  win.loadURL(bootPage("Starting the local analytics stack…", "First launch pulls Docker images, this can take a minute."));
}

function setupTray() {
  try {
    // 1x1 transparent placeholder; a real icon ships with E4 packaging.
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
    tray = new Tray(icon);
    renderTray();
  } catch (e) {
    log(`tray unavailable: ${e.message}`);
  }
}

/** Rebuild the tray tooltip and menu from the latest stats. */
function renderTray() {
  if (!tray) return;
  tray.setToolTip(`Amplio · ${lastStats.total.toLocaleString()} events`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${lastStats.total.toLocaleString()} events tracked`, enabled: false },
      { label: `${lastStats.lastHour.toLocaleString()} in the last hour`, enabled: false },
      { type: "separator" },
      { label: "Show Amplio", click: () => win && win.show() },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

/** Emit the app's own usage events and keep the tray counter live. */
function startMonitoring() {
  emit("amplio_desktop_launched", {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  });
  heartbeat = setInterval(() => emit("amplio_desktop_heartbeat"), 30000);
  if (win) win.on("focus", () => emit("amplio_desktop_focus"));

  trayPoll = setInterval(async () => {
    const s = await fetchStats();
    if (s) {
      lastStats = s;
      renderTray();
    }
  }, 4000);
}

async function boot() {
  createWindow();
  setupTray();
  const baseDir = app.getPath("userData");
  const paths = resolvePaths();
  try {
    clickhouse = await startClickHouse(baseDir, log, (frac) =>
      setBootDetail(`Downloading ClickHouse… ${Math.round(frac * 100)}%`),
    );
    setBootDetail("Starting services…");
    services = await startServices(paths.scripts, baseDir, log);
    log("waiting for api…");
    const ok = await waitForApi();
    if (!ok) throw new Error("the query API did not become healthy");
    renderer = await serveSpa(paths.web, 8790);
    log(`dashboard ready at ${renderer.url}`);
    if (win) win.loadURL(renderer.url);
    startMonitoring();
    log("self-monitoring on; tray counter live");
  } catch (e) {
    log(`boot failed: ${e.message}`);
    if (win) win.loadURL(bootPage("Could not start Amplio.", e.message));
  }
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    // If the stack is already up, go straight to the dashboard, not the boot page.
    if (renderer && win) win.loadURL(renderer.url);
  }
});

app.on("before-quit", () => {
  if (heartbeat) clearInterval(heartbeat);
  if (trayPoll) clearInterval(trayPoll);
  if (services) services.stop();
  if (clickhouse) clickhouse.stop();
  if (renderer) renderer.close();
});

module.exports = { REPO_ROOT, resolvePaths };
