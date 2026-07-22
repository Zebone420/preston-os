# PHASE 6 - CONSOLIDATED STAGING VALIDATION OWNER GATE
# (single gate; supersedes the A-H checklist in
#  PHASE_6_STAGING_DEPLOYMENT_OWNER_PACKET.md)

Date: 2026-07-21
Prerequisites already DONE by owner: push through the staging-
operational remediation commit (see closeout for the exact hash),
migration 0009 applied + verification passed.
Everything in this gate is owner-run. Claude deploys nothing.
Estimated time: 15-20 minutes. All steps are staging-only,
simulation-only, and reversible.

## Step 0 - Deploy the current commit

1. Confirm Vercel picked up the latest push (project root
   apps/dashboard). In the Vercel deployment details, verify the
   commit hash equals the repo's master head (git log -1 in your
   terminal). If Vercel is on an older commit, redeploy.
   EVIDENCE V0: the commit hash shown by Vercel.
   STOP IF: build fails (capture the log; nothing else to do).

## Step 1 - Auth boundary (2 min)

1. In a signed-out/private browser window, open /business,
   /business/quotes, /business/agents.
   EXPECT: every one redirects to /login. EVIDENCE V1: yes/no.
2. Sign in as owner. Open /business.
   EXPECT: header shows the green "SUPABASE STAGING" badge (NOT
   "SETUP MODE").
   STOP IF: SETUP MODE shows while signed in - env vars are
   missing on the deployment; do not proceed.
3. Click "Sign out" in the /business header nav.
   EXPECT: you land on /login; opening /business now redirects
   back to /login (session ended). Sign in again to continue.
   EVIDENCE V1b: yes/no.

## Step 2 - Empty-state sweep (2 min; skip if fixtures applied)

Open each page: /business, /business/pipeline, /business/quotes,
/business/projects, /business/payments, /business/activity,
/business/agents.
EXPECT: every page renders (no error page); empty states read
"No ... yet"; overview footer says "no business records yet
(nothing to be stale)" when the DB is empty.
EVIDENCE V2: list any page that errors (expected: none).

## Step 3 - First business records via the UI (3 min)

1. /business/quotes -> "Add client" card: add a client (e.g.
   name "Staging Validation Client", type residential).
   EXPECT: green-path message "Client ... added." and the client
   appears in the agent form dropdown.
2. /business/pipeline -> "Add lead": add a lead at stage
   quote_requested. EXPECT: lead appears in its column.
3. Move the lead to another stage with the Move control.
   EXPECT: "Moved to <stage>." and the card changes column.
   EVIDENCE V3: the two success messages.

## Step 4 - Quote-draft agent simulation (5 min)

1. /business/quotes -> agent form: pick the new client, scope
   installation, jurisdiction NYC, one line item: opening "W1",
   description "validation window", qty 2, material 1500,
   labor 500. Submit.
   EXPECT: redirect to the new quote page with SIMULATION badges;
   totals exactly: material $3,000.00, labor $1,000.00, subtotal
   $4,000.00, tax (8.875%) $355.00, total $4,355.00; payment
   schedule deposit $2,177.50 / before_installation $1,088.75 /
   at_completion $1,088.75; status pending_approval.
   EVIDENCE V4a: the totals as shown.
2. Submit the form again with material left EMPTY on the line.
   EXPECT: the form stays filled and shows "Line 1: enter the
   material price in dollars." - your input is NOT lost.
   EVIDENCE V4b: yes/no.
3. /business/agents: EXPECT the completed run (and the failed
   validation run) listed with statuses; safety posture card shows
   execution_enabled false, runner false, hermes observe_only.
   EVIDENCE V4c: posture values shown.
4. /business/activity: EXPECT a quote_draft_created entry with a
   sim tag and a correlation id.

## Step 5 - Approval decision (non-execution proof) (2 min)

1. /approvals: EXPECT the pending row "quote_draft_approval: ..."
   with a "view quote draft" link that opens the quote.
2. Approve it. EXPECT banner "Decision recorded. Nothing was
   executed." and /audit shows approval_decision:approved.
3. Re-open the quote detail. EXPECT approval: approved badge.
   EVIDENCE V5: the banner text + audit row present (yes/no).

## Step 6 - Recommendations + payment fact (2 min)

1. /business -> "Generate recommendations now".
   EXPECT: message "Recommendations: N new, M already known.
   Advice only - nothing was executed." (N may be 0 with minimal
   data - that is a pass; the message itself is the check.)
2. If a project exists (fixtures) record a payment fact on
   /business/payments; otherwise skip.
   EVIDENCE V6: the recommendations message.

## Step 7 - Regression + controls (3 min)

1. Open /, /approvals, /audit, /brief, /os. EXPECT: all render as
   before Phase 6.
2. On /os confirm: execution off, runner off, hermes observe_only,
   and your Phase 5 worker/Hermes timers still show their normal
   staging behavior (no change expected from Phase 6).
   EVIDENCE V7: /os badge states.

## Rollback (if anything fails hard)

Vercel: promote the previous deployment. Nothing in this gate
created irreversible state: business rows are staging simulation
records; the approval decision is a recorded decision only.

## Evidence to return

Reply with V0-V7 (a screenshot or one line each is enough).
PASS = all expectations met. Any deviation: paste the exact
message/URL and stop - do not retry destructive-looking steps
(none exist in this gate, but capture first, retry second).
