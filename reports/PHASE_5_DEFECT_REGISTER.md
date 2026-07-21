# Phase 5 Defect Register (2026-07-21)

Scope: every defect and audit finding from the Phase 5 program, with
disposition. Severity scale: critical/high/medium/low/info. Disposition:
FIXED (commit), DOC-FIXED (commit), DEFERRED (named gate, rationale),
ACCEPTED (documented rationale), OPEN (owner action named).

## Drill-found defects

| # | Defect | Severity | Disposition |
|---|--------|----------|-------------|
| 1 | /api/os/command duplicate response returned an id matching no stored runtime_command_packets row | high | FIXED 62ad492: store returns the authoritative stored id (lookup by idempotency_key, then id; id-less duplicate if unresolvable); chatgpt route reports null over a fabricated id; regression tests at store/controlplane/chatgpt/submit layers (duplicate-response.test.ts). Architecture audit verified the fix race-safe. Owner re-verify: 5E step 3 + one replay, confirm returned id matches the stored row. |
| 2 | Classifier wording sensitivity (YELLOW vs GREEN near-phrasings) | medium | ACCEPTED AS DESIGNED + pinned 2173600: default-deny is intentional; classifier-contract.test.ts pins the exact drill phrasings, precedence, and the conservative summar-stem quirk; not_green refusal now explains the class and the rephrase path. No gate weakened. |
| 3 | Hermes token.json absent at the doc-assumed path while Hermes authenticates | medium | DOC-FIXED 8a8bf45 + 7ba6063: the store path is whatever SUPABASE_RUNTIME_TOKEN_STORE configures; hermes-loop exit 0 proves a populated store exists under /var/lib/preston/hermes (fail-closed exit 78 otherwise; ProtectSystem=strict confines it). Preflight now prints the configured path. OPEN owner action: run the two grep lines + stat on the resolved paths, archive in binder row D10/R7. Least-privilege intact: separate identities, env files, stores; no service-role key (security audit confirmed). |
| 4 | Laptop-closed phone pause/resume not isolatable in the 45-min journal | medium | OPEN: ruled NOT SUFFICIENT against 5I step 6/7 and the promotion evidencing standard. Smallest supplemental check: ~25-35 min owner phone micro-drill (procedure: closeout report, owner action 2). No full 30-min job drill re-run required. |

## Build/infrastructure defects found this session

| # | Defect | Severity | Disposition |
|---|--------|----------|-------------|
| 5 | Newly-armed pre-commit hook blocked ALL Windows commits: ps1 scanners flagged the bash ports' own pattern definitions (selfNames predated the ports) | high (workflow) | FIXED a1a3cfd: ps1 selfNames now mirror the bash ports' SELF_A-D mutual exclusion. Detection coverage of real code unchanged. FLAGGED FOR OWNER RATIFICATION (guard file edit, parity-only). |

## Independent audit findings (Phase C, six audits, HEAD 8a8bf45)

Blocking-for-closeout findings - all resolved:

| Finding | Severity | Disposition |
|---------|----------|-------------|
| OPS-7: emergency shutoff spec pointed owners at env flags the deployed runtime never reads | high | DOC-FIXED 7ba6063 (GLOBAL KILL SQL + timer stop now primary) |
| OPS-13: dead-letter move documented but not wired | medium | DOC-FIXED 7ba6063 (marked designed-not-wired; wiring = backlog) |
| DOCS-2: superseded env-flag runbook still defined the closeout pass bar | high | DOC-FIXED 7ba6063 (supersession banner; tracker/skeleton bars updated) |
| DOCS-1: ChatGPT connector live trace impossible under standing posture (isHalted couples intake to execution_enabled; cookie-session client carries no session on bearer requests) | critical (doc)/medium (code) | DEFERRED to the connector ACTIVATION gate with the circularity documented in the connector packet sec 9 and the promotion criterion moved there (7ba6063). Fail-closed today; connector disabled by default. |
| DOCS-3: reboot packet stat'd literal token.json paths | high | DOC-FIXED 7ba6063 (resolve configured paths) |
| DOCS-4: 0007 cutover cited nonexistent lettered steps; no mint procedure | high | DOC-FIXED 7ba6063 (citation corrected; owner-run mint outline added) |

Non-blocking findings - dispositions:

| Finding | Severity | Disposition |
|---------|----------|-------------|
| ARCH-2: checkpoint appends not lease-fenced; resolveResume fences by correlation_id only | medium | DEFERRED: benign while simulation-only (executed hard-false); REQUIRED FIX before any execution-enabled RED gate. Recorded as a promotion prerequisite. |
| ARCH low set: insertStagingJob duplicate id asymmetry (masked - enqueue returns no id on duplicate, pinned by test); unique-violation string matching; renew-vs-sweep divergence (no caller); attempts never dead-letter; cancel_requested not re-observed mid-attempt | low | ACCEPTED for staging; dead-letter wiring + cancel re-observation on the backlog. |
| RUN-1: TimeoutStartSec=120 is the enforced oneshot bound; RuntimeMaxSec dead config | medium | DOC-FIXED (5F note; reboot packet sec 8 already correct). Unit-file tidy (raise TimeoutStartSec or drop RuntimeMaxSec) = owner-deployed backlog item. |
| RUN-2: no SuccessExitStatus=75 - paused firings show unit failed | medium | ACCEPTED AS DECISION: pause stays VISIBLE in systemctl --failed; triage section added to 5F packet (7ba6063). |
| RUN-3: rotation-loss window between refresh and store.write | medium | ACCEPTED for staging: fail-closed, loud (exit 78), documented recovery (re-bootstrap); window is milliseconds. |
| RUN low set: no logrotate; LogsDirectory ownership flap; no app-level fetch timeout; stale temp on pid reuse; hermes-vs-worker observability inconsistency on unreadable controls | low | ACCEPTED for staging; logrotate + fetch timeout on the backlog before long-unattended windows. |
| SEC-1: 0007 worker os_jobs UPDATE breadth (approval_state flippable by a compromised worker post-0007) | low | DEFERRED to the 0007 apply gate packet (noted there-in via this register). |
| SEC-5: /api/telegram not excluded from proxy matcher (webhook would redirect to /login) | low | DEFERRED to the Telegram ACTIVATION gate (fail-closed today; activation prerequisite). |
| SEC low set: st.isFile()/owner-uid check on token store; value-shape secret detection; raw DB errors on owner-only surfaces; future-dated telegram messages accepted | low | ACCEPTED for staging; hardening backlog. |
| TEST-F2/F3/F4: route-level auth tests missing; requestJobCancel CAS untested; table-agnostic fakes | medium | FIXED 162dc03 (os-routes-auth, job-cancel-store, non-execution pin, submit duplicate pin). Fake-migration for services/dispatcher tests = backlog. |
| OPS-11: /os shows no heartbeat/last-fired - dead timer invisible from phone | medium | ACCEPTED for closeout; /os last-evidence-row timestamp surface = high-value backlog item. |
| OPS low set: intake routes accept proposals while paused (asymmetry vs connector); kill not reboot-persistent at timer level (disable --now documented); D1-D9 vs D1-D13 numbering; token-recovery wording | low | ACCEPTED/DOC-FIXED where cheap (7ba6063); rest backlog. |

## Open items requiring owner action (consolidated)

1. Archive drill outputs into reports/PHASE_5_EVIDENCE_BINDER.md rows.
2. Run the phone pause/resume micro-drill (5I step 6 supplement).
3. Run the two token-store grep+stat lines; archive (binder D10/R7).
4. Re-verify defect 1 fix live: 5E step 3 + replay id check.
5. Ratify the scanner selfNames parity edit (a1a3cfd).
6. Dated ruling on NEXT_GATES.md open security items (P7).
7. Optional now / required later: apply 0007+0008 at their own gates.
