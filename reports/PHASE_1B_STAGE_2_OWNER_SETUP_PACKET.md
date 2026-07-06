# Phase 1B Stage 2 - Owner External Setup Packet

Status: OWNER ACTION packet. Files-only. The AI does not perform any of these
steps, does not handle secrets, and does not connect to Google. This packet
tells the OWNER exactly what to do out-of-repo, then how to signal completion
so the Stage 3 RED activation subgate can be scoped.

Baseline: repo at addb1ba, mock-only adapter fail-closed, live access blocked.
Authoritative detail: docs/PHASE_1B_GOOGLE_OAUTH_OWNER_ACTIVATION_CHECKLIST.md
(this packet is the ordered runbook; that checklist is the full boundary set).

## Golden rules for this packet

- No secret, token, client secret, or .env value is ever pasted into the repo
  or into chat. The owner keeps them ONLY in Vercel/Google Cloud.
- Read-only scopes only. No send, no write, no Drive, no Maps.
- Staging only. No production.
- Do NOT set GOOGLE_READONLY_LIVE_ENABLED=true yet. That happens later, in
  Stage 3/4, after the live read path is built and approved.

## Owner steps (in order)

### 1. Google Cloud project + consent screen
- [ ] Create or select an internal Google Cloud project for Preston AI.
- [ ] OAuth consent screen = Internal (owner Workspace org only).
- [ ] Publish status appropriate for internal use.

### 2. Scopes (read-only ONLY)
- [ ] Add scope: https://www.googleapis.com/auth/gmail.readonly
- [ ] Add scope: https://www.googleapis.com/auth/calendar.readonly
- [ ] Confirm NO other scope is added (no send/compose/modify/Drive/Maps).

### 3. Enable APIs
- [ ] Enable the Gmail API (read).
- [ ] Enable the Google Calendar API (read).

### 4. OAuth client
- [ ] Create an OAuth 2.0 Client ID, type = Web application.
- [ ] Set the authorized redirect URI to the STAGING callback only, of the form
      https://<staging-host>/api/google/oauth/callback
      (use your real staging host; do not share it here if you prefer - it is
      not required in the repo).

### 5. Store secrets (Vercel staging only)
- [ ] Put the Client ID in Vercel (staging) as GOOGLE_OAUTH_CLIENT_ID.
- [ ] Put the Client Secret in Vercel (staging) as GOOGLE_OAUTH_CLIENT_SECRET.
- [ ] Set GOOGLE_OAUTH_REDIRECT_URI (staging callback) in Vercel.
- [ ] Set GOOGLE_WORKSPACE_READONLY_SCOPES to the two read-only scopes.
- [ ] Leave GOOGLE_READONLY_LIVE_ENABLED unset or false (mock stays on).
- [ ] Do NOT commit any of these values. The repo keeps NAMES only.

### 6. Do not connect yet
- [ ] Do NOT run the consent flow / grant tokens yet. The live read path does
      not exist until Stage 3 is built and approved.

## Owner completion attestation (return this - NO secret values)

Fill in yes/no only. Never include IDs, secrets, tokens, or URLs with tokens.

    STAGE 2 SETUP ATTESTATION
    - Internal OAuth consent screen created (owner org only): yes/no
    - Read-only scopes ONLY (gmail.readonly + calendar.readonly): yes/no
    - Gmail + Calendar read APIs enabled: yes/no
    - OAuth Web client created: yes/no
    - Redirect URI set to a STAGING host only: yes/no
    - Client ID/Secret stored in Vercel staging (NOT in repo/chat): yes/no
    - GOOGLE_READONLY_LIVE_ENABLED still unset/false: yes/no
    - No secret was pasted anywhere outside Vercel/Google Cloud: yes/no

## What the AI does when the attestation returns

- Verifies the attestation is all "yes" and that no secret was shared.
- If any answer is "no" or a secret appears: STOP and remediate first.
- Then proposes the Stage 3 RED activation subgate scope (live read path behind
  the fail-closed flag) for the owner's explicit approval. The AI still never
  handles the secret and never sets the enable flag.

## Stage 3 entry approval wording (owner provides later, verbatim intent)

    "Stage 2 setup is complete and no secret was shared. I approve scoping
     Phase 1B Stage 3: build the live READ-ONLY Gmail/Calendar path behind the
     fail-closed flag, staging only, no send/write/Drive/Maps/production. I will
     set GOOGLE_READONLY_LIVE_ENABLED=true in Vercel staging myself when Stage 4
     validation begins."

## Boundaries held by this packet

No secret handling by the AI. No Google connection. No OAuth activation. No live
read. No env value in the repo. No production. Mock-only adapter unchanged and
fail-closed. This packet is files-only and authorizes nothing by itself.
