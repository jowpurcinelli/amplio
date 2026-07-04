# Amplio Roadmap

Amplio aims to be a full open replacement for Amplitude's analytics core. Work is organized in phases. Each phase ships something usable.

## Phase 0: Foundation (in progress)

- [x] Monorepo scaffold (pnpm workspaces, TypeScript)
- [x] License, README, architecture doc
- [x] Shared event schema package
- [ ] CI (typecheck, test, lint)
- [ ] Maintenance automation (local cron for reviews and dependency checks)

## Phase 1: Ingestion (in progress)

- [ ] Fastify ingest service with Amplitude-compatible `/2/httpapi` and `/batch`
- [ ] Zod validation of the event envelope
- [ ] API-key to project resolution
- [ ] ClickHouse `events` schema and batched writer
- [ ] docker-compose stack (ClickHouse + Postgres)
- [ ] End-to-end local test: curl an event, read it back from ClickHouse

## Phase 2: Query engine and analytics API

- [ ] Segmentation queries (counts, uniques, property splits, time granularity)
- [ ] Funnel analysis (ordered steps, conversion window, drop-off)
- [ ] Retention curves (n-day, unbounded, cohort based)
- [ ] User activity stream
- [ ] Postgres metadata schema (orgs, projects, keys, charts, dashboards, cohorts)
- [ ] Query API service

## Phase 3: SDKs

- [ ] Browser SDK: track, identify, session management, batching, retry, offline queue
- [ ] Autocapture (clicks, pageviews) opt-in
- [ ] Node SDK

## Phase 4: Dashboard

- [ ] Auth and project switching
- [ ] Event explorer
- [ ] Chart builder: segmentation, funnels, retention
- [ ] Saved dashboards
- [ ] User lookup
- [ ] Cohort builder
- [ ] Project settings and API-key management

## Phase 5: Self-host and launch

- [ ] Production docker-compose and one-line installer
- [ ] Docs site
- [ ] Public demo instance (needs server + domain)
- [ ] First tagged release

## Later modules

- Session replay
- Experimentation and feature flags
- Marketing attribution and multi-touch
- Data export and warehouse sync (reverse ETL)
- Alerting and anomaly detection
