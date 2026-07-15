#!/usr/bin/env bash
# Preston AI OS - remote host preflight health check (Phase 4B.1).
# OWNER-RUN on the staging host, as root. Loads the protected service env file
# and runs the compiled dispatcher's read-only health command AS THE SERVICE
# USER. It performs NO business write, NO execution, and NEVER echoes a secret
# (only var NAMES and a structured pass/fail). Exit 0 = healthy, non-zero = not
# ready.
#
# Usage (as root):  bash deploy/preflight-health.sh
# Prereqs: npm run build:os-runtime has produced dist/os-runtime/bin.js;
#          /etc/preston/runtime.env exists (0600, owned by the service user).

set -u
ENV_FILE="${PRESTON_ENV_FILE:-/etc/preston/worker.env}"
SERVICE_USER="${PRESTON_SERVICE_USER:-preston-worker}"
APP_DIR="${PRESTON_APP_DIR:-/srv/preston-os/apps/dashboard}"
BIN="dist/os-runtime/bin.js"

fail() { echo "PREFLIGHT: FAIL - $1"; exit 1; }

[ -f "$ENV_FILE" ] || fail "env file missing: $ENV_FILE"
# Permissions must be tight (no group/other access).
perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '')"
case "$perms" in 600|400) ;; *) echo "PREFLIGHT: WARN - $ENV_FILE perms=$perms (want 600)";; esac
[ -d "$APP_DIR" ] || fail "app dir missing: $APP_DIR"
[ -f "$APP_DIR/$BIN" ] || fail "dispatcher not built: $APP_DIR/$BIN (run: npm run build:os-runtime)"
command -v node >/dev/null 2>&1 || fail "node not found on PATH"

# Report which required NAMES are present (never their values).
for v in SUPABASE_URL SUPABASE_RUNTIME_KEY SUPABASE_RUNTIME_TOKEN SUPABASE_RUNTIME_REFRESH_TOKEN; do
  if grep -qE "^${v}=" "$ENV_FILE"; then echo "PREFLIGHT: env ${v} present"; fi
done

# Run the AUTHENTICATED read-only db-health command AS THE SERVICE USER, with the
# env loaded in a subshell so secrets never enter this script's environment or
# output. db-health refreshes the session, reads system_controls (read-only),
# refuses a production URL, and writes nothing. Uses runuser (drop privileges) -
# run this whole script as root.
echo "PREFLIGHT: running dispatcher db-health as ${SERVICE_USER} (authenticated, read-only)..."
runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && set -a && . '$ENV_FILE' && set +a && node '$BIN' db-health"
code=$?

# 0 = authenticated read OK; 78 = config gap / prod target refused; other = error.
case "$code" in
  0) echo "PREFLIGHT: PASS - authenticated read-only control-plane connectivity OK"; exit 0;;
  78) fail "config incomplete or production target refused - see names above";;
  *) fail "dispatcher db-health returned $code (auth/connectivity failure)";;
esac
