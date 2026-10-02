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
