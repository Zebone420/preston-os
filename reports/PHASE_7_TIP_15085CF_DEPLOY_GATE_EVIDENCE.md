# DEPLOY GATE EVIDENCE - MERGED TIP 15085cf (Blocks 1-3 CLOSED PASS)

Date: 2026-08-04/05 (UTC). TIP = 15085cfa5b3ea7f5e4d53a7d49fb9f7f01117f99
(15-commit ff-merge of phase7/offhost-0802; contains 541b578 approval-PK
fix + 06ce6a4 notice fix + 509a6b4 systemd cleanup + all CL-3 evidence).

## Block 1-2 (owner): push + ff-only merge

ls-remote verified (agent, read-only): origin/master ==
origin/phase7/offhost-0802 == 15085cf... - identical hashes prove a
clean fast-forward; no force, no merge commit.

## Block 3 (Vercel) - CLOSED PASS

Anonymous chain (agent):
- GitHub deployments API: newest Production deployment 5753111535,
  sha 15085cfa5, created 2026-08-04T23:21:44Z, state success,
  deployment URL preston-os-staging-5rwdprk4f-...; nothing newer.
- Alias Link-header: preston-os-staging.vercel.app now serves
  dpl_ETGWgTJyaxoCLU3C4X1DzadFghaG (moved off the c24a7e5-era
  dpl_GDMXCJygBj8UfgM9LQizeCon1oFV).
- /os and /os/composer 307 -> /login (auth gate intact at the new
  deployment).
Owner confirmation (2026-08-05 session): dashboard shows the
alias-holding deployment = commit 15085cf, id dpl_ETGWgTJyaxoCLU3C4
X1DzadFghaG; logged-in /os chips = execution false / remote_runner
false / hermes observe_only.
ROLLBACK POINT: dpl_GDMXCJygBj8UfgM9LQizeCon1oFV at c24a7e5.

## State after this gate

- Vercel: DEPLOYED + owner-verified at 15085cf (contains 541b578).
- Host: STILL at c24a7e5 - Block 4 re-pin pending (expected unit
  diffs on the three .service files; refresh + daemon-reload per the
  issued block; ORCH_BASE_COMMIT -> 15085cf full hash).
- Gate D rerun: still LOCKED until Block 4 proves the host at
  15085cf. Timers 3x disabled / services 3x inactive (unchanged).
