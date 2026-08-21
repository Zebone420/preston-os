import { redirect } from 'next/navigation';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { evaluateConsent, validAuthorizationId } from '@/lib/preston-control/consent';
import { getServerSupabase } from '@/lib/supabase/server';
import { approveConsent, denyConsent } from './actions';

// Preston Control - OAuth 2.1 consent page. The Supabase Auth OAuth server
// sends the browser here (authorization path) with ?authorization_id=...;
// the owner (already signed in - the proxy gate forwards unauthenticated
// visitors to /login and back) reviews the requesting client and scopes and
// approves or denies. Only the registered Preston Control client can be
// approved from this page (lib/preston-control/consent.ts).
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

type OAuthLookup = {
  getAuthorizationDetails(id: string): Promise<{ data: unknown; error: { message: string } | null }>;
};

export default async function ConsentPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const id = typeof sp.authorization_id === 'string' ? sp.authorization_id : '';
  const error = typeof sp.error === 'string' ? sp.error : '';

  const ctx = await resolveOwner();
  if (!ctx) redirect('/login');

  let view:
    | { kind: 'error'; message: string }
    | { kind: 'consent'; clientName: string; scopes: string[]; email: string } =
    { kind: 'error', message: error || 'Missing authorization_id.' };

  if (!error && validAuthorizationId(id)) {
    const supabase = await getServerSupabase();
    const oauth = (supabase?.auth as unknown as { oauth?: OAuthLookup } | undefined)?.oauth;
    if (!oauth) {
      view = { kind: 'error', message: 'OAuth server client unavailable.' };
    } else {
      const res = await oauth.getAuthorizationDetails(id);
      if (res.error || !res.data || typeof res.data !== 'object') {
        view = { kind: 'error', message: 'Authorization request not found or expired.' };
      } else {
        const d = res.data as Record<string, unknown>;
        if (typeof d['redirect_url'] === 'string') redirect(String(d['redirect_url']));
        const gate = evaluateConsent(
          d as unknown as Parameters<typeof evaluateConsent>[0],
          ctx.ownerEmail,
          process.env as Record<string, string | undefined>,
        );
        view = gate.ok
          ? {
              kind: 'consent',
              clientName: String((d['client'] as Record<string, unknown>)?.['name'] ?? 'OAuth client'),
              scopes: gate.scopes,
              email: ctx.ownerEmail,
            }
          : { kind: 'error', message: 'Consent refused: ' + gate.reason };
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="mb-2 text-xl font-semibold">Preston Control - Authorize</h1>
        {view.kind === 'error' ? (
          <p className="rounded bg-red-900 p-3 text-sm">{view.message}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-300">
              <span className="font-medium">{view.clientName}</span> is requesting access to
              Preston Control as <span className="font-mono">{view.email}</span>.
            </p>
            <ul className="mb-4 list-disc pl-5 text-sm">
              {view.scopes.map((s) => <li key={s}><span className="font-mono">{s}</span></li>)}
            </ul>
            <p className="mb-4 text-xs text-slate-400">
              Granting access lets the client call Preston&apos;s six control tools under your
              owner identity. Approval decisions still run through Preston&apos;s owner-only,
              audited approval path. You can revoke this grant at any time.
            </p>
            <div className="flex gap-3">
              <form action={approveConsent}>
                <input type="hidden" name="authorization_id" value={id} />
                <button type="submit" className="rounded bg-emerald-800 px-4 py-2 font-medium hover:bg-emerald-700">Approve</button>
              </form>
              <form action={denyConsent}>
                <input type="hidden" name="authorization_id" value={id} />
                <button type="submit" className="rounded bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600">Deny</button>
              </form>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
