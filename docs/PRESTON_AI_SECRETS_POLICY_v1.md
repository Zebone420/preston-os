# PRESTON AI SECRETS POLICY v1

Status: Phase 0A document. Binding for all phases.

## Core Rule

The AI builder sees environment variable NAMES only, never values.
Code references process.env.NAME. Humans set values at the storage layer.

## Forbidden Locations (no real secret, ever)

- Markdown files.
- Chat prompts.
- Git commits.
- Logs.
- Public docs.
- AI-visible reports.
- Screenshots.
- Context files.
- Test fixtures.
- Error messages.
- The access_events.credential_name column (names only).

## Allowed Storage Locations

- 1Password vault.
- Supabase secrets.
- Vercel environment variables.
- Hetzner server .env outside the repo.
- n8n credential store.
- GitHub Actions secrets.
- Local encrypted secret manager.

## Handling Rules

1. The AI never asks the owner to paste a secret into chat. If a value is
   needed somewhere, the AI provides instructions and the owner sets it
   directly at the storage layer.
2. If a secret is ever pasted into chat or a file by accident: immediate
   RED stop, owner rotates that credential, incident note in reports/,
   secret scan re-run.
3. Secret-shaped strings found in any input (email content, Airtable
   fields, logs) are flagged, never echoed.
4. env.template carries names and comments only. A local .env file is
   gitignored and owner-managed; the AI never creates or reads it.
5. No master credential. Scoped credentials per system per environment.

## Rotation and Revocation

- Rotation cadence: quarterly, or immediately on suspected exposure.
- Single-system revocation: rotate that credential at the provider.
- Global kill: set DISABLE_ALL_AI_WRITES=true in every environment, then
  rotate all credentials.
- Invariant: revocation must never require the AI's cooperation.
