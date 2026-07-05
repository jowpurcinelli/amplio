# @amplio/desktop

The Amplio desktop app. A native window that runs your whole analytics stack
locally and gives you the dashboard, no hosting required.

On launch it:

1. Downloads a local ClickHouse binary (~160MB, one time) and starts it.
2. Opens an embedded SQLite database for metadata (no server, no Postgres).
3. Spawns the ingest and query services as child processes.
4. Serves the dashboard and opens it, auto-pointed at your local API.
5. Adds a system-tray entry with a live event counter.

Everything runs on your machine. No Docker. Your events never leave it.

## Download

Prebuilt installers are attached to the GitHub releases (macOS `.dmg` today;
Linux `AppImage`/`.deb` from the same build config). Download, open, and run.
First launch downloads ClickHouse (~160MB); after that it is offline and fast.

## Build an installer yourself

```bash
pnpm --filter @amplio/schema build && pnpm --filter @amplio/query build \
  && pnpm --filter @amplio/db build && pnpm --filter @amplio/ingest build \
  && pnpm --filter @amplio/api build && pnpm --filter @amplio/web build
pnpm --filter @amplio/desktop dist   # bundles services + runs electron-builder
```

The result lands in `apps/desktop/release/`.

## Requirements (development)

- Node 20+ and pnpm
- Enough disk for the ClickHouse binary (~160MB) plus your event data

Data lives under the app's user-data directory (on macOS,
`~/Library/Application Support/Amplio`): the ClickHouse binary and data, the
SQLite metadata file, and service logs.

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

First launch downloads the ClickHouse binary, which can take a minute; later
launches are quick. Populate demo data with `node scripts/seed-demo.mjs`.

## Troubleshooting

- **"Electron failed to install correctly"**: a known pnpm + Electron flake
  where the postinstall leaves an incomplete binary. Fix with
  `pnpm rebuild electron`, or unzip the cached archive from
  `~/Library/Caches/electron/*/electron-*.zip` into
  `node_modules/.pnpm/electron@*/node_modules/electron/dist/`.
- **Slow first launch**: it is downloading ClickHouse (~160MB). Subsequent
  launches reuse it.

## Roadmap

- Packaged installers for macOS, Windows, and Linux (E4).
