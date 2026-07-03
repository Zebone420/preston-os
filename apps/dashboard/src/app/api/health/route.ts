import { NextResponse } from 'next/server';

// Read-only health endpoint. Reports whether the app is in setup mode
// (no Supabase env) or connected. Exposes no values, only booleans.
export function GET() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return NextResponse.json({
    ok: true,
    mode: configured ? 'connected' : 'setup',
  });
}
