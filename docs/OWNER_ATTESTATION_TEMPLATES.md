# Owner Attestation Templates (pass/fail only - NO secrets)

Purpose: standard forms the owner returns to signal that an out-of-repo,
owner-run step is complete. RULES for every attestation:
- Answer yes/no or PASS/FAIL only. Never paste an ID, secret, token, URL with a
  token, phone number, or host detail.
- If any answer is "no"/FAIL, do not proceed; the AI records it and helps fix.
- These attestations are evidence records, not authorizations to send/write.

## A. Phase 1B Stage 2 - Google OAuth setup attestation

Source: reports/PHASE_1B_STAGE_2_OWNER_SETUP_PACKET.md

    STAGE 2 SETUP ATTESTATION
    - Internal OAuth consent screen created (owner org only): yes/no
    - Read-only scopes ONLY (gmail.readonly + calendar.readonly): yes/no
    - Gmail + Calendar read APIs enabled: yes/no
    - OAuth Web client created: yes/no
    - Redirect URI set to a STAGING host only: yes/no
    - Client ID/Secret stored in Vercel staging (NOT in repo/chat): yes/no
    - GOOGLE_READONLY_LIVE_ENABLED still unset/false: yes/no
    - No secret was pasted anywhere outside Vercel/Google Cloud: yes/no

Pass = all "yes". Then the AI proposes the Stage 3 RED activation scope.

## B. Phase 1B Stage 3/4 - live read-only activation attestation

    STAGE 3/4 ACTIVATION ATTESTATION
    - Live path built behind the fail-closed flag (mock still default): yes/no
    - Verified against the OWNER's own account only: yes/no
    - Scopes confirmed read-only (no send/write/Drive/Maps): yes/no
    - Staging only; no production: yes/no
    - External content still neutralized on the live path: yes/no
    - No send/write path became reachable: yes/no
    - Owner set GOOGLE_READONLY_LIVE_ENABLED=true in STAGING personally: yes/no
    - No secret shared in repo/chat: yes/no

## C. Phase 5 - remote drill attestation

Source: docs/PHASE_5_REMOTE_DRILL_RUNBOOK.md

    PHASE 5 DRILL ATTESTATION
    - D1 runner disabled by default: PASS/FAIL
    - D2 enable gate -> dry-run only: PASS/FAIL
    - D3 emergency shutoff halts run: PASS/FAIL
    - D4 owner stop with laptop closed: PASS/FAIL
    - D5 max runtime kill: PASS/FAIL
    - D6 heartbeat stall auto-halt: PASS/FAIL
    - D7 remote audit rows (append-only, secret-free): PASS/FAIL
    - D8 rollback verified: PASS/FAIL
    - D9 review checkpoint: PASS/FAIL
    - No production, no live sends/writes, no secret shared: yes/no

Pass = all PASS + final "yes". Only then may remote-live readiness be recorded
(and laptop-close-safe considered - by the owner-approved closeout, not by the AI).

## D. SSH fingerprint verification attestation (precondition for Phase 5)

Source: docs/PRESTON_AI_SSH_ACCESS_SPEC_v1.md

    SSH FINGERPRINT ATTESTATION
    - known_hosts fingerprint matches the Hetzner console: yes/no
    - Non-root owner-approved user confirmed: yes/no
    - No StrictHostKeyChecking bypass used: yes/no

## What the AI does with a returned attestation

- Verifies completeness and that no secret was shared.
- Drafts the matching gate report + updates reports/MILESTONE_100_TRACKER.md.
- Never sets flags, handles secrets, connects to hosts, or runs drills itself.
