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
- Staging exposure gate (recorded 2026-07-08, deployment governance
  audit): the Vercel production alias (preston-os-staging.vercel.app)
  is publicly reachable on the Hobby plan. Vercel Authentication
  "Standard Protection" is ON but covers previews only; "All
  Deployments" and Password Protection require a paid plan. This is
  acceptable ONLY while the app serves MOCK data with no live env
  vars. HARD PRECONDITION for Phase 1B Stage 4 activation (or setting
  ANY live env var in Vercel, e.g. GOOGLE_READONLY_LIVE_ENABLED,
  SUPABASE_*, AIRTABLE_*): the dashboard must first be gated by
  owner-only login (Supabase auth) or the alias protected (Vercel Pro
  "All Deployments" or Password Protection). Never enable live reads
  while the alias is publicly readable.
- Owner-login gate (Phase 1B, closed 2026-07-08): app-level owner-only
  login is now enforced by apps/dashboard/src/proxy.ts with decisions
  in src/lib/owner-auth.ts (unit-tested). Fail-closed on all axes:
  missing Supabase auth env -> only /login renders (safe setup notice,
  no data, mock included); unauthenticated -> redirect to /login;
  authenticated but not in OWNER_EMAIL_ALLOWLIST -> blocked (missing
  or empty allowlist blocks everyone). This satisfies the staging
  exposure gate's owner-login precondition. Owner action before
  Stage 4: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  and OWNER_EMAIL_ALLOWLIST in Vercel, and create the single owner
  user in Supabase Auth (no signup flow exists). Note: the OAuth
  callback route (/api/google/oauth/callback) is also behind the gate;
  revisit the matcher at Stage 4 activation if the consent flow needs
  it reachable.
