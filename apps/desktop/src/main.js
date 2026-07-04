"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const { serveSpa } = require("./lib/serve.js");
const { ensureDataStores, startServices, waitForApi } = require("./lib/stack.js");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WEB_DIST = path.join(REPO_ROOT, "apps/web/dist");

let win = null;
let tray = null;
let services = null;
let renderer = null;

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
  </style></head><body><div class="box"><h1><span class="dot"></span>Amplio</h1><p>${title}</p><p style="color:#898781;font-size:13px">${detail || ""}</p></div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
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
    tray.setToolTip("Amplio");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show Amplio", click: () => win && win.show() },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
  } catch (e) {
    log(`tray unavailable: ${e.message}`);
  }
}

async function boot() {
  createWindow();
  setupTray();
  try {
    await ensureDataStores(REPO_ROOT, log);
    services = startServices(REPO_ROOT, log);
    log("waiting for api…");
    const ok = await waitForApi();
    if (!ok) throw new Error("the query API did not become healthy");
    renderer = await serveSpa(WEB_DIST, 8790);
    log(`dashboard ready at ${renderer.url}`);
    if (win) win.loadURL(renderer.url);
  } catch (e) {
    log(`boot failed: ${e.message}`);
    if (win) win.loadURL(bootPage("Could not start Amplio.", e.message + " — is Docker running?"));
  }
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (services) services.stop();
  if (renderer) renderer.close();
});

module.exports = { REPO_ROOT, WEB_DIST };
