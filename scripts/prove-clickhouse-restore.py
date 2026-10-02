"""Official ClickHouse 24.8 FREEZE/restore proof with ephemeral QA data only."""
import io, json, os, re, shutil, subprocess, tarfile, tempfile, time
from pathlib import Path
from uuid import uuid4
root = Path(__file__).resolve().parents[1]
image = 'clickhouse/clickhouse-server:24.8'
name = 'nel369-ch-restore-' + uuid4().hex[:10]
containers = [name + '-source', name + '-target']
hook_state = Path(tempfile.mkdtemp(prefix='nel369-hook-state-'))
def run(args, **kw):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, **kw)
    if result.returncode: raise RuntimeError(result.stderr[:1500])
    return result
run(['docker', 'image', 'inspect', image])
def query(container, sql):
    return run(['docker', 'exec', container, 'clickhouse-client', '--multiquery', '--query', sql]).stdout.strip()
try:
    for container in containers:
        run(['docker', 'run', '--rm', '-d', '--name', container, '--network', 'none',
             '--tmpfs', '/var/lib/clickhouse', image])
        for attempt in range(20):
            try:
                query(container, 'SELECT 1')
                break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('Scratch ClickHouse did not become ready')
    source, target = containers
    code = (root / 'apps/ingest/src/clickhouse.ts').read_text()
    ddl = re.search(r'CREATE TABLE IF NOT EXISTS \$\{database\}\.events[\s\S]*?SETTINGS index_granularity = 8192', code).group().replace('${database}.events', 'amplio.events')
    query(source, 'CREATE DATABASE amplio; ' + ddl)
    query(source, "INSERT INTO amplio.events(project_id,event_type,user_id,time_ms,server_received_time_ms) VALUES ('qa-a','page_view','qa-user-a',1000,1000),('qa-b','page_view','qa-user-b',2000,2000)")
    hook_env = dict(os.environ, AMPLIO_CLICKHOUSE_CONTAINER=source, AMPLIO_BACKUP_STATE_DIR=str(hook_state))
    run(['bash', str(root / 'scripts/amplio-restic-hook.sh'), 'before'], env=hook_env)
    snapshot_name = (hook_state / 'active-snapshot').read_text().splitlines()[1]
    saved_ddl = (hook_state / snapshot_name / 'events.sql').read_text()
    query(target, 'CREATE DATABASE amplio; ' + saved_ddl)
    # Mutation after FREEZE proves that restoration uses the frozen point, not a later live copy.
    query(source, "INSERT INTO amplio.events(project_id,event_type,user_id,time_ms,server_received_time_ms) VALUES ('qa-a','page_view','qa-user-c',3000,3000)")
    assert query(source, 'SELECT count() FROM amplio.events') == '3'
    with tempfile.TemporaryDirectory(prefix='nel369-frozen-') as temporary:
        snapshot = Path(temporary) / 'snapshot'
        snapshot.mkdir()
        archive = subprocess.run(['docker', 'exec', source, 'tar', '-C', '/var/lib/clickhouse/shadow/' + snapshot_name, '-cf', '-', '.'], capture_output=True, check=True, timeout=30).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as extracted:
            extracted.extractall(snapshot, filter='data')
        parts = [p.parent for p in snapshot.rglob('checksums.txt')]
        assert len(parts) == 1, 'Fixture must produce one frozen table part'
        data_path = query(target, "SELECT data_paths[1] FROM system.tables WHERE database='amplio' AND name='events'")
        detached = data_path + 'detached'
        run(['docker', 'exec', target, 'mkdir', '-p', detached])
        for part in parts:
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w') as archive:
                archive.add(part, arcname=part.name)
            subprocess.run(['docker', 'exec', '-i', target, 'tar', '-C', detached, '-xf', '-'], input=buffer.getvalue(), check=True, capture_output=True, timeout=30)
        run(['docker', 'exec', '-u', 'root', target, 'chown', '-R', 'clickhouse:clickhouse', detached])
        query(target, "ALTER TABLE amplio.events ATTACH PARTITION ID '19700101'")
        assert query(target, 'SELECT count(),uniqExact(project_id),uniqExact(user_id) FROM amplio.events') == '2\t2\t2'
        assert query(target, 'SELECT max(time_ms) FROM amplio.events') == '2000'
        compiled = json.loads(run(['node', '--input-type=module', '--eval',
            "import { buildActivity } from './packages/query/dist/index.js'; console.log(JSON.stringify(buildActivity({projectId:'qa-a',range:{from:0,to:4000},recentFrom:0,pageViewEvent:'page_view'})))"], cwd=root).stdout)
        args = ['docker', 'exec', target, 'clickhouse-client', '--database', 'amplio', '--query', compiled['sql'] + ' FORMAT JSONEachRow']
        args += ['--param_' + key + '=' + str(value) for key, value in compiled['params'].items()]
        aggregate = json.loads(run(args).stdout)
        assert int(aggregate['identified_users']) == 1 and int(aggregate['page_views']) == 1
        assert int(aggregate['last_received_at']) == 1000 and int(aggregate['observed_events']) == 1
    run(['bash', str(root / 'scripts/amplio-restic-hook.sh'), 'cleanup'], env=hook_env)
    assert not (hook_state / 'active-snapshot').exists()
    print('PASS: official ClickHouse 24.8 FREEZE restored exactly 2 QA events across 2 isolated projects; later source mutation excluded; no host ports or persistent volumes')
finally:
    for container in containers:
        subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=30)
    shutil.rmtree(hook_state)
