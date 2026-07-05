// Bundle the ingest and api services into standalone CommonJS files and copy
// the built dashboard, so the packaged desktop app is self-contained and does
// not depend on the monorepo's node_modules at runtime.
import esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");
const out = path.join(here, "build");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// node:sqlite is a built-in; pg's optional native/edge shims are not used.
const external = ["node:sqlite", "pg-native", "cloudflare:sockets"];

for (const svc of ["ingest", "api"]) {
  const entry = path.join(repoRoot, "apps", svc, "dist", "index.js");
  if (!existsSync(entry)) throw new Error(`missing build input: ${entry} (build the services first)`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: path.join(out, `${svc}.cjs`),
    external,
    logLevel: "warning",
  });
  console.log(`bundled ${svc}`);
}

const webSrc = path.join(repoRoot, "apps", "web", "dist");
if (!existsSync(webSrc)) throw new Error(`missing web build: ${webSrc}`);
cpSync(webSrc, path.join(out, "web"), { recursive: true });
console.log("copied dashboard");
console.log("desktop bundle ready at", out);
