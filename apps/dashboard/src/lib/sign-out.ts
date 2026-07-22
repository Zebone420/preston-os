// Owner sign-out helper. Pure/testable: takes the minimal auth
// surface of the SSR Supabase client and ends the session (the SSR
// client clears its auth cookies as part of signOut). No secrets
// are read, logged, or returned. In setup mode (no client) there
// is no session to end, so sign-out trivially succeeds.

export interface AuthSignOutClient {
  auth: {
    signOut(): Promise<{ error: { message: string } | null }>;
  };
}

export interface SignOutOutcome {
  ok: boolean;
  error?: string;
}

export async function performSignOut(
  client: AuthSignOutClient | null,
): Promise<SignOutOutcome> {
  if (!client) return { ok: true }; // setup mode: nothing to end
  try {
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'sign out failed',
    };
  }
}
