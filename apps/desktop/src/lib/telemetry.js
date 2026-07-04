"use strict";
const http = require("node:http");
const os = require("node:os");

const INGEST = "http://127.0.0.1:8787/2/httpapi";
const STATS = "http://127.0.0.1:8788/stats";
const DEVICE_ID = `desktop-${os.hostname()}`;

function postJson(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", () => resolve());
    req.setTimeout(2000, () => {
      req.destroy();
      resolve();
    });
    req.write(data);
    req.end();
  });
}

function getJson(url, headers) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Emit one of the desktop app's own usage events, so it monitors real activity. */
function emit(eventType, props) {
  return postJson(INGEST, {
    api_key: "dev-key",
    events: [{ event_type: eventType, device_id: DEVICE_ID, event_properties: props || {}, platform: "Desktop" }],
  });
}

/** Fetch headline stats for the tray. */
function fetchStats() {
  return getJson(STATS, { authorization: "Bearer dev-read-key" });
}

module.exports = { emit, fetchStats, DEVICE_ID };
