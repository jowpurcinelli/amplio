#!/usr/bin/env bash
#
# Amplio maintenance watcher.
#
# Runs health, security, and repo-activity checks and sends João a Telegram
# digest only when something needs a human: failing checks, security
# advisories, or open PRs/issues awaiting review. Otherwise it logs quietly.
#
# Scheduled by com.amplio.maintenance.plist (launchd). Safe to run by hand.

set -uo pipefail

REPO="/Users/jow/oss/amplio"
LOG_DIR="$REPO/.maintenance"
LOG="$LOG_DIR/maintenance.log"
TG="/Users/jow/anjo/scripts/send-telegram.sh"
mkdir -p "$LOG_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >>"$LOG"; }
notify() { [ -x "$TG" ] && "$TG" "$1" >/dev/null 2>&1 || true; }

cd "$REPO" || { log "repo not found"; exit 1; }

log "=== maintenance run start ==="
PROBLEMS=()

# Keep up to date with the remote (external contributions).
git fetch --quiet origin main 2>>"$LOG"
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ]; then
  git pull --quiet --ff-only origin main 2>>"$LOG" && log "pulled $BEHIND new commit(s)"
fi

# Dependencies + health.
if ! pnpm install --frozen-lockfile >>"$LOG" 2>&1; then
  PROBLEMS+=("dependency install failed")
fi
pnpm --filter @amplio/schema build >>"$LOG" 2>&1
if ! pnpm typecheck >>"$LOG" 2>&1; then
  PROBLEMS+=("typecheck failing on main")
fi
if ! pnpm test >>"$LOG" 2>&1; then
  PROBLEMS+=("tests failing on main")
fi

# Security advisories. Only production dependencies can reach a deployed
# artifact, so those page João. Dev-tool advisories (vitest, vite, etc.) are
# logged for awareness but do not alert, since they never ship.
if ! pnpm audit --prod --audit-level=high >>"$LOG" 2>&1; then
  PROBLEMS+=("security: high/critical advisory in a production dependency, run pnpm audit --prod")
fi
pnpm audit --audit-level=high >>"$LOG" 2>&1 || log "dev-dependency advisories present (not shipped), review with pnpm audit"

# Repo activity worth a human's eyes.
if command -v gh >/dev/null 2>&1; then
  OPEN_PRS=$(gh pr list --repo jowpurcinelli/amplio --state open --json number -q 'length' 2>/dev/null || echo 0)
  OPEN_ISSUES=$(gh issue list --repo jowpurcinelli/amplio --state open --json number -q 'length' 2>/dev/null || echo 0)
  [ "${OPEN_PRS:-0}" -gt 0 ] && PROBLEMS+=("$OPEN_PRS open PR(s) awaiting review")
  [ "${OPEN_ISSUES:-0}" -gt 0 ] && log "$OPEN_ISSUES open issue(s)"
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  MSG="Amplio maintenance needs you:"
  for p in "${PROBLEMS[@]}"; do MSG="$MSG"$'\n'"- $p"; done
  MSG="$MSG"$'\n'"Repo: https://github.com/jowpurcinelli/amplio"
  log "ALERT: ${#PROBLEMS[@]} problem(s), notifying"
  notify "$MSG"
else
  log "all green (typecheck, tests, audit clean; no open PRs)"
fi

log "=== maintenance run end ==="
