#!/bin/sh
set -eu

: "${LETTA_APP_SERVER_TOKEN:?LETTA_APP_SERVER_TOKEN is required}"

PORT_VALUE="${PORT:-4500}"
TOKEN_FILE="/tmp/letta-app-server-token"

umask 077
printf '%s' "$LETTA_APP_SERVER_TOKEN" > "$TOKEN_FILE"
mkdir -p /root/.letta /workspace

exec letta server \
  --backend local \
  --listen "ws://0.0.0.0:${PORT_VALUE}" \
  --ws-auth capability-token \
  --ws-token-file "$TOKEN_FILE" \
  --openai-api
