import Link from 'next/link';
import { resolveOwner } from '@/lib/ai-os/owner-context';
import { getPrestonArtifact, hermesToolContext } from '@/lib/hermes/adapter';

// Hermes Supervisor Dashboard v0 - artifact inspection. READ ONLY through
// getPrestonArtifact: metadata plus a SHORT-LIVED signed retrieval link
// minted per render (TTL 300s). The signed URL is never persisted, no
// storage credential is exposed, and there is no bucket browsing - one
// artifact id per page.
export const dynamic = 'force-dynamic';

export default async function HermesArtifactPage({
  params,
}: {
  params: Promise<{ artifact_id: string }>;
}) {
  const { artifact_id } = await params;
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Artifact</h1>
        <p className="mt-4 rounded bg-amber-900 p-3 text-sm">
          Owner login required.{' '}
          <Link href="/login" className="underline">
            Sign in
          </Link>
          .
        </p>
      </main>
    );
  }

  const res = await getPrestonArtifact(hermesToolContext(owner), artifact_id);
  if (!res.found) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Hermes - Artifact</h1>
        <p className="mt-4 rounded bg-amber-950 p-3 text-sm text-amber-300">
          artifact not readable: {res.error}
        </p>
        <Link href="/hermes" className="mt-4 inline-block text-sm underline">
          back to Hermes
        </Link>
      </main>
    );
  }
  const a = res.artifact;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Artifact</h1>
        <span className="rounded bg-sky-950 px-2 py-0.5 text-xs">
          READ ONLY
        </span>
        <Link href="/hermes" className="text-sm underline">
          back to Hermes
        </Link>
      </header>

      <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="font-medium">{a.name || '(unnamed artifact)'}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <dt className="text-slate-500">artifact_id</dt>
          <dd className="font-mono">{a.artifact_id}</dd>
          <dt className="text-slate-500">type</dt>
          <dd>{a.artifact_type}</dd>
          <dt className="text-slate-500">mime_type</dt>
          <dd>{a.mime_type}</dd>
          <dt className="text-slate-500">size_bytes</dt>
          <dd>{a.size_bytes}</dd>
          <dt className="text-slate-500">sha256</dt>
          <dd className="break-all font-mono">{a.sha256}</dd>
          <dt className="text-slate-500">goal</dt>
          <dd>
            <Link
              href={`/hermes/goals/${a.goal_id}`}
              className="font-mono underline"
            >
              {a.goal_id.slice(0, 8)}
            </Link>
          </dd>
          <dt className="text-slate-500">job</dt>
          <dd>
            <Link
              href={`/hermes/jobs/${a.job_id}`}
              className="font-mono underline"
            >
              {a.job_id.slice(0, 8)}
            </Link>
          </dd>
          <dt className="text-slate-500">run_id</dt>
          <dd className="font-mono">{a.run_id}</dd>
          <dt className="text-slate-500">created_by</dt>
          <dd>{a.created_by}</dd>
          <dt className="text-slate-500">provider</dt>
          <dd>{a.provider ?? 'UNKNOWN'}</dd>
          <dt className="text-slate-500">commit_sha</dt>
          <dd className="font-mono">{a.commit_sha ?? 'UNKNOWN'}</dd>
          <dt className="text-slate-500">environment</dt>
          <dd>{a.environment}</dd>
          <dt className="text-slate-500">classification</dt>
          <dd>{a.classification}</dd>
          <dt className="text-slate-500">retention_state</dt>
          <dd>{a.retention_state}</dd>
          <dt className="text-slate-500">created_at</dt>
          <dd>{a.created_at}</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
        <h2 className="mb-2 font-medium">Retrieval</h2>
        {res.retrieval === 'ok' && res.signed_url ? (
          <p>
            <a
              href={res.signed_url}
              className="underline"
              rel="noreferrer"
              target="_blank"
            >
              open artifact
            </a>{' '}
            <span className="text-xs text-slate-500">
              (signed link, expires in{' '}
              {res.signed_url_expires_in_seconds}s; reload this page to
              mint a fresh one - links are never stored)
            </span>
          </p>
        ) : (
          <p className="text-xs text-amber-400">
            no retrieval link:{' '}
            {res.retrieval === 'retention_not_active'
              ? 'retention state is not active'
              : 'storage unavailable on this surface'}
          </p>
        )}
      </section>
    </main>
  );
}
