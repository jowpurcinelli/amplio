"""Bounded ephemeral Postgres proof, using an already-present image. No persistent volume."""
import json, os, subprocess, tempfile, time
from pathlib import Path
from uuid import uuid4
root = Path(__file__).resolve().parents[1]
name = "nel369-pg-proof-" + uuid4().hex[:10]
restore_name = name + "-restore"
image = "postgres:16-alpine"
def run(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30, **kw)
run(["docker", "image", "inspect", image])  # Never download an image for this proof.
try:
    run(["docker", "run", "--rm", "-d", "--name", name,
         "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=amplio", "-e", "POSTGRES_USER=amplio", image])
    for attempt in range(15):
        try:
            run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "amplio", "-d", "amplio"])
            break
        except subprocess.CalledProcessError:
            time.sleep(1)
    else:
        raise RuntimeError("Ephemeral Postgres did not become ready")
    run(["docker", "exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "amplio", "-d", "amplio"], input=(root / "deploy/postgres/init.sql").read_text())
    def scalar(sql):
        return run(["docker", "exec", name, "psql", "-At", "-U", "amplio", "-d", "amplio", "-c", sql]).stdout.strip()
    assert scalar("SELECT count(*) FROM api_keys") == "0", "Production schema must never seed development credentials"
    port = run(["docker", "port", name, "5432/tcp"]).stdout.strip().split(":")[-1]
    env = dict(os.environ, DATABASE_URL=f"postgres://amplio@127.0.0.1:{port}/amplio")
    with tempfile.TemporaryDirectory(prefix="nel369-provision-") as scratch:
        scratch = Path(scratch)
        manifest = {"organization": {"id": str(uuid4()), "name": "Isolated test tenant"}, "projects": [
            {"id": str(uuid4()), "name": "Test site", "tenantId": "fixture-tenant", "surfaceId": "fixture-site"},
            {"id": str(uuid4()), "name": "Test app", "tenantId": "fixture-tenant", "surfaceId": "fixture-app"}]}
        path = scratch / "manifest.json"
        path.write_text(json.dumps(manifest))
        def provision(output):
            return run(["node", str(root / "scripts/provision-activity-projects.mjs"), str(path), str(output)], env=env)
        first = scratch / "first.json"
        result = provision(first)
        assert "amp_rd_" not in result.stdout and "amp_wr_" not in result.stdout
        assert first.stat().st_mode & 0o777 == 0o600
        second = scratch / "second.json"
        provision(second)
        assert json.loads(first.read_text()) == json.loads(second.read_text()), "Retry must reuse project credentials"
        assert scalar("SELECT count(*) FROM projects") == "2"
        assert scalar("SELECT count(*) FROM api_keys") == "4"
        assert scalar("SELECT count(*) FROM api_keys WHERE key IN ('dev-key','dev-read-key')") == "0"
        # A failing output creation must roll back a new project.
        manifest["projects"].append({"id": str(uuid4()), "name": "Rollback test", "tenantId": "fixture-tenant", "surfaceId": "fixture-rollback"})
        path.write_text(json.dumps(manifest))
        try:
            provision(first)
            raise AssertionError("Existing private output must not be overwritten")
        except subprocess.CalledProcessError:
            pass
        assert scalar("SELECT count(*) FROM projects") == "2"
        assert scalar("SELECT count(*) FROM api_keys") == "4"
    dump = subprocess.run(["docker", "exec", name, "pg_dump", "-Fc", "-U", "amplio", "-d", "amplio"], check=True, capture_output=True, timeout=30).stdout
    run(["docker", "run", "--rm", "-d", "--name", restore_name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=amplio", "-e", "POSTGRES_USER=amplio", image])
    for attempt in range(15):
        try:
            run(["docker", "exec", restore_name, "pg_isready", "-h", "127.0.0.1", "-U", "amplio", "-d", "amplio"])
            break
        except subprocess.CalledProcessError:
            time.sleep(1)
    else:
        raise RuntimeError("Restore Postgres did not become ready")
    subprocess.run(["docker", "exec", "-i", restore_name, "pg_restore", "--clean", "--if-exists", "--no-owner", "-U", "amplio", "-d", "amplio"], input=dump, check=True, capture_output=True, timeout=30)
    restored = run(["docker", "exec", restore_name, "psql", "-At", "-U", "amplio", "-d", "amplio", "-c",
                    "SELECT (SELECT count(*) FROM projects),(SELECT count(*) FROM api_keys),(SELECT count(*) FROM api_keys WHERE key IN ('dev-key','dev-read-key'))"]).stdout.strip()
    assert restored == "2|4|0"
    print("PASS: production schema no demo keys; two isolated projects; private output mode; retry reuses keys; output failure rolls back creation; pg_dump/pg_restore reproduced 2 projects and 4 scoped credentials without secret output")
finally:
    subprocess.run(["docker", "rm", "-f", name, restore_name], capture_output=True, timeout=30)
