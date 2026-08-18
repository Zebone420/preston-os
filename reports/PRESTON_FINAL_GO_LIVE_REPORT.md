# PRESTON AI OS — FINAL GO-LIVE REPORT

Author: Claude (unattended closure run). Date: 2026-08-18.
origin/master at write time: 08f1a7a (fetch-verified).
Evidence rule: machine evidence over relays. Values that could not be
re-confirmed live during this run (prod SSH unreachable) are labelled
LAST-VERIFIED with their timestamp, never presented as current.

---

## 1. EXECUTIVE SUMMARY

- Bridge 100%? **No.**
- SSOT 100%? **No.**
- Production-Live 100%? **No.**
- Exact item preventing closure: **preston-agent-prod (46.224.68.139)
  SSH is unreachable.** Its host-level ufw allowlists specific owner
  egress IPs; the laptop's ISP egress IP rotates frequently
  (174.244.145.56 -> 74.101.96.6 within one hour), so no current path
  (direct or via staging) is allowlisted. Every remaining gate
  (n8n live bracket, ChatGPT live read, remote-owner ops, final drill,
  SSOT activation proof) needs a production orchestrator tick or prod
  DB write, both of which require reaching prod. This is an owner-only
  console/allowlisted-machine action.
- Single next action: from an already-allowlisted machine (home
  96.232.230.13 or office 148.75.44.34) OR the Hetzner web console,
  add staging's STATIC IP to prod ufw so the agent can jump via
  staging thereafter regardless of client-IP rotation:
  `ssh root@46.224.68.139 "ufw allow from 168.119.153.173 to any port 22 proto tcp comment 'staging-jump'; ufw status | grep 168.119.153.173"`

The core multi-agent execution stack (P2, Claude, Codex, T-mode,
Hermes H1+H2) is CLOSED PASS with committed evidence. What remains is
integration-proof and activation, all funnelling through the single
prod-reachability blocker.

---

## 2. FINAL PERCENTAGES (no inflation)

| Dimension | % | Basis |
|---|---|---|
| Bridge | 92 | ChatGPT intake + Claude/Codex/Hermes/n8n wired to SSOT; live ChatGPT read + n8n live bracket unproven |
| SSOT | 94 | canonical gateways live; per-read audit fix drafted (0019) unapplied; activation declaration pending |
| Production-Live | 92 | full exec stack live-proven; integrations + final drill pending prod reach |
| P2 | 100 | PRESTON_P2_GATE_REPORT.md |
| Claude | 100 | P2 + T-mode real chain |
| Codex | 100 | PRESTON_CODEX_GATE_REPORT.md (CX-1..CX-5) |
| T-mode | 100 | PRESTON_TMODE_GATE_REPORT.md |
| Hermes H1 | 100 | hermes_h1_20260818.txt |
| Hermes H2 | 100 | hermes_h2_20260818.txt |
| n8n | 80 | host+actor+artifact READY & verified; live bracket blocked on prod |
| ChatGPT live read | 40 | gateway live; audit gap fixed in 0019 (drafted+tested, unapplied); no live read proof |
| Remote owner ops | 15 | packet ready; staging precedent; no prod phone drill |
| Final multi-agent drill | 5 | design understood; not executed |

---

## 3. WHAT COMPLETED WHILE OWNER AWAY

| Item | What / why | Result | Evidence | Commit |
|---|---|---|---|---|
| n8n dedicated host | Created preston-n8n (CPX12, Ubuntu 24.04) per LA-1 REPLACE ruling; cloud-init hardened (localhost-only n8n, ufw deny-except-SSH) | Host live, container up | reports/p2_evidence/n8n_host_20260818.txt | 59eb79c (artifacts) |
| n8n host security verify | Read-only 6-point check via subagent | ALL PASS: 127.0.0.1:5678 only; ufw deny-in except 22; /etc/n8n.env root:root 600; exactly 1 N8N_SSOT_TOKEN; healthz 200 | same file | — |
| n8n-1 registry defect | Provisioning script lacked n8n-1 -> "Unknown actor id" after 0016 | Fixed + 4 parity regression tests | actor-provision-registry.test.ts | f632b35 |
| ChatGPT read-gate audit gap | Design s7 requires per-read audit row; read_ssot_status wrote none | Migration 0019 authored (append-only access_events insert per authenticated read) + 8 static regression tests (pass) | supabase/migrations/0019_ssot_read_audit.sql | 08f1a7a |
| Firewall / access repair | staging cloud-fw + gmail-dev-n8n fw updated with rotated IP (owner-authorized) | staging SSH restored; prod still blocked (host-ufw, no cloud fw) | this report s5/s7 | — |

Reused-and-verified (not re-run): P2, Codex, T-mode, Hermes H1/H2 —
all previously CLOSED PASS; no regression evidence, so not reopened.

---

## 4. WHAT FAILED / NEEDED REPAIR

1. **n8n-1 "Unknown actor id"** — symptom: provisioning threw at
   scripts/p1/p1_actor_provision.ps1:59. Root cause: static actor list
   omitted n8n-1 (0016 widened the DB role CHECK but the script wasn't
   updated). Fix: added n8n-1 (role n8n, enabled=false) + 4 parity
   regression tests. Commit f632b35. RESOLVED (dry-run + later
   real provisioning DB-verified n8n-1 | n8n | t | 64).
2. **read_ssot_status missing per-read audit** — symptom: design s7
   requires an audit row per read; function wrote none. Root cause:
   0013/0017 relied only on resolve_ssot_actor's coarse last_seen_at
   stamp. Fix: 0019 adds one append-only access_events INSERT per
   successful actor-bound read; deliberately does NOT audit pre-auth
   forbidden calls (anon-flood guard - flagged for owner/ChatGPT
   ruling). 8 static tests pass. Commit 08f1a7a. PARTIALLY RESOLVED:
   code done + file-tested; UNVERIFIED against a live DB and NOT yet
   applied (owner psql, staging then prod).
3. **prod SSH unreachable** — symptom: connection timeout to
   46.224.68.139 direct and via staging jump. Root cause: host-ufw IP
   allowlist vs rotating client egress IP; prod has NO Hetzner cloud
   firewall (host-ufw only). NOT resolved - owner-only (see s10).
   Discovery corrected a wrong assumption: firewall-1 (owner-named)
   actually guards legacy gmail-dev-n8n, not prod; prod has no cloud fw.

---

## 5. CURRENT PRODUCTION STATE

| Field | Value | Freshness |
|---|---|---|
| origin/master | 08f1a7a | LIVE (fetch-verified) |
| prod host pin ORCH_BASE_COMMIT | f55e146 | LAST-VERIFIED 2026-08-18 ~repin; not re-confirmable now (prod SSH down) |
| Vercel prod fingerprint | f55e146 (chunk-fingerprint verified) | LAST-VERIFIED this session |
| staging pin | b4f1b71 | LIVE (staging reachable) |
| n8n host | preston-n8n 178.105.10.19, container up, localhost-only | LIVE |
| actor_registry | claude-1/chatgpt-1/owner-remote-1 enabled; codex-1 enabled; hermes-1 per H2; n8n-1 enabled=true | LAST-VERIFIED via psql captures; n8n-1 t confirmed |
| system_controls | execution_enabled t, remote_runner_enabled t, owner_stop f, paused f | LAST-VERIFIED tmode-01 capture 01:29 |
| Hermes mode | production observe_only (H2); staging observe_only (H1) | LAST-VERIFIED hermes_h2 evidence |
| active timers (prod) | zero dispatcher timers (F1); prod hermes-observe timer ENABLED (H2) | LAST-VERIFIED H2 |
| approvals pending | 0 | LAST-VERIFIED tmode-01 |
| dead letters | superseded T-mode/CX-5 fail-closed jobs only (expected) | LAST-VERIFIED tmode-01 |
| worktree status | /srv/worktrees empty | LAST-VERIFIED tmode-01 |

Prod is confirmed POWERED ON and healthy (Hetzner console overview,
this session); only its SSH ingress is IP-filtered against the current
client egress.

---

## 6. BRIDGE / AGENT CONNECTIVITY

| Leg | State |
|---|---|
| ChatGPT -> Preston (intake) | PROVEN (prior PRESTON_CHATGPT_PROD_PROOF path); live SSOT READ not yet proven |
| Claude -> Preston orchestration | PROVEN (P2 + T-mode real execution) |
| Codex -> Preston orchestration | PROVEN (CX gate) |
| Hermes -> SSOT observe | PROVEN (H1 staging + H2 prod, observe-only) |
| n8n -> bounded SSOT gateway | host+actor+artifact READY; live submit/read bracket NOT yet executed |
| SSOT canonical state | live for all proven legs |
| Claude <-> ChatGPT via bridge | NOT established. There is no Claude->ChatGPT channel available to this agent; the SSOT round-trip that would carry it needs prod reach + a ChatGPT-side action. **ChatGPT cannot yet act as coordination authority** — the owner's post-bridge handoff instruction cannot activate this run. |

---

## 7. SECURITY POSTURE

- RLS: intact (no policy touched this run). 0019 adds an append-only
  INSERT inside a SECURITY DEFINER fn; no grant/RLS change.
- Secret isolation: no secret printed/committed/logged this run. New
  n8n token stored host-side only (1 entry, no duplicate, not in the
  workflow export). anon key copied host-to-host via owner `!` (public
  key, name-only echo).
- Credential incidents: prior prod-DB-password chat exposure (earlier
  session) remains ruled compromised + owner-rotated; no new incident.
- Token rotations: n8n-1 token rotated during provisioning (only the
  latest is trusted/installed).
- Firewall changes: staging cloud-fw + gmail-dev-n8n cloud-fw got the
  then-current client IP (owner-authorized append; existing sources
  preserved; no 0.0.0.0/0). These will drift again (dynamic egress).
- staging->prod jump: DESIGNED, not yet established (needs the one prod
  ufw rule in s10). Once set, it is IP-rotation-proof.
- n8n exposure: localhost-only bind + ufw deny-in; no public ingress;
  legacy console left credential-free.
- owner_stop / revocation: intact (per-provider gates, actor disable,
  global owner_stop all proven in CX-5 / T-mode).
- Unresolved warning: dynamic client egress makes any client-IP
  allowlist fragile (post-live backlog: fixed egress / static jump).

---

## 8. EVIDENCE INDEX

Gate reports: reports/PRESTON_P2_GATE_REPORT.md,
PRESTON_CODEX_GATE_REPORT.md, PRESTON_TMODE_GATE_REPORT.md.
Evidence files (reports/p2_evidence/): p2_cx-4-1_*, p2_cx-4-2_*,
p2_tmode-01_20260818_012911.txt, cx4_host_log_20260818.txt,
cx5_host_log_20260818.txt, tmode_host_log_20260818.txt,
hermes_h1_20260818.txt, hermes_h2_20260818.txt,
n8n_host_20260818.txt.
Code/migration: supabase/migrations/0016_actor_role_n8n.sql (applied),
0019_ssot_read_audit.sql (DRAFT), deploy/n8n/*.
Tests: apps/dashboard/test/{tmode-compose-repro, actor-provision-registry,
migration-0019}.test.ts.
Key commits: f55e146, e16db0b, 822f290, 2ae5bce, f632b35, 59eb79c,
08f1a7a (HEAD). Deployment fingerprint: Vercel prod = f55e146.

---

## 9. OWNER ACTIONS — PERFORMED vs REQUIRED

Performed (this run): Hetzner login; firewall IP appends (staging +
gmail-dev-n8n, authorized); migration 0016 apply; n8n-1 provisioning;
n8n host token+env setup; workflow import + disabled/enabled bracket
legs; one prod ufw allow (stale on arrival due to re-rotation).

Avoided via automation: server creation driven by agent in browser;
n8n host verification via subagent; all git/test/evidence work;
read-gate audit authored without owner.

Still required (see s10): the single prod ufw rule for staging's
static IP. After that, the agent completes n8n live bracket, applies
0019 (needs owner psql for the DB apply), and drives remaining gates.

---

## 10. REMAINING BLOCKERS (real, not backlog)

1. **prod SSH ingress** — the one hard blocker. Claude cannot resolve
   it: fixing host-ufw needs prod shell access (chicken-and-egg) or the
   Hetzner web console, both owner-only. Smallest owner action:
   from an allowlisted machine or the console,
   `ssh root@46.224.68.139 "ufw allow from 168.119.153.173 to any port 22 proto tcp comment 'staging-jump'; ufw status | grep 168.119.153.173"`
   Expected: an ALLOW line for 168.119.153.173. Then reply "prod jump
   open" — the agent verifies via staging jump and continues
   unattended.
2. **0019 apply (owner psql)** — after prod reachable, apply
   0019_ssot_read_audit.sql to staging then prod (owner DB password),
   then the agent proves the audited read.
3. **ChatGPT-side live read** — proving ChatGPT reads prod SSOT needs a
   ChatGPT action the agent cannot drive; owner or ChatGPT initiates.

---

## 11. TECHNICAL DEBT / POST-LIVE BACKLOG (do NOT block go-live)

- Dynamic client egress -> adopt fixed egress (WireGuard/Tailscale) or
  make staging the standing jump host; then purge accumulated
  client-IP firewall entries.
- Retire legacy gmail-dev-n8n (now fully replaced, credential-free).
- read_ssot_status forbidden-call auditing (deliberately omitted;
  needs a rate/dedup guard if the gate later demands it).
- npm audit advisories on the n8n/dashboard dep trees (non-blocking).
- Integrations/plugins: Gmail, Calendar, Airtable, Notion, GitHub,
  QuickBooks connectors — all post-live.

---

## 12. OVERNIGHT CHANGELOG (compact)

- Verified origin/master, all hosts; found prod SSH down (IP rotation
  vs host-ufw).
- Subagent: n8n host 6-point security verify -> ALL PASS.
- Diagnosed + fixed n8n-1 provisioning registry gap (f632b35, tests).
- Analysed ChatGPT read gate; found design-s7 per-read audit gap;
  authored 0019 append-only audit + 8 tests (08f1a7a).
- Full matrix: 1325 pass + 1 xfail + 5 known Windows bash-ENOENT
  (env-class, pre-existing); scanners 0/0.
- Wrote n8n host evidence + this report; committed/pushed/fetch-verified.
- Left one owner action (prod ufw staging-jump rule).

---

## 13. FINAL VERDICT

**PRESTON AI OS — NOT YET FULLY LIVE**

- Bridge 92% · SSOT 94% · Production-Live 92%.
- ONE exact next action: add staging's static IP (168.119.153.173) to
  prod's ufw SSH allowlist (owner, from an allowlisted machine or the
  Hetzner console) — command in s10. This restores a rotation-proof
  prod path; the agent then finishes the n8n live bracket, applies
  0019, and drives ChatGPT-read / remote-owner-ops / final-drill /
  SSOT-activation to closure.
