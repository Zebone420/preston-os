# context/ — Verified Facts Only

Seeding rules (binding):

1. Only owner-verified facts enter this folder.
2. No disputed facts. Anything in the Verification Register
   (docs/PRESTON_AI_VERIFICATION_REGISTER_v1.md) stays out until ruled.
3. No secrets. Ever. Names of env vars are allowed; values are not.
4. No client-facing use of unverified facts.
5. Every entry carries: the fact, source, verification date, decider.
6. New disputed or conflicting facts discovered during the build receive a
   V-number in the Verification Register instead of entering context/.

This folder is empty until the Gate 0A-5 owner verification session.
