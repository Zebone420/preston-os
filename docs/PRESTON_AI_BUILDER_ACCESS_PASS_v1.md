# PRESTON AI BUILDER ACCESS PASS v1

Status: Phase 0A document. No credentials are created or connected by
this document. Controlling plan: Master Plan v2.1, Section 6.

## 1. Purpose

Give Claude/Codex controlled access to the systems needed to build the
Business Powerstation without creating a dangerous master password.
Rule: no single unlimited master credential. Instead:
scoped credentials + server-side secrets + approvals + logs +
emergency shutoff.

## 2. Systems Included

- Supabase (staging first).
- Airtable TEST/DEV (production read-only in a later phase).
- Vercel.
- GitHub repository.
- Hetzner staging server.
- n8n inactive workflows only.
- Obsidian/context repo.
- Google Workspace OAuth app (read-only scopes first).
- Gmail read-only.
- Calendar read-only.
- Google Maps restricted API key.
- Twilio/Telnyx placeholders first, live only after Phase 4 RED gate.
- Google Drive read-only indexing later.
- Dashboard deployment pipeline.

## 3. Systems Excluded

- Airtable production writes.
- Live messaging providers before Phase 4.
- Payment systems.
- DNS / domain registrar.
- Root server access.
- Owner personal accounts.

## 4. Credential Storage Policy

See docs/PRESTON_AI_SECRETS_POLICY_v1.md. Summary: real values live
only in 1Password, Supabase secrets, Vercel env vars, Hetzner server
.env outside the repo, n8n credential store, or GitHub secrets. The AI
sees environment variable names only, never values.

## 5. Access Matrix

Levels: L1 read-only / L2 draft / L3 approved write / L4 production.

| System | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| Supabase | 0A-5 | 0B | 0B staging | Phase 4 |
| Airtable | 0B TEST/DEV | Phase 1 | Phase 2 TEST | Phase 4 |
| GitHub | 0A-5 | 0A-5 | n/a | n/a |
| Vercel | 0B | 0B | 0B staging | Phase 4 |
| Gmail/Calendar | Phase 1 | Phase 1 | Phase 4 | Phase 4 RED |
| n8n | Phase 3 | Phase 3 | Phase 3 | Phase 4 RED |
| Hetzner SSH | Phase 3/4 | n/a | Phase 4 | never root |
| Twilio/Telnyx | n/a | Phase 3 | n/a | Phase 4 RED |

Level meanings per system: L1 inspect/read only; L2 create drafts,
code changes, commits, reports; L3 approved writes to TEST/staging
surfaces; L4 controlled production actions behind a RED gate.

## 6. Environment Boundaries

Environments: test_dev, staging, production. Every command packet
carries its environment. Production is unreachable except at L4 with
an explicit owner-approved RED gate and explicit confirmation.

## 7. Approval Levels

- L1 (GREEN): logged automatically, no approval needed.
- L2 (GREEN drafts): logged, drafts only, nothing leaves the system.
- L3 (YELLOW): requires an approval record decided by the owner.
- L4 (RED): requires owner approval with explicit confirmation.
- The owner is the only approver until roles are delegated in Phase 4.

## 8. Emergency Shutoff Variables

Defined in docs/PRESTON_AI_EMERGENCY_SHUTOFF_SPEC_v1.md. All eight
DISABLE_* flags must exist and read true (blocked) before any live
connector is configured. Missing flag = blocked (fail-closed).

## 9. Claude/Codex Allowed Actions

The GREEN action list in the Action Classes summary inside
docs/PRESTON_AI_PHASE_0A_FOUNDATION_GATE.md, plus YELLOW actions
specifically named in the active gate scope.

## 10. Forbidden Actions

The RED action list in the Action Classes summary inside
docs/PRESTON_AI_PHASE_0A_FOUNDATION_GATE.md, verbatim, without
exception. No build mode may override it.

## 11. Owner Setup Checklist

For each system, the owner (never the AI):
1. Creates the scoped token/credential at the provider.
2. Stores it per the Secrets Policy.
3. Tells the AI only the environment variable name that is now set.

## 12. Revocation and Rotation

- Single system: rotate that credential at the provider.
- Global kill: set DISABLE_ALL_AI_WRITES=true everywhere, then rotate
  all credentials.
- Rotation cadence: quarterly, or immediately on suspected exposure.
- Invariant: revocation never requires the AI's cooperation or
  availability.

## Exit Gate for this Pass

PASS requires: access matrix complete; secrets stored outside repo;
AI sees names not values; read-only connector test passes (Phase 0B);
owner can revoke; emergency shutoff documented; no secrets exposed;
no production writes; no live messages or emails sent.
