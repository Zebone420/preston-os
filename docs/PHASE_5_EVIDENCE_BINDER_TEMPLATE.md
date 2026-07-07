# Phase 5 Remote Drill - Evidence Binder Template

Purpose: where the owner records observations from the Phase 5 remote drill so
the results are auditable. Fill during/after the drill. NO secrets, NO host
names/IPs, NO tokens, NO .env values. Observations are short factual notes and
PASS/FAIL only. Companion: docs/PHASE_5_REMOTE_DRILL_RUNBOOK.md.

## Drill session header

- Drill date (owner fills): __________
- Operator (owner / owner-approved): __________
- Environment: STAGING ONLY (confirm): yes/no
- Preconditions met (SSH fingerprint verified; 8 shutoff flags present): yes/no

## Evidence rows (one per control)

| ID | Control | Action taken | Observation (no secrets) | Result |
|----|---------|--------------|--------------------------|--------|
| D1 | Runner disabled by default | requested run with enable unset | | PASS/FAIL |
| D2 | Enable gate -> dry-run only | double-gated; requested bounded run | | PASS/FAIL |
| D3 | Emergency shutoff halts run | set DISABLE_ALL_AI_WRITES=true mid-run | | PASS/FAIL |
| D4 | Owner stop (laptop closed) | set OWNER_STOP=true, laptop closed | | PASS/FAIL |
| D5 | Max runtime kill | short max_runtime; let it exceed | | PASS/FAIL |
| D6 | Heartbeat stall auto-halt | simulate stall past threshold | | PASS/FAIL |
| D7 | Remote audit rows | review audit surface | | PASS/FAIL |
| D8 | Rollback verified | apply + revert a reversible change | | PASS/FAIL |
| D9 | Review checkpoint | run review over results | | PASS/FAIL |

## Boundary confirmations (all must be "yes")

- No production touched: yes/no
- No live sends (email/SMS/WhatsApp): yes/no
- No live writes (calendar/Drive/Airtable/Supabase): yes/no
- No n8n activation: yes/no
- No secret pasted into repo/chat/binder: yes/no
- Only a bounded dry-run workload was used: yes/no

## Halt log (if any hard stop triggered)

- What happened / which hard stop: __________
- Action taken (halt + audit note): __________

## Owner sign-off

- All D1-D9 PASS: yes/no
- All boundary confirmations "yes": yes/no
- Recommendation: [proceed to Phase 6 closeout | re-run drill | escalate]
- Note: laptop-close-safe is claimed ONLY on all-PASS, and ONLY by the
  owner-approved closeout - never by the AI, never fabricated.
