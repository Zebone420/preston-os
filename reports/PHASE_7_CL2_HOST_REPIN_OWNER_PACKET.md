# PHASE 7 - CL-2/2 STAGING HOST RE-PIN OWNER PACKET (TIP = c24a7e5)

Date issued: 2026-08-02 (session continuation)
Supersedes: the CL-2 re-pin shape in PHASE_7_COMPOSER_LIFECYCLE_OWNER_PACKET
(section CL-2) for THIS re-pin only. Go-live packet section 5 remains the
reference shape.

## 0. Pins and preconditions

- TIP  = c24a7e5834e86248e1ba67ad84d7959424472cf4  (master == origin/master)
- PREV = 0c287b09fb17185ec67e55e15c2e09eb87a780ab  (containment rollback)
- Host state last verified (2026-07-30): detached at 641f497 with an
  UNTRUSTED dist/os-runtime/bin.js (built after a FAILED npm ci). This
  packet replaces it with a trusted rebuild at TIP. Do not run any
  dispatcher command before the rebuild completes.
- Lockfile at TIP was validated off-host with the host npm line:
  `npx npm@11.16.0 ci --dry-run` exit 0 (and full `npm ci` exit 0 on
  ZPC26). Step 6 re-proves it on the host before installing.
- KNOWN COSMETIC WARNING at TIP: systemd logs "RuntimeMaxSec= has no
  effect for Type=oneshot" for the three services. Harmless; the real
  bound is TimeoutStartSec=120. A cleanup exists on branch
  phase7/offhost-0802 (509a6b4) and lands at a LATER tip. Do NOT edit
  unit files by hand during this gate.
- Nothing in this packet enables a timer, starts a service, touches
  credentials VALUES, or goes near production.

STOP RULE: any EXPECT line that does not match = STOP, capture the exact
output, change nothing else, report back. Nothing here partially
activates anything; a mid-stop leaves the host inert.

## 1. Identity and pre-state evidence (read-only)

```bash
ssh preston-agent-staging
hostname && whoami && date -u
cd /srv/preston-os
git log --oneline -1 && git status --porcelain=v1 | wc -l
git rev-parse HEAD
```

EXPECT: known staging host; HEAD = 641f497... (or PREV if containment
already ran); dirty count 0. Record all output as evidence E1.
STOP IF dirty count is not 0 (unknown host edits - do not pin over them).

## 2. Timer posture BEFORE (must be disabled x3)

```bash
systemctl is-enabled preston-worker.timer preston-orchestrator.timer \
  preston-hermes-observe.timer
systemctl is-active preston-worker.service preston-orchestrator.service \
  preston-hermes-observe.service
```

EXPECT: three lines `disabled`; three lines `inactive`. Evidence E2.
STOP IF anything is enabled or active.

## 3. Fetch (safe, no checkout yet)

```bash
git fetch origin
git rev-parse --verify c24a7e5834e86248e1ba67ad84d7959424472cf4
```

EXPECT: the second command prints the full TIP hash (commit exists).
Evidence E3. STOP IF unknown revision.

## 4. Pin to TIP (detached checkout; no branch moves, no force)

```bash
git checkout c24a7e5834e86248e1ba67ad84d7959424472cf4
git log --oneline -1 && git status --porcelain=v1 | wc -l
```

EXPECT: HEAD detached at c24a7e5, log line is the emnapi lockfile fix,
dirty count 0. Evidence E4.

## 5. Remove the untrusted build output (bounded to dist/)

```bash
cd /srv/preston-os/apps/dashboard
ls -la dist/os-runtime/bin.js 2>/dev/null
mv dist dist.untrusted.$(date -u +%Y%m%dT%H%M%SZ) 2>/dev/null || true
```

Rationale: the existing bin.js was built after a failed npm ci and is
not trusted. It is MOVED aside (not deleted) so it stays inspectable.
Evidence E5 = the ls output (timestamp of the old artifact).

## 6. Clean install - dry-run proof first, then real

```bash
npm --version
npm ci --dry-run
echo "dry-run exit: $?"
npm ci
echo "ci exit: $?"
```

EXPECT: both exits 0. Evidence E6 (npm version + both exit lines).
STOP IF nonzero: capture the first EUSAGE/resolution error block; this
would mean the lockfile repair is incomplete for the host npm - report
back, do NOT hand-edit the lockfile on the host.

## 7. Build the runtime and validate the artifact

```bash
npm run build:os-runtime
echo "build exit: $?"
ls -la dist/os-runtime/bin.js
node dist/os-runtime/bin.js health; echo "health exit: $?"
```

EXPECT: build exit 0; bin.js present with a fresh UTC timestamp;
health run emits redacted structured JSON and exits 78 when run WITHOUT
the service env (config-absent is the fail-closed success signal here) -
run as your login user, NOT via sudo, so no env file is loaded.
Evidence E7. STOP IF build fails or health exits 70/anything else.

## 8. Env NAMES check + ORCH_BASE_COMMIT update (sudo - owner-only)

```bash
sudo stat -c '%U:%G %a' /etc/preston/worker.env /etc/preston/hermes.env
sudo grep -cE '^ORCH_BASE_COMMIT=' /etc/preston/worker.env
sudo grep -cE '^ORCH_ALLOWED_PATHS=' /etc/preston/worker.env
```

EXPECT: 600 perms, both greps = 1. Then update the pin VALUE (owner
edit, values never echoed to chat):

```bash
sudo sed -i \
 's/^ORCH_BASE_COMMIT=.*/ORCH_BASE_COMMIT=c24a7e5834e86248e1ba67ad84d7959424472cf4/' \
 /etc/preston/worker.env
sudo grep -c 'ORCH_BASE_COMMIT=c24a7e5834e86248e1ba67ad84d7959424472cf4' \
 /etc/preston/worker.env
```

EXPECT: final grep = 1. ORCH_ALLOWED_PATHS stays apps/dashboard/.
Evidence E8 (perm line + the two count outputs only - no values).

## 9. Unit parity (compare only - expect NO diffs at TIP)

```bash
for u in preston-worker.service preston-worker.timer \
         preston-orchestrator.service preston-orchestrator.timer \
         preston-hermes-observe.service preston-hermes-observe.timer; do
  diff -q /etc/systemd/system/$u /srv/preston-os/deploy/systemd/$u; done
```

EXPECT: silence (six identical pairs - unit files did not change between
641f497 and TIP). Evidence E9. IF any diff appears: STOP and report -
do not copy units during this gate.

## 10. Preflight (sudo - owner-only; read-only proof)

```bash
cd /srv/preston-os && sudo bash deploy/preflight-health.sh
echo "preflight exit: $?"
```

EXPECT: `PREFLIGHT: PASS`, exit 0. Exit 78 = env NAME gap - fix names
only, re-run. Evidence E10.

## 11. Timer posture AFTER (must still be disabled x3)

Re-run section 2 verbatim. EXPECT identical output. Evidence E11.
STOP IF anything changed.

## 12. Close-out evidence bundle

Return E1-E11 (raw terminal output). Gate CL-2/2 closes PASS only if:

- E1 clean pre-state recorded
- E2 and E11 identical: 3x disabled, 3x inactive
- E4 HEAD = TIP exactly, clean
- E6 dry-run AND ci exit 0
- E7 build 0, fresh bin.js, health exit 78 (no-env fail-closed)
- E8 perms 600, ORCH_BASE_COMMIT count = 1 at TIP hash
- E9 six silent diffs
- E10 PREFLIGHT: PASS exit 0

FAIL handling: any stop -> containment is `git checkout` PREV
(0c287b09fb17185ec67e55e15c2e09eb87a780ab) + `npm ci` +
`npm run build:os-runtime` (ORCH_BASE_COMMIT then stays at its
pre-packet value only if you also revert step 8 - report first).

After PASS: Claude resumes CL-2/3 onward (read-only ssh checks), then
CL-3.0 preflight P1-P4 and the CL-3 drill family per
PHASE_7_COMPOSER_LIFECYCLE_OWNER_PACKET.
