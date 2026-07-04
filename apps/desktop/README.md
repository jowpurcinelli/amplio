# @amplio/desktop

The Amplio desktop app. A native window that runs your whole analytics stack
locally and gives you the dashboard, no hosting required.

On launch it:

1. Brings up the data stores (ClickHouse + Postgres) via the repo's docker
   compose.
2. Spawns the ingest and query services as child processes.
3. Serves the dashboard and opens it, auto-pointed at your local API.
4. Adds a system-tray entry.

Everything runs on your machine. Your events never leave it.

## Requirements

- Node 20+ and pnpm (for development)
- Docker (for the local ClickHouse + Postgres; a Docker-free mode using an
  embedded metadata store and a managed ClickHouse binary is on the roadmap)

## Run it (development)

From the repo root:

```bash
pnpm install
# build the pieces the app orchestrates
pnpm --filter @amplio/schema build
pnpm --filter @amplio/query build
pnpm --filter @amplio/db build
pnpm --filter @amplio/ingest build
pnpm --filter @amplio/api build
pnpm --filter @amplio/web build
# launch the desktop app
pnpm --filter @amplio/desktop start
```

First launch pulls Docker images, which can take a minute; later launches are
quick. Populate demo data with `node scripts/seed-demo.mjs`.

## Troubleshooting

- **"Electron failed to install correctly"**: a known pnpm + Electron flake
  where the postinstall leaves an incomplete binary. Fix with
  `pnpm rebuild electron`, or unzip the cached archive from
  `~/Library/Caches/electron/*/electron-*.zip` into
  `node_modules/.pnpm/electron@*/node_modules/electron/dist/`.
- **"Could not start Amplio"**: Docker is not running. Start Docker and reopen.

## Roadmap

- Real-time monitoring: a live event feed and a tray counter (E2).
- Docker-free: SQLite metadata and a managed ClickHouse binary (E3).
- Packaged installers for macOS, Windows, and Linux (E4).
