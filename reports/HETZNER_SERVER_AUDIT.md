# HETZNER SERVER AUDIT

Date: 2026-07-21. Read-only. No server was accessed this session
(SSH is owner-run). This report records known state, zero-local-
reference findings, and the exact read-only command set for the
owner (packet E). No service may be modified during collection.

## Fleet (OWNER-VERIFIED list)

| Server | IP | Size | Location | Known role |
|---|---|---|---|---|
| preston-agent-staging | 168.119.153.173 | CPX22 | Falkenstein | Preston OS staging runtime (Phase 5 proven) |
| gmail-dev-n8n | 188.245.80.146 | CPX22 | Falkenstein | INFERRED host of automation.prestonwd.com |
| ubuntu-4gb-fsn1-2 | 159.69.118.154 | CPX22 | Falkenstein | UNKNOWN (default hostname) |

Local references: only preston-agent-staging appears in repo
docs/runbooks; neither legacy host nor ANY of the three IPs
appears anywhere in the repo (VERIFIED sweep). Deploy files are
host-agnostic.

## 1. preston-agent-staging - RETAIN

- Proven by Phase 5: worker + Hermes timers, reboot recovery,
  laptop-closed operation, /srv/preston-os checkout,
  /srv/worktrees, systemd oneshots, token-store identities.
- Packet E purpose here: BASELINE evidence (service list, ports,
  crontab, disk) so future drift is detectable, and to verify no
  hidden dependency on the two legacy hosts (e.g. /etc/hosts
  entries, cross-host cron, shared storage mounts).
- Do NOT consolidate other services onto it purely for savings -
  it is the isolation boundary for the runtime.

## 2. gmail-dev-n8n - RETAIN short-term; harden; consolidation decision later

- Name suggests it began as a Gmail-automation dev box and now
  (INFERRED) hosts n8n. Packet E confirms: reverse proxy (nginx/
  caddy/traefik), TLS cert domain names, n8n container/service,
  its database (SQLite vs Postgres), volume paths, backup state,
  and any REMNANT Gmail-dev services still running.
- Risks: public automation console (see hygiene plan), "dev"-era
  hardening, unknown patch level, unknown backups of workflow
  data (the n8n DB holds the only copy of the 7 workflows +
  credential store until packet C exports them).
- Disposition path: export workflows (packet C) -> snapshot ->
  harden (updates, firewall, non-dev naming) OR migrate n8n; the
  keep-vs-migrate decision lands in the retirement packet with
  costs. Not a deletion candidate while it serves the domain.

## 3. ubuntu-4gb-fsn1-2 - INVESTIGATE; strongest server retirement candidate

- Default hostname, unknown purpose, zero local references, no
  known DNS pointing at it (packet F checks reverse/forward DNS).
- Packet E must enumerate EVERYTHING on it before any judgment:
  services, containers, ports, crontabs, repos under /srv//opt/
  /home, databases, mounted volumes, last-login history, outbound
  connections.
- Retirement path (only after evidence): full snapshot -> archive
  any repos/data found -> power-off quarantine 14-30 days ->
  verify nothing broke anywhere -> owner-approved deletion of
  server + snapshots per the retirement packet. Cost of keeping
  it during quarantine is one month's fee - never rush this step.

## Packet E - read-only command set (owner-run over SSH)

Run per server; every command is read-only; paste outputs with
any secrets in env FILE PATHS only (the commands print no values):

  hostnamectl; uptime; df -h; free -h
  systemctl list-units --type=service --state=running
  systemctl list-timers --all
  crontab -l; ls /etc/cron.d /etc/cron.daily 2>/dev/null
  docker ps -a 2>/dev/null; docker volume ls 2>/dev/null
  ss -tlnp
  ls /etc/nginx/sites-enabled /etc/caddy 2>/dev/null
  ls /srv /opt /home 2>/dev/null
  last -n 10
  find / -maxdepth 4 -name "*.env" -o -name ".env*" 2>/dev/null
    (paths only - do NOT cat any env file)

Expected outputs and stop conditions are in
reports/OWNER_EVIDENCE_COLLECTION_PACKET.md item E. If any
command errors, skip it and note the error - do not install
anything to satisfy the audit.

## Cost note (ESTIMATES - packet F captures real invoices)

CPX22 list price is roughly EUR 7-9/month each (ESTIMATE; plus
any snapshot/backup surcharges). Three servers ~EUR 21-27/month.
Minimum footprint if both consolidation decisions go maximal:
one server (staging) + n8n either migrated or retired =
EUR 7-9/month, saving roughly EUR 14-18/month (~EUR 170-215/yr)
- CONFIRM against real billing before treating as savings.
