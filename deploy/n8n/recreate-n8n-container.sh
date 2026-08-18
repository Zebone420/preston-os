#!/bin/bash
# Canonical n8n container recreation for the dedicated preston-n8n
# host. WHY THIS EXISTS: docker bakes --env-file variables at CREATE
# time; the cloud-init created the container while /etc/n8n.env was
# still empty, and a restart never re-reads the file. Recreation is
# the only way loaded env changes take effect. All n8n data
# (workflows, credentials, users) lives in the /opt/n8n bind mount
# and survives. No workflow is touched or enabled here, and no
# secret values print - only variable NAMES echo for verification.
set -euo pipefail

echo "--- before: N8N_SSOT names visible in container env ---"
docker inspect n8n \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | cut -d= -f1 | grep -E '^N8N_SSOT' || echo "(none)"

docker stop n8n >/dev/null
docker rm n8n >/dev/null
docker create --name n8n --restart unless-stopped \
  -p 127.0.0.1:5678:5678 \
  -v /opt/n8n:/home/node/.n8n \
  --env-file /etc/n8n.env \
  docker.n8n.io/n8nio/n8n:latest >/dev/null
docker start n8n >/dev/null

sleep 10
echo "--- after: N8N_SSOT names visible in container env ---"
docker inspect n8n \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | cut -d= -f1 | grep -E '^N8N_SSOT' | sort
echo "--- bind check (must be 127.0.0.1:5678 only) ---"
docker port n8n
echo "--- healthz ---"
code=000
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    http://127.0.0.1:5678/healthz || true)
  if [ "$code" = "200" ]; then echo "healthz 200"; exit 0; fi
  sleep 5
done
echo "healthz NOT 200 (last=$code)"
exit 1
