# Deploying Amplio

Amplio self-hosts as a small set of containers behind a reverse proxy that
terminates TLS. The production stack lives in `deploy/docker-compose.prod.yml`:

- **caddy**: reverse proxy with automatic HTTPS, routes the three surfaces
- **web**: the dashboard (static, served by nginx)
- **api**: the query API
- **ingest**: the event ingestion service (SDK endpoint)
- **clickhouse**: event store
- **postgres**: metadata store

Caddy routes a single domain:

- `/2/httpapi` and `/batch` to **ingest** (where SDKs send events)
- `/api/*` to the **api** (the dashboard's queries)
- everything else to the **web** dashboard

## Requirements

- A Linux server with Docker and the Compose plugin
- A domain name with an A record pointing at the server (for HTTPS)
- Ports 80 and 443 open

## Configure

```bash
cp deploy/.env.prod.example deploy/.env
# edit deploy/.env:
#   AMPLIO_DOMAIN=amplio.yourdomain.com
#   CLICKHOUSE_PASSWORD / POSTGRES_PASSWORD: strong secrets
#   AMPLIO_WRITE_KEYS / AMPLIO_READ_KEYS: your project keys
```

## Launch

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Caddy provisions a certificate on first request. The dashboard is then at
`https://AMPLIO_DOMAIN`, the SDK endpoint at the same host, and the query API
under `/api`.

Point an SDK at it:

```ts
amplio.init("YOUR_WRITE_KEY", "https://amplio.yourdomain.com");
```

## Local trial (no domain)

```bash
AMPLIO_DOMAIN=localhost \
CLICKHOUSE_PASSWORD=dev POSTGRES_PASSWORD=dev \
AMPLIO_WRITE_KEYS=dev-key:default-project \
AMPLIO_READ_KEYS=dev-read-key:default-project \
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Caddy serves a local certificate for `https://localhost`.

## Operating notes

- **Schema**: the ingest service creates the ClickHouse `events` table on boot.
  Postgres metadata tables come from `deploy/postgres/init.sql` on first start.
- **Keys**: for now, write and read keys come from environment variables. Moving
  them into Postgres (managed from the dashboard) is on the roadmap.
- **Backups**: persist and back up the `clickhouse_data` and `postgres_data`
  volumes. Events are the irreplaceable data.
- **Retention**: no events are deleted by default. To cap retention, add a TTL
  on the `events` table keyed on ingestion time (see `docs/MAINTENANCE.md`).
- **Scaling**: ingest and api are stateless and scale horizontally behind the
  proxy. ClickHouse starts as a single node; cluster it when volume demands.
