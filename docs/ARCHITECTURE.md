# Amplio Architecture

Amplio is a self-hosted product analytics platform. It ingests behavioral events, stores them in a columnar database built for analytics, and answers analytical questions (segmentation, funnels, retention, cohorts) over that data through a query API and a dashboard.

## Design principles

1. **Amplitude compatibility first.** The ingestion contract mirrors Amplitude's HTTP V2 API so existing instrumentation ports over. The event model (event_type, user_id, device_id, event_properties, user_properties, groups) is preserved.
2. **Right database for the job.** Event analytics is a wide-scan, high-cardinality, append-heavy workload. ClickHouse handles it. Relational metadata (who owns which project, which API key maps where, saved charts) lives in Postgres.
3. **Stateless services.** Ingest and query services hold no local state, so they scale horizontally behind a load balancer.
4. **Schema-on-write for the envelope, schema-on-read for properties.** Core columns are typed and indexed. Arbitrary event and user properties are stored as JSON/Map columns and resolved at query time, matching how product analytics tools stay flexible.

## Components

### Ingest service (`apps/ingest`)

A Fastify HTTP service exposing an Amplitude-compatible ingestion surface:

- `POST /2/httpapi` and `POST /batch` accept `{ api_key, events: [...] }`.
- Each event is validated against the shared schema (`packages/schema`).
- The API key is resolved to a project. Unknown keys are rejected.
- Valid events are enriched (server receive time, ingestion id, parsed IP geo later) and buffered.
- Events are flushed to ClickHouse in batches via async insert for throughput.

Failure handling favors durability of accepted events: once the API returns 200, the event is committed to a buffer that survives to ClickHouse. A dead-letter path captures malformed rows for inspection.

### Storage

**ClickHouse** holds the `events` table (MergeTree engine, partitioned by day, ordered by `(project_id, event_type, time)` for fast segmentation scans). Property bags are stored as `Map(String, String)` plus typed extraction columns for hot properties. Materialized views maintain rollups (daily active users, event counts) for cheap dashboards.

**Postgres** holds metadata: organizations, projects, users, API keys (write keys and read keys), saved charts, dashboards, and cohort definitions.

### Query engine (`packages/query`)

Pure functions that compile analytics intents into ClickHouse SQL:

- **Segmentation:** event counts and unique users over time, split by property.
- **Funnels:** ordered step conversion with configurable conversion windows, using ClickHouse `windowFunnel`.
- **Retention:** cohort retention curves via `retention()` / array joins.
- **User activity:** per-user event streams for the user lookup view.

The engine is deliberately storage-aware but transport-agnostic, so it is unit-testable without a running database by snapshotting generated SQL.

### Query API (`apps/api`)

Fastify service that authenticates dashboard/read requests, loads chart definitions from Postgres, invokes the query engine, executes against ClickHouse, and returns shaped results for the frontend.

### Dashboard (`apps/web`)

React + Vite single-page app replicating the Amplitude analysis experience: event explorer, chart builder for segmentation/funnels/retention, saved dashboards, user lookup, and cohort management.

### SDKs (`packages/sdk-browser`, later `sdk-node`)

Client libraries that batch events, retry with backoff, persist an offline queue, manage device/session ids, and expose `track` / `identify` / `setGroup`. Wire-compatible with the ingest API.

## Data flow

1. An SDK or HTTP client posts a batch of events to the ingest service.
2. The service authenticates the API key, validates events, enriches them, and buffers.
3. A background flusher writes batches into ClickHouse.
4. The dashboard requests a chart. The query API loads the definition, the query engine compiles SQL, ClickHouse executes, results return to the browser.

## Scaling and deployment

For local development everything runs via `deploy/docker-compose.yml`. For production, each service is a container; ClickHouse and Postgres are managed statefully (single node to start, cluster later). See the roadmap for the self-host milestone.

## Non-goals (for now)

Session replay, experimentation/feature flags, and marketing attribution are out of the initial scope. They are natural later modules once the analytics core is solid.
