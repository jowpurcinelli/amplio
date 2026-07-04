# Amplio Roadmap

Amplio aims to be a full open replacement for Amplitude's analytics core. Work
is organized in phases; each ships something usable.

## Shipped (v0.1.0)

Everything below is built, tested, and verified end to end against a live stack.

- **Ingestion**: Fastify service with Amplitude-compatible `/2/httpapi` and
  `/batch`, zod validation, API-key auth, batched ClickHouse writes.
- **Storage**: ClickHouse `events` table (no default TTL, so backfills are never
  dropped); Postgres metadata (orgs, projects, keys, charts, dashboards,
  cohorts).
- **Query engine**: segmentation, funnels (windowFunnel), retention (cohort
  base), cohort filtering, and per-user activity. Injection-safe by
  construction.
- **Query + metadata API**: analytics endpoints plus CRUD for charts,
  dashboards, cohorts, and API keys, with DB-backed key resolution.
- **SDKs**: browser SDK (batching, offline queue, sessions, retry) and a Node
  SDK, sharing one isomorphic client.
- **Dashboard**: events overview, segmentation, funnels, retention, user
  lookup, cohort builder, dashboards grid, saved-charts library, API-key
  management, CSV export, light/dark.
- **Self-host**: Dockerfiles, a production docker-compose with a Caddy
  reverse proxy (auto-TLS), and a demo seed script.

## Next

- **Public demo instance** (needs a server + domain).
- **Data governance**: event and property taxonomy, descriptions, hiding.

## Later modules

Each of these is a separate, product-sized effort:

- Session replay
- Experimentation and feature flags
- Marketing attribution and multi-touch
- Alerting and anomaly detection
- Data export and warehouse sync (reverse ETL)
