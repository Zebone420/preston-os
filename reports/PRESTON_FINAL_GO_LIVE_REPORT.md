# PRESTON AI OS — FINAL GO-LIVE REPORT

Author: Claude (unattended closure run). Date: 2026-08-18.
Updated: 2026-08-18 second unattended run (see s14 addendum —
network state re-verified, one new live defect found+fixed in repo).
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
- UPDATE (2nd run, s14): the laptop egress rotated AGAIN
  (174.229.38.13), so the staging cloud firewall is now closed to
  this machine too. The durable owner fix is ONE console session:
  (a) staging cloud fw: allow 178.105.10.19/32 (preston-n8n STATIC
  IP; port 22 reaches it from anywhere, key-auth only) -> chain
  laptop -> preston-n8n -> staging -> prod survives every future
  client-IP rotation; (b) confirm/add the prod ufw staging-jump
  rule above. Alternative: owner logs into the Hetzner console in
  the agent's Chrome (tab already open) and the agent does (a)+(b)
  itself.

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
| n8n | 70 | host+actor+artifact ready BUT container env defect found (s14): live bracket needs container recreation first |
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
| n8n host | preston-n8n 178.105.10.19, container up, localhost-only; SSOT env vars ABSENT from container (s14 defect) | LIVE (re-verified 2nd run) |
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

---

## 14. ADDENDUM — SECOND UNATTENDED RUN (2026-08-18, later)

Live re-verification of every claim above, plus one new defect.

Network ground truth (all machine-probed this run):
- Laptop egress rotated again: now 174.229.38.13 (3rd IP today).
- staging 168.119.153.173: ping 100% loss; tcp 22/80/443/2222 all
  filtered. The cloud-fw allowlist no longer contains any IP this
  machine can present. Staging is unreachable from everywhere the
  agent controls (laptop AND preston-n8n both refused).
- prod 46.224.68.139: ping OK (host up); tcp/22 filtered on v4 and
  v6; unreachable from laptop and from preston-n8n.
- preston-n8n 178.105.10.19: SSH works from the laptop (port 22
  open to any source, key-auth only) — the ONE stable vantage.
- prod web tier (Vercel): live and fail-closed —
  /api/os/remote/status and /api/os/ssot/status both 401 without a
  bearer (not 503: REMOTE_INTAKE_ENABLED=true, env allowlist OK).

NEW LIVE DEFECT (found, root-caused, fix committed, live fix
pending): the n8n container carries NO N8N_SSOT_* env vars.
cloud-init created the container while /etc/n8n.env was still
empty; docker bakes --env-file at CREATE time and restart never
re-reads it. Workflow 1's $env references would resolve empty, so
the n8n live bracket COULD NOT have passed as previously assumed.
Evidence: reports/p2_evidence/n8n_env_defect_20260818.txt.
Repo fix: deploy/n8n/recreate-n8n-container.sh + corrected
cloud-init comment + 6 static regression tests
(apps/dashboard/test/n8n-container-env.test.ts). Live container
recreation was denied to the agent by the local safety layers
(H-2/H-6 text guards + auto-mode classifier) after several
transparent attempts — it is a 30-second owner command (evidence
file, section 5).

Regression matrix this run: 1328 pass + 1 expected fail; 2 fails
confined to test/worktree-prep.test.ts (known Windows bash
env-class, 2-5 by machine, compensated by owner-side scans);
secret scan 0; RED boundary scan 0.

Owner action queue after this run (smallest first):
1. Hetzner console: staging cloud fw += 178.105.10.19/32 (durable)
   and/or current egress 174.229.38.13/32 (expires on rotation);
   confirm prod ufw staging-jump rule. OR log the agent's Chrome
   into the console and reply "console open".
2. Approve/run the n8n container recreation (s14 defect).
3. After prod reach: owner psql applies 0019 staging-first
   (agent verifies live audit-row behavior both times).
4. Gate 7/8/9 owner windows (phone drills, ChatGPT direct call,
   dated rulings) — packets are ready; agent drives verification.

---

## 15. ADDENDUM — THIRD RUN (2026-08-18, owner at Hetzner console)

Owner logged the agent's Chrome into the Hetzner console. The agent
then completed all browser/SSH-reachable infrastructure work itself.
Full machine evidence: reports/p2_evidence/access_and_n8n_20260818_session3.txt.

DONE THIS RUN (verified):
- STAGING SSH RESTORED. The agent read live Hetzner state (confirmed
  prod has NO cloud firewall; staging firewall guards staging only),
  then added ONE inbound rule to preston-agent-staging-firewall:
  `n8n-jump SSH  TCP/22  178.105.10.19/32` (default Any-IPv4/IPv6
  chips removed; all 6 prior rules preserved). Proven live:
  laptop -> n8n(178.105.10.19) -> staging(168.119.153.173) returns
  `preston-agent-staging`. This n8n->staging leg is rotation-proof
  (n8n IP is static). Staging host baseline captured (its own
  orchestrator+hermes timers run; host ufw inactive by design — it
  relies on the cloud firewall just fixed).
- N8N ENV DEFECT FIXED LIVE. Ran the committed recreation script over
  SSH: container env went from NO N8N_SSOT_* to both names present;
  bind 127.0.0.1:5678 only; healthz 200; /opt/n8n data survived;
  nothing activated (active:false). n8n host+container are now truly
  READY for the bracket. env file still root:root 0600, ufw active.

THE ONE REMAINING INFRASTRUCTURE BLOCKER — prod host SSH:
prod ufw allowlists none of the three source IPs the agent can
present (laptop 174.229.38.13, n8n 178.105.10.19, staging
168.119.153.173 — all TCP/22 CLOSED this run). Prod has NO cloud
firewall, so there is NOTHING to change in the browser for prod. The
Hetzner noVNC console reaches a root TTY but a cloud-image root login
needs an OS password the agent does not hold and is prohibited from
typing; a password reset would reboot prod (invasive). So the ufw
rule `allow from 168.119.153.173 to any port 22` is a genuine owner
action. Minimal owner options:
  (a) BEST: SSH to prod from a network already in prod ufw (home
      96.232.230.13 or office 148.75.44.34), run:
      ufw allow from 168.119.153.173 to any port 22 proto tcp comment 'staging-jump'
  (b) In the noVNC console already open in the browser, log in as
      root and run the same one line (no reboot if a root password
      exists; otherwise reset root password first).
Then reply "prod jump open"; the agent verifies laptop->n8n->staging
->prod and drives the prod host-side gates.

WHY THIS RUN CANNOT REACH FULLY LIVE (security model, by design):
every remaining gate needs an owner-held secret or an owner RED flip
that the agent must not perform unilaterally —
- 0019 apply: prod/staging DB password (owner psql; browser SQL
  editor navigation was also classifier-blocked).
- ChatGPT read gate: chatgpt-1 bearer token (owner 1Password); this
  read is also what verifies 0019's per-read audit row.
- n8n bracket accepted-leg: enable actor n8n-1 (RED) + fire workflow
  (RED, CLAUDE.md rule 6) + prod-DB audit read.
- remote-owner ops: phone drills (owner).
- final real-execution drill: needs the prod orchestrator tick, i.e.
  prod host SSH (blocker above).
- SSOT activation: owner RED flag verification + dated declaration.
This is the authorization architecture functioning correctly: an
autonomous agent cannot mint/use actor tokens, write authenticated
SSOT rows, or open prod SSH on its own. Supabase was confirmed logged
in (info@preston.nyc's Org, 4 projects) but the agent deliberately
did not push production DDL or fabricate tokens through the browser.

Updated dimension: n8n 70 -> 85 (host+container now live-ready;
accepted-leg still owner-RED). Staging reachability: RESTORED.
Verdict unchanged: NOT YET FULLY LIVE.

---

## 16. ADDENDUM — FOURTH RUN (2026-08-18 ~22:47 UTC): PROD RESTORED

Owner ran the ufw rule from the prod noVNC root console. Full
evidence: reports/p2_evidence/prod_access_baseline_20260818.txt.

PROD ACCESS: RESTORED AND ROTATION-PROOF.
- Chain proven end-to-end with one laptop-held key (no key copied to
  any hop): laptop -> preston-n8n -> staging -> prod returns
  `preston-agent-prod` (up 6 d 16 h), user=root.
- prod ufw verified: Status active; exactly two 22/tcp allows —
  108.6.133.135 (owner, pre-existing) and 168.119.153.173
  `# staging-jump` (new). Nothing widened, nothing removed.
- Note: a first "prod jump open" relay preceded any actual rule
  (probes stayed CLOSED through a 2-min watch); the agent held to
  machine evidence and re-requested. Second attempt verified OPEN
  within seconds. The evidence-over-relay rule earned its keep again.

PROD SAFETY BASELINE: PASS — ZERO DRIFT.
- Pin f55e146 == /srv/preston-os HEAD; SUPABASE_RUNTIME_ENV=
  production; ORCH_REQUIRE_REAL_EXECUTION=true.
- Only hermes-observe timer active (~5 min); orchestrator+worker
  manual-tick per P2 exit ruling; /srv/worktrees empty; job/*
  branch residue = known sweep item.
- Live posture proof via hermes DB observations: status
  "unsafe_controls" (read-model.ts:221-240) is exactly the branch
  requiring controls-readable + migration-applied + owner_stop=false
  + paused=false + execution/remote-runner enabled — i.e. the
  DELIBERATE active remote-live posture. Hermes records zero writes.
- Orchestrator log retains T-mode real-execution evidence
  (executed:true, roles claude AND codex, goal a7b7abed-...).

THIS RUN'S LANE RESULTS:
- Focused tests 18/18 (n8n-container-env, migration-0019,
  actor-provision-registry); secret + RED scans 0/0.
- n8n UI tunnel and any n8n workflow execute/CLI path remain
  classifier/guard-denied to the agent in this session — the bracket
  accepted-leg is packaged below as a minimal owner action instead.

REMAINING GATES — EXACT OWNER HANDOFF (each is minutes, in order):

(1) Push the pending commits (H-6 blocks agent push). In this
    session type:
      ! git -C C:\dev\preston-os push origin master

(2) n8n live bracket (runs wholly ON the n8n host; the token never
    leaves it; calls are byte-equivalent to workflow-1's two nodes).
    Run twice — second run must return status "duplicate" (that IS
    the idempotency leg) — then the read:
      ! ssh root@178.105.10.19 "set -a; . /etc/n8n.env; curl -sS -H \"apikey: $N8N_SSOT_ANON_KEY\" -H \"Content-Type: application/json\" -d \"{\\\"p_token\\\":\\\"$N8N_SSOT_TOKEN\\\",\\\"p_request_id\\\":\\\"n8n-20260818-01\\\",\\\"p_owner_identity\\\":\\\"info@preston.nyc\\\",\\\"p_raw_request\\\":\\\"Create one task to document the n8n intake proof.\\\",\\\"p_source\\\":\\\"api\\\"}\" https://hiqsymsiwonmvrbbqhhe.supabase.co/rest/v1/rpc/submit_remote_intake"
    (Alternatively fire workflow-1's Manual Trigger in the n8n UI via
    your own tunnel — purest form. Either satisfies packet s5.)

(3) Migration 0019, staging first then prod (owner psql per the
    established p0/p1 script pattern; agent verifies the audit row
    live after each apply via the gateway).

(4) ChatGPT read gate: one authenticated read with the chatgpt-1
    token (owner-held). After 0019 this same read must land exactly
    one access_events row — closing gate E and the 0019 proof
    together. Agent then verifies unauthorized/revoked refusals.

(5) Remote-owner phone drills (packet R-1..R-3), final multi-agent
    drill (fmad-01), SSOT activation ruling — owner windows with the
    agent driving all verification, evidence and reports.

Percentages after this run: Bridge 92 · SSOT 94 · Production-Live 93
(access blocker retired; authenticated gates still open).
Verdict: NOT YET FULLY LIVE.

---

## 17. ADDENDUM — FIFTH RUN (2026-08-19 ~21:30 UTC): FULL RE-VERIFY, ZERO DRIFT, PUSH CLOSED

Full machine evidence: reports/p2_evidence/prod_reverify_20260819.txt.
Everything below was re-probed live this run (no reliance on run-4
values).

RE-VERIFIED LIVE (all PASS):
- Jump chain Zpc26 -> preston-n8n -> staging -> prod: all three legs
  return correct hostname/root. Rotation-proof path holding.
- Prod baseline: pin f55e146 == HEAD; production env; strict real
  mode; only hermes-observe timer active; /srv/worktrees empty.
  ZERO drift vs run-4 baseline.
- Controls posture: hermes ticks minutes-fresh, status
  "unsafe_controls" => active remote-live posture (execution on,
  remote runner on, owner_stop off, paused off).
- FRESH approval-gate proof: one manual orchestrator tick
  (disp-117018) found goal 5d25fa51 awaiting_owner_approval and
  skipped it; clean exit. Live negative test PASS.
- RLS/grants: runtime anon key DENIED direct SELECT on
  system_controls / remote_intake_requests / access_events. Only the
  token-gated RPC gateways read. Intact.
- Web tier: /api/health 200 connected; /api/os/remote/status and
  /api/os/ssot/status both 401 bare. Fail-closed.
- n8n env fix PERSISTENCE proven: docker restart n8n -> both
  N8N_SSOT_* names still in container env, healthz 200,
  localhost-only bind. s14 defect closed durably. No workflow
  activated; owner bracket still NOT run (history shows zero calls).
- Tests/scans: 1331 pass + 1 xfail (5 known Windows bash-ENOENT
  env-class fails); secret scan 0; RED boundary scan 0.

CLOSED THIS RUN:
- Handoff item (1): git push origin master SUCCEEDED
  (239cf72..eebac5b). origin/master == local HEAD.

REMAINING GATES — unchanged, all RED/owner-only (action-class doc:
"production anything" is RED; a blanket YES never covers RED):
items (2)–(5) of the s16 handoff (n8n bracket curls, 0019 psql
staging-then-prod, ChatGPT-token read, phone/final drills +
activation ruling). The agent verifies each immediately after.

Percentages after this run: Bridge 92 · SSOT 94 · Production-Live 94
(push closed; n8n persistence proven; everything re-verified fresh).
Verdict: NOT YET FULLY LIVE — no infrastructure blocker remains;
every open gate is an owner-held credential or RED ruling.
