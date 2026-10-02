"""Verify an isolated, already restored restic snapshot. Never connect to live databases."""
import argparse, io, json, re, subprocess, tarfile, time
from pathlib import Path
from uuid import uuid4

parser = argparse.ArgumentParser()
parser.add_argument('--restore-root', required=True, type=Path)
parser.add_argument('--metadata-dump', required=True, type=Path)
parser.add_argument('--app-uuid', required=True)
args = parser.parse_args()
base = args.restore_root.resolve()
dump = args.metadata_dump.resolve()
assert base in dump.parents and dump.is_file(), 'Dump must be inside isolated restore root'
assert re.fullmatch('[a-zA-Z0-9]+', args.app_uuid), 'Invalid app UUID'
state = base / 'var/lib/nellia/amplio-backup'
marker = (state / 'active-snapshot').read_text().splitlines()
snapshot = marker[1]
assert re.fullmatch('nellia_restic_[0-9TZ_]+', snapshot), 'Invalid snapshot marker'
tables = marker[2:]
assert tables and set(tables) <= {'events', 'replay_events'}, 'Invalid snapshot tables'
names = ['nel369-actual-ch-' + uuid4().hex[:10], 'nel369-actual-pg-' + uuid4().hex[:10]]

def run(command, data=None):
    result = subprocess.run(command, input=data, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('Scratch restore command failed, exit code ' + str(result.returncode))
    return result.stdout.decode().strip()

def ch(sql):
    return run(['docker', 'exec', names[0], 'clickhouse-client', '--multiquery', '--query', sql])

try:
    for image in ['clickhouse/clickhouse-server:24.8', 'postgres:16']:
        run(['docker', 'image', 'inspect', image])  # Do not install or pull implicitly.
    run(['docker', 'run', '--rm', '-d', '--name', names[0], '--network', 'none', '--tmpfs', '/var/lib/clickhouse', 'clickhouse/clickhouse-server:24.8'])
    run(['docker', 'run', '--rm', '-d', '--name', names[1], '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=amplio', '-e', 'POSTGRES_DB=amplio', 'postgres:16'])
    for name, command in [(names[0], ['clickhouse-client', '--query', 'SELECT 1']), (names[1], ['pg_isready', '-h', '127.0.0.1', '-U', 'amplio', '-d', 'amplio'])]:
        for attempt in range(30):
            try:
                run(['docker', 'exec', name] + command)
                break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('Scratch database did not become ready')
    run(['docker', 'exec', '-i', names[1], 'pg_restore', '-U', 'amplio', '-d', 'amplio', '--no-owner', '--exit-on-error'], dump.read_bytes())
    metadata = run(['docker', 'exec', names[1], 'psql', '-U', 'amplio', '-d', 'amplio', '-At', '-c', 'SELECT (SELECT count(*) FROM projects),(SELECT count(*) FROM api_keys);'])
    ch('CREATE DATABASE amplio')
    counts = {}
    frozen = base / ('var/lib/docker/volumes/' + args.app_uuid + '_clickhouse-data/_data/shadow/' + snapshot)
    for table in tables:
        ddl = (state / snapshot / (table + '.sql')).read_text()
        source_uuid = (state / snapshot / (table + '.uuid')).read_text().strip()
        assert re.fullmatch('[0-9a-f-]{36}', source_uuid), 'Invalid captured table UUID'
        ch(ddl)
        parts = [p.parent for p in frozen.rglob('checksums.txt') if source_uuid in p.parts] if frozen.exists() else []
        detached = ch("SELECT data_paths[1] FROM system.tables WHERE database='amplio' AND name='" + table + "'") + 'detached'
        run(['docker', 'exec', names[0], 'mkdir', '-p', detached])
        expected = 0
        partitions = set()
        for part in parts:
            assert re.fullmatch('[a-zA-Z0-9_]+', part.name), 'Invalid part name'
            expected += int((part / 'count.txt').read_text())
            partitions.add(part.name.split('_')[0])
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w') as archive:
                archive.add(part, arcname=part.name)
            run(['docker', 'exec', '-i', names[0], 'tar', '-C', detached, '-xf', '-'], buffer.getvalue())
        run(['docker', 'exec', '-u', 'root', names[0], 'chown', '-R', 'clickhouse:clickhouse', detached])
        for partition in partitions:
            ch("ALTER TABLE amplio." + table + " ATTACH PARTITION ID '" + partition + "'")
        actual = int(ch('SELECT count() FROM amplio.' + table))
        assert actual == expected, 'Restored rows differ from frozen part metadata'
        counts[table] = {'rows': actual, 'parts': len(parts)}
    print(json.dumps({'metadataProjectAndKeyCounts': metadata, 'restoredTables': counts, 'scratchOnly': True}))
finally:
    for name in names:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)
