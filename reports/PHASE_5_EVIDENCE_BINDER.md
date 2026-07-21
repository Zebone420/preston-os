# Phase 5 Evidence Binder (INSTANCE, 2026-07-21)

Status: STRUCTURED BACK-FILL. This is the binder instance the promotion
criteria require (a filled binder is precondition 1). Every row states
what evidence EXISTS IN THE REPO today, what the owner REPORTED during
the drill sessions, and exactly what remains to paste. Owner-reported
results are labeled as such and are NOT presented as archived evidence.
No secrets, hostnames, IPs, or token values. Drill set: the
system_controls-surface drills (PHASE_5_CONTROL_RECOVERY_DRILL_PACKET.md
D1-D12) + 5E simulation + 5I laptop-closed job drill + 5J reboot
recovery R1-R7. The env-flag template rows (old D1-D9) are superseded -
see the runbook banner.

## Session header

- Drill dates: 2026-07-19..20 (owner sessions), reconciled 2026-07-21
- Operator: owner
- Environment: STAGING ONLY: yes
- Repo commit under drill: 76c183c; binder compiled at: 162dc03

## Evidence rows

Legend for the Evidence column:
  REPO = archived in repo (file cited). TEST = pinned by a named test
  file. OWNER-REPORTED = owner stated result this session; raw output
  not yet archived. [PASTE] = owner pastes the named artifact here.

| ID | Control | Owner-reported result | Evidence today | To archive |
|----|---------|----------------------|----------------|------------|
| 5E | Staged simulation: command->job->lease->attempt->checkpoint-> observe chain, executed=false | PASS | OWNER-REPORTED; TEST staging-sim.test.ts, synthetic-drill.test.ts | [PASTE] 5E sec-5 SQL block output |
| D1 | Pause halts both loops (75, stoppedReason=halted) | PASS | OWNER-REPORTED; TEST dispatcher.test.ts halt path | [PASTE] journal lines + row counts |
| D2 | Resume restores firings; never enables execution | PASS | OWNER-REPORTED; TEST controlplane.test.ts resume pin | [PASTE] journal line + controls SQL |
| D3 | Owner stop halts next firing; rollback works | PASS | OWNER-REPORTED | [PASTE] journal + controls SQL |
| D4 | Global kill: controls + timers stopped, no processes | PASS | OWNER-REPORTED | [PASTE] list-timers + ps output |
| D5 | Worker manual oneshot x2 SUCCESS | PASS | OWNER-REPORTED | [PASTE] systemctl show lines |
| D6 | Hermes manual oneshot x2 SUCCESS, observe-only | PASS | OWNER-REPORTED | [PASTE] systemctl show lines |
| D7 | Expired-lease takeover, stale token unused, 1 attempt | PASS | OWNER-REPORTED; TEST store-phase5.test.ts takeover | [PASTE] lease/attempt SQL |
| D7b | Stranded-leased sweep recovery | PASS | OWNER-REPORTED; TEST staging-sim.test.ts recovery | [PASTE] recovered=1 log line |
| D8 | Fencing / no duplicate attempt | PASS | OWNER-REPORTED; TEST store.test.ts, store-phase5.test.ts CAS | [PASTE] attempt-count SQL |
| D9 | Checkpoint recovery: requeued complete job skipped | PASS | OWNER-REPORTED; TEST resolveResume matrix | [PASTE] skipped_completed log |
| D10 | Token rotation continuity (worker store mtime) | PASS (worker); Hermes store path discrepancy -> defect 3 | OWNER-REPORTED; REPO defect fix 8a8bf45 (path contract) | [PASTE] resolved store paths + stat lines BOTH identities |
| D11 | Timer restart without service start | PASS | OWNER-REPORTED | [PASTE] list-timers output |
| D12 | Reboot recovery R1-R6 | PASS | OWNER-REPORTED | [PASTE] post-boot journal + preflight |
| D12/R7 | Token stores intact after reboot (both identities) | INCOMPLETE (hermes path assumed token.json - wrong assumption) | REPO correction 7ba6063 | [RE-RUN] R7 with resolved paths, paste stat lines |
| 5I | Laptop-closed >=30min job completion, phone /os visible | PASS (12-step bar minus step 6) | OWNER-REPORTED (~45min journal retained owner-side) | [PASTE] journal excerpt, 2 phone screenshots, step-8 SQL |
| 5I-6 | Phone pause/resume during disconnection | NOT EVIDENCED | none | [RUN] supplemental phone micro-drill (closeout report, owner action 2) |

## Boundary confirmations

- No production touched: yes (owner-reported every session; code gates
  REPO: stagingGate, mentionsProduction, prod-URL refusal + tests)
- No live sends: yes (no send path exists in runtime - code ground truth)
- No live business writes: yes (write inventory: control-plane tables
  only; architecture doc sec 6)
- No n8n activation: yes
- No secret in repo/chat/binder: yes (scanners 0 findings at 162dc03)
- Simulation-only workload: yes (executed=false pinned by tests +
  structural non-execution pin test/non-execution-pin.test.ts)

## Defects found by the drills (all tracked in the defect register)

1. Duplicate command-response id — FIXED 62ad492, regression-tested.
2. Classifier wording sensitivity — ruled intentional, pinned 2173600.
3. Hermes token-store path discrepancy — doc contract fixed 8a8bf45;
   one owner stat to archive.
4. Phone pause/resume evidence gap — supplemental micro-drill required.

## Owner sign-off (to complete)

- All rows above archived or re-run as marked: yes/no
- All boundary confirmations remain "yes": yes/no
- Recommendation: [close Phase 5 | re-run items | escalate]
- Laptop-close-safe is claimed only by the owner-approved closeout.
