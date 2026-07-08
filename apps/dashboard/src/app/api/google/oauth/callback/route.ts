import { NextResponse } from 'next/server';

// Google OAuth callback - Phase 1B Stage 3 SCAFFOLD (fail-closed).
// This route only exists so the registered staging redirect URI resolves. It
// performs NO token exchange and runs NO consent flow in this gate (no
// refresh-token handling here by design). The owner completes the consent and
// provisions the access token at Stage 4. Until then this responds setup-mode.
// Read-only intent only; nothing here sends, writes, or mutates anything.

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'setup',
      message:
        'Google OAuth callback scaffold. Live read-only access is not activated ' +
        '(Phase 1B Stage 3). Token exchange / consent is performed by the owner ' +
        'at Stage 4; this route does not handle tokens.',
    },
    { status: 503 },
  );
}
