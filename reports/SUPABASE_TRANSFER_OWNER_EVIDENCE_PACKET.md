# SUPABASE TRANSFER - OWNER EVIDENCE PACKET (Gate 0)
#
# STATUS: COLLECTED 2026-07-22 (read-only, in-dashboard). RESULT:
# BLOCKED - no paid organization exists. Answers recorded inline
# below. Nothing was transferred, changed, or confirmed.
#
# Answers (sanitized):
# 1. Paid organization name: NONE - only "info@preston.nyc's Org"
#    (Free Plan) exists.
# 2. Its plan: Free Plan (no paid org present).
# 3. Role in paid org: N/A (none exists).
# 4. Role in current Free org: Owner (sole member).
# 5. Transfer control visible: YES (Project Settings -> General).
# 6. Dialog text quoted: "You do not have any organizations you
#    can transfer your project to." Advisory items: "Possible
#    downtime - There might be a short downtime when transferring
#    projects from a paid to a free organization."; "Permissions
#    - Depending on your role in the target organization, your
#    level of permissions may change after transfer."; "Features
#    - Moving your project to an organization with a smaller
#    subscription plan may result in the loss of certain features
#    (i.e. image transformations)." Transfer button DISABLED.
# 7. Estimated monthly cost: none shown (no target org).
# 8. Supabase GitHub integration active: NO ("Connect GitHub").
# 9. Vercel integration installed: NO ("Install Vercel
#    integration") - env vars are manual, as documented.
# 10. Log drains configured: NO (Pro+ feature; Free shows
#     upgrade prompt).
# 11. Storage buckets: 0 (no buckets; File storage 0 GB / 1 GB).
# 12. Target org projects/headroom: N/A (no target org). Source
#     Free org holds 3 projects; usage: DB 29 MB / 500 MB,
#     egress 14 MB / 5 GB, MAU 4 / 50,000.
# Security note: account MFA shows Disabled on the team page
#   (recorded in the credential hygiene register).
#
# Original blank packet retained below for reference.

Date: 2026-07-22. Read-only dashboard observation, ~5 minutes.
Share sanitized facts only - NO keys, passwords, connection
strings, tokens, card data, or billing addresses. Change nothing;
click "Transfer project" ONLY far enough to READ its preview -
do not confirm anything.

Answer these:

1. Paid organization name (as shown):
2. Its plan name (Pro / Team / other):
3. Your role in that organization (Owner / Admin / Member /...):
4. Your role in the CURRENT (Free) org holding
   preston-os-staging (must be Owner for transfer):
5. In preston-os-staging -> Project Settings -> General: is a
   "Transfer project" control visible? (yes/no)
6. Open it (read only): quote any warning or eligibility text it
   shows, especially anything about GitHub integration,
   project-scoped roles, log drains, compute, or cost:
7. Does it show an estimated monthly cost after transfer? Amount:
8. Is any Supabase GitHub integration active on this project?
   (Settings -> Integrations) yes/no:
9. Is the Vercel integration installed for this project (vs env
   vars having been set manually)? yes/no:
10. Any log drains configured? (expect no on Free) yes/no:
11. Storage: number of buckets shown (expect 0):
12. Target org: current number of projects and (if visible)
    remaining compute credit headroom:

Stop conditions: do not press any confirming button; if the
dialog demands a plan change or shows a blocker, capture the
wording and close it.

How this is used: answers 1-4 establish eligibility; 5-6,8,10
clear the documented blockers; 7 and 12 set the real cost line;
9 and 11 close the integration/storage unknowns in the impact
matrix. A clean packet flips the decision brief from CONDITIONAL
to GO and unlocks Gates 1-7 in the pre-transfer plan.
