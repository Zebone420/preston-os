# REMOTE OPERATIONS V1 - STAGE 11 EVIDENCE (CLOSED PASS WITH NOTE)

Date: 2026-08-09. Canonical tip: 6b1e75d. Staging only.

## Verdict

Stage 11 remote-lifecycle drill: CLOSED PASS WITH NOTE.

PROVEN: phone-originated authenticated remote intake -> gateway ->
host consumption -> goal/jobs -> orchestration -> completed goal ->
remote status readable. Laptop not in the execution path.

NOTE: the real bounded execution leg DECLINED to simulation by the
designed fail-closed fallback (root cause below). Real-run proof is
deferred to Stage 11R behind Gate G. Evidence refs are sim:* on both
jobs; executed=false everywhere; no external writes.

## Canonical identifiers (owner-run drill, agent-verified)

- request_id: rops-v1-drill11-12 (accepted -> consumed, reject null)
- goal: dcc6e245-b32d-4de6-aa2f-e5a4800c8d2b (completed)
- job 1 documentation: be945fd9-... completed, attempts=1, sim:* refs
- job 2 verification:  8387ec5d-... completed, attempts=1, sim:* refs
- open_approvals: []

## Agent-verified log evidence (read-only ssh, orchestrator.log)

- disp-129507 event=remote_intake consumed rops-v1-drill11-12 ->
  goal dcc6e245; rejected=[].
- disp-129507 event=capability level_resolved=BOUNDED_CODE_EXECUTION
  executor=composed  (first live positive capability line).
- disp-129507 goal dcc6e245 cycles=1 halted=false reason=completed
  execution_level=BOUNDED_CODE_EXECUTION; 4 parked Phase 7 residue
  goals skipped; known inert action_hash_mismatch residue unchanged.

## Token chain: PASS end to end

owner token -> Vercel route bearer (constant-time) -> 0011 gateway
sha256 re-auth -> intake row -> consumption. Route negative probes
stayed 401 throughout (token-less and wrong-token).

Defect found: 0011 SECURITY DEFINER functions pin
search_path = public while pgcrypto lives in schema extensions, so
digest() failed to resolve at first live RPC (surfaced as 503
unavailable pre-repair). Staging DB repaired by owner. Durable fix
in this commit: both token checks now call extensions.digest(...);
test pin migration-0011.test.ts requires the qualified form (x2).
Optional owner parity step: re-run the two create-or-replace
function blocks from the fixed file in the staging SQL editor.

## Why evidence stayed sim:* (verified root cause)

provisionWorktree must run, as preston-worker:
  git -C /srv/preston-os worktree add /srv/worktrees/wt-<job>
    -b job/<job> <base>
which WRITES .git/worktrees/<id> and a branch ref in the canonical
repo. /srv/preston-os/.git is grann:grann 775: preston-worker has no
write access, and git as a non-owner also hits the dubious-ownership
fatal. The add fails -> executor declines -> driver falls back to
simulation. Fail-closed behavior worked exactly as designed; the
activation path is incomplete (canonical .git metadata write was not
covered by the /srv/worktrees chown in Gate D).

## Next gate: GATE G - host worktree provisioning closure (NOT run)

Owner-run, defined for the packet (do not run yet):
1. Push this evidence + fix; host re-pin to the new tip (clears the
   host-side 0011 hand-patch, removes the two junk untracked files
   and the CL-3 quarantine dir).
2. Shared-group .git metadata write for the service user (group
   preston-repo: grann + preston-worker; chgrp -R on .git only;
   chmod g+rwX + setgid dirs; canonical WORKING TREE stays
   non-writable to the worker).
3. Service-user git trust: safe.directory /srv/preston-os in
   HOME=/var/lib/preston/worker gitconfig.
4. Diagnostic: sudo -u preston-worker git -C /srv/preston-os
   worktree list (must not error), then a throwaway add/remove.
5. Stage 11R: fresh drill request; require real:* evidence refs,
   paths_ok audit ref, worktree created AND removed, lease released.

## Posture at close (agent-verified, unchanged by this stage)

Host pinned 6b1e75d (tree dirty only by the 0011 hand-patch noted
above). Timers: orchestrator enabled; worker + hermes-observe
disabled. worker.env 640 root:preston-worker. /srv/worktrees owned
by service user; only inert wt-5j-* residue. Controls per owner:
execution/remote-runner enabled during drill (capability line is the
proof); owner_stop=false, paused=false. No RLS, credential, flag,
timer, or allowed-path changes made by this stage's commits.

## Validation

Focused suites 51/51 pass (migration-0011, remote-intake,
remote-routes, real-executor, execution-capability). Secret scan and
RED boundary scan clean at commit time (pre-commit hook enforced).
No secret or token value appears in any committed file.
