-- Amplio metadata schema (Postgres).
-- Holds everything that is relational: orgs, projects, API keys, saved charts,
-- dashboards, cohort definitions. Event data lives in ClickHouse, not here.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'write' keys ingest events; 'read' keys drive the dashboard/query API.
  kind        TEXT NOT NULL CHECK (kind IN ('write', 'read')),
  key         TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);

CREATE TABLE IF NOT EXISTS charts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- 'segmentation' | 'funnel' | 'retention'
  kind        TEXT NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charts_project_idx ON charts(project_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  layout      JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dashboards_project_idx ON dashboards(project_id);

CREATE TABLE IF NOT EXISTS cohorts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cohorts_project_idx ON cohorts(project_id);

CREATE TABLE IF NOT EXISTS flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  -- percent of users the flag is on for when it has no variants
  rollout     INT NOT NULL DEFAULT 0,
  -- weighted variants for multivariate flags; empty array = boolean flag
  variants    JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS flags_project_idx ON flags(project_id);

-- Local development seed: a demo org, project, and the default dev API key so
-- the ingest quick-start works out of the box.
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Org')
ON CONFLICT DO NOTHING;

INSERT INTO projects (id, org_id, name)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'dev-project')
ON CONFLICT DO NOTHING;

INSERT INTO api_keys (project_id, kind, key, label)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'write', 'dev-key', 'Local dev write key'),
  ('00000000-0000-0000-0000-0000000000a1', 'read', 'dev-read-key', 'Local dev read key')
ON CONFLICT DO NOTHING;
