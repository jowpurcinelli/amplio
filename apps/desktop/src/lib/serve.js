"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serve a built single-page app directory over HTTP with SPA fallback.
 * Returns { url, close } once listening.
 */
function serveSpa(dir, port = 8790) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = path.join(dir, urlPath);
      if (!filePath.startsWith(dir)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.stat(filePath, (err, stat) => {
        if (err || stat.isDirectory()) filePath = path.join(dir, "index.html"); // SPA fallback
        fs.readFile(filePath, (readErr, buf) => {
          if (readErr) {
            res.writeHead(404).end("not found");
            return;
          }
          res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
          res.end(buf);
        });
      });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() }));
  });
}

module.exports = { serveSpa };
