#!/usr/bin/env bash
#
# Amplio one-command deploy (self-hosted).
#
#   ./deploy/deploy.sh [domain]
#
# On first run it creates deploy/.env from deploy/.env.prod.example, filling the
# secret fields with fresh random values, then builds and starts the full stack
# (Caddy + web + api + ingest + ClickHouse + Postgres) and waits for the API to
# report healthy. It never overwrites an existing deploy/.env, so re-running just
# rebuilds and restarts with your current config.
#
# Dependencies: bash, docker (with the compose plugin), openssl, curl.

set -euo pipefail

# --- Locate the repo regardless of where this is invoked from ----------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/deploy/.env"
EXAMPLE_FILE="$REPO_ROOT/deploy/.env.prod.example"

EXAMPLE_DOMAIN="amplio.example.com"
HEALTH_TIMEOUT=120   # seconds to wait for the API to come up
HEALTH_INTERVAL=3    # seconds between health polls

# Optional first argument overrides AMPLIO_DOMAIN in a freshly created .env.
DOMAIN_ARG="${1:-}"

# --- Small helpers -----------------------------------------------------------
log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# Portable in-place edit: replace a whole KEY=... line. Uses a temp file so we
# do not depend on GNU vs BSD 'sed -i' differences. The '|' delimiter keeps
# domains and hex tokens (no '|' in them) from clashing with the pattern.
set_env() {
  key="$1"; value="$2"; file="$3"
  tmp="$file.tmp.$$"
  sed "s|^${key}=.*|${key}=${value}|" "$file" >"$tmp"
  mv "$tmp" "$file"
}

# Read a KEY's value back from an env file (last match wins).
get_env() {
  key="$1"; file="$2"
  sed -n "s|^${key}=\(.*\)$|\1|p" "$file" | tail -n 1
}

# --- Preflight ---------------------------------------------------------------
need docker
need openssl
need curl
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is required (docker compose v2)"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
[ -f "$EXAMPLE_FILE" ] || die "env template not found: $EXAMPLE_FILE"

# --- Create deploy/.env on first run (idempotent) ----------------------------
if [ -f "$ENV_FILE" ]; then
  log "Using existing deploy/.env (leaving it untouched)."
else
  log "First run: creating deploy/.env from the template with fresh secrets."
  # Preserve the template's own permissions but tighten to owner-only.
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  set_env "CLICKHOUSE_PASSWORD" "$(openssl rand -hex 32)" "$ENV_FILE"
  set_env "POSTGRES_PASSWORD"   "$(openssl rand -hex 32)" "$ENV_FILE"
  set_env "SESSION_SECRET"      "$(openssl rand -hex 32)" "$ENV_FILE"

  # API keys: token:project pairs. Generate memorable prefixes for a single
  # default project so the SDK quick-start works immediately.
  WRITE_KEY="amp_wr_$(openssl rand -hex 24)"
  READ_KEY="amp_rd_$(openssl rand -hex 24)"
  set_env "AMPLIO_WRITE_KEYS" "${WRITE_KEY}:default-project" "$ENV_FILE"
  set_env "AMPLIO_READ_KEYS"  "${READ_KEY}:default-project"  "$ENV_FILE"

  if [ -n "$DOMAIN_ARG" ]; then
    set_env "AMPLIO_DOMAIN" "$DOMAIN_ARG" "$ENV_FILE"
    log "Set AMPLIO_DOMAIN=$DOMAIN_ARG"
  fi

  log "Wrote deploy/.env. Generated write/read API keys for 'default-project':"
  printf '    write: %s\n' "$WRITE_KEY"
  printf '    read:  %s\n' "$READ_KEY"
fi

# --- Domain sanity check -----------------------------------------------------
DOMAIN="$(get_env "AMPLIO_DOMAIN" "$ENV_FILE")"
[ -n "$DOMAIN" ] || DOMAIN="localhost"

if [ "$DOMAIN" = "$EXAMPLE_DOMAIN" ]; then
  warn "AMPLIO_DOMAIN is still the placeholder '$EXAMPLE_DOMAIN'."
  warn "Automatic HTTPS will not work until you edit deploy/.env and set your real domain"
  warn "(or pass one: ./deploy/deploy.sh yourdomain.com on a clean install), then re-run."
fi

# --- Build and start ---------------------------------------------------------
log "Building images and starting the stack (this can take a few minutes on a cold build)."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# --- Wait for the API to report healthy --------------------------------------
# The API port is not published on the host, so we check it from inside the
# running container with Node (guaranteed present in the image). This is
# independent of DNS and TLS provisioning, which may still be settling.
log "Waiting for the API to become healthy (up to ${HEALTH_TIMEOUT}s)..."

health_check() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api \
    node -e 'const http=require("http");http.get("http://127.0.0.1:8788/health",r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{process.exit(JSON.parse(d).status==="ok"?0:1)}catch(e){process.exit(1)}});}).on("error",()=>process.exit(1));' \
    >/dev/null 2>&1
}

deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if health_check; then
    healthy=1
    break
  fi
  printf '.'
  sleep "$HEALTH_INTERVAL"
done
printf '\n'

if [ "$healthy" -ne 1 ]; then
  warn "The API did not report healthy within ${HEALTH_TIMEOUT}s."
  warn "Check the logs:  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f api"
  exit 1
fi

log "API is healthy. Amplio is up."

# --- Print the dashboard URL + next steps ------------------------------------
if [ "$DOMAIN" = "localhost" ]; then
  DASHBOARD_URL="https://localhost"
else
  DASHBOARD_URL="https://$DOMAIN"
fi

cat <<EOF

  Amplio is running.

  Dashboard:  $DASHBOARD_URL
  Ingest:     $DASHBOARD_URL/2/httpapi   (Amplitude HTTP V2 compatible)

  Next steps:
    1. Point your DNS: create an A/AAAA record for '$DOMAIN' at this server's public IP.
       (Caddy provisions a Let's Encrypt certificate automatically once DNS resolves.)
    2. If AMPLIO_DOMAIN is not yet your real domain, edit deploy/.env, set it, and re-run
       'make deploy' to reload the reverse proxy.
    3. Open $DASHBOARD_URL and create your first account.
    4. Your API keys live in deploy/.env (AMPLIO_WRITE_KEYS / AMPLIO_READ_KEYS). Keep them secret.

  Manage the stack:
    make logs     tail service logs
    make ps       show container status
    make down     stop the stack

EOF
