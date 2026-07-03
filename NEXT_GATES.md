# NEXT GATES - Parking Lot

New ideas and deferred designs. The active plan is frozen; items here
wait for a future owner-approved gate.

- Telegram Stage 2: APPROVE/DENY replies. Requires inbound handler
  (webhook or polling), signed approval linkage, and a fresh injection
  defense review. Stage 1 is notification-only by hardcoded design.
- Airtable corrections (after rulings): 25/25/50 payment policy fix;
  1.08876 tax multiplier fix; CC-fee formula after V3 ruling; markup
  placeholder after V4 ruling.
- CLAUDE.md: update the outdated line saying the master plan is
  local/untracked (it is committed at 1878120).
- V5-V7 verification session; V9 re-verify at Phase 4 entry.
- GitHub Actions CI: lint + guard tests on every push.
- Supabase RLS tightening: replace staging-permissive policies with
  owner-only auth policies once the owner user exists (0B session).
- npm audit: 2 moderate advisories in dashboard dependency tree to
  review (no --force fixes without approval).
