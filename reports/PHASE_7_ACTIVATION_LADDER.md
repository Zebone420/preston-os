# PHASE 7 ACTIVATION LADDER

Date: 2026-07-22. Current position: LEVEL 0 (observe-only +
simulation). No level below is activated. Advancing a level is an
owner decision with the listed proof + approval; Claude never
self-advances.

## Level 0 - observe-only and simulation (CURRENT)
- Prereq: none. Proof: 76+ orchestration tests, structural pins,
  scanners 0/0. Owner approval: n/a. Rollback: n/a.
- Prohibited: any real execution/send/push/deploy. Exit: the
  chain closes deterministically in simulation (DONE).

## Level 1 - automated local coding in isolated worktrees
- Prereq: migration 0010 applied (owner); real Claude adapter
  built behind the worktree.ts allowlist + runner.ts executable
  allowlist; sandbox review; per-job path scope enforced.
- Proof: a real bounded worktree job edits only allowed paths,
  runs tests+scanners, produces a LOCAL commit, no push.
- Owner approval: YELLOW gate (staging worktree execution).
- Rollback: discard the worktree; no push occurred.
- Prohibited: push, deploy, network beyond git-local, any RED.
- Exit: N bounded jobs complete with clean evidence.

## Level 2 - automated tests, audits, repairs, local commits
- Prereq: Level 1 proven; repair-loop caps enforced live;
  dead-letter review surface.
- Proof: an owner-approved goal runs decompose->code->test->
  audit->repair->commit with bounded retries, no owner touch
  between routine steps.
- Owner approval: YELLOW. Rollback: revert local commits.
- Prohibited: push/deploy/external. Exit: a multi-job goal closes
  with all quality gates green, locally.

## Level 3 - owner-approved staging push + deploy preparation
- Prereq: Level 2; allowlisted staging branch; artifact-hash
  binding; push is a one-time scoped mobile approval per push.
- Proof: a prepared push packet (branch, hash, diff summary)
  presented for a single owner approval.
- Owner approval: RED (push). Rollback: revert the branch.
- Prohibited: auto-deploy, production. Exit: one owner-approved
  staging push completes.

## Level 4 - owner-approved staging deployment
- Prereq: Level 3; Vercel/host deploy bound to an exact hash;
  smoke-test packet; rollback = promote previous deployment.
- Owner approval: RED (deploy). Prohibited: production. Exit: one
  owner-approved staging deploy + green smoke.

## Level 5 - owner-approved low-risk external actions to test recipients
- Prereq: Level 4; Telegram signed callbacks live; a staging test
  recipient; outbound approval+audit path (master-plan gate).
- Owner approval: RED per action. Prohibited: real customer/
  vendor sends. Exit: one staging test notification proven.

## Level 6 - controlled business pilot
- Prereq: Level 5; production readiness packet (Phase 7 doc);
  provider backups (paid org - currently BLOCKED, no paid org);
  least-privilege identities; RLS review.
- Owner approval: RED, explicit pilot scope. Prohibited:
  unrestricted execution. Exit: a bounded pilot with real data,
  simulation-only agent output, owner-approved sends.

## Level 7 - production candidate
- Prereq: Level 6 exit criteria; full production isolation;
  incident runbook; DR drill. Owner approval: RED, production
  activation. Prohibited: autonomous production execution without
  the standing mobile-approval gates.

## Cross-cutting gates that NEVER auto-clear (mobile approval each)
credential access, service-role, production, live sends, external
writes, invoices/payments, DNS, destructive ops, RLS weakening,
anon grants, execution_enabled=true, remote_runner_enabled=true,
Hermes mode change. Each needs a fresh one-time scoped approval.
