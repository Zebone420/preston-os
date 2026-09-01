'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cursorStorageKey,
  deriveNotifications,
  isSubmitRejection,
  mergePage,
  type FeedEntry,
  type FeedPage,
  type FeedWindow,
  type HermesNotification,
} from '@/lib/hermes/feed';

// Hermes Supervisor Dashboard v0 - live supervisor feed + in-dashboard
// notification center. READ-ONLY observation: polls the owner-gated
// /api/hermes/events transport (preston_poll_events underneath) on an
// interval, persists the opaque cursor per environment, deduplicates by
// deterministic event id, and treats cursor_invalid as a VISIBLE
// re-anchor state - never as an empty feed, and never as a silent replay
// of old history into fresh notifications.

const POLL_MS = 15000;
const PAGE_LIMIT = 50;
const MAX_PAGES_PER_TICK = 5;
const NOTIFY_CAP = 50;

type Phase = 'anchoring' | 'live' | 'reanchor_required' | 'error';

function readCursor(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCursor(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the feed still works, anchoring each load.
  }
}

const KIND_BADGE: Record<string, string> = {
  queued: 'bg-slate-700',
  running: 'bg-sky-900',
  completed: 'bg-emerald-900',
  failed: 'bg-red-900',
  timed_out: 'bg-orange-900',
  dead_lettered: 'bg-red-950 text-red-300',
  kind_not_eligible: 'bg-red-950 text-red-300',
  blocked: 'bg-amber-900',
  paused: 'bg-amber-900',
  stopped: 'bg-amber-950',
  approval_required: 'bg-purple-900',
  submit_rejected: 'bg-fuchsia-950 text-fuchsia-300',
  task_kind_unresolved: 'bg-fuchsia-950 text-fuchsia-300',
};

const CLASS_LABEL: Record<string, string> = {
  completed: 'job completed',
  failed: 'job failed',
  timed_out: 'timed out',
  dead_lettered: 'dead-lettered',
  approval_required: 'approval required',
  submit_rejected: 'submit rejected',
};

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '';
}

export function SupervisorFeed({ environment }: { environment: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [notifications, setNotifications] = useState<HermesNotification[]>(
    [],
  );
  const [phase, setPhase] = useState<Phase>('anchoring');
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [feedWindow, setFeedWindow] = useState<FeedWindow | null>(null);
  const [unmapped, setUnmapped] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const storageKey = cursorStorageKey(environment);
  const cursorRef = useRef<string | null>(null);
  const backfillRef = useRef(true);
  const busyRef = useRef(false);
  // Phase mirror for the interval callback (updated only inside event/
  // async code, never during render - react-hooks/refs discipline).
  const phaseRef = useRef<Phase>('anchoring');
  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  // Entries mirror for the poll loop: merging inside a setState updater
  // would run twice under strict mode and double-post notifications.
  const entriesRef = useRef<FeedEntry[]>([]);

  const poll = useCallback(async () => {
    if (busyRef.current) return;
    if (phaseRef.current === 'reanchor_required') return;
    busyRef.current = true;
    try {
      for (let i = 0; i < MAX_PAGES_PER_TICK; i++) {
        const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
        if (cursorRef.current) params.set('cursor', cursorRef.current);
        const res = await fetch(`/api/hermes/events?${params}`, {
          cache: 'no-store',
        });
        if (res.status === 401) {
          setPhaseBoth('error');
          setNote('owner session required - sign in again');
          return;
        }
        const page = (await res.json()) as FeedPage;
        if (!page.ok) {
          if (page.error === 'cursor_invalid') {
            // NOT an empty feed: the stored cursor no longer decodes.
            // Stop polling and require an explicit re-anchor so history
            // is never silently replayed as fresh notifications.
            setPhaseBoth('reanchor_required');
            setNote(
              'stored feed cursor is invalid - re-anchor to resume',
            );
          } else {
            setPhaseBoth('error');
            setNote(`feed read failed: ${page.error ?? 'unknown'}`);
          }
          return;
        }
        const events = page.events ?? [];
        const receivedAt = new Date().toISOString();
        const merged = mergePage(entriesRef.current, events, {
          backfill: backfillRef.current,
          receivedAt,
        });
        entriesRef.current = merged.entries;
        setEntries(merged.entries);
        const fresh = deriveNotifications(merged.added);
        if (fresh.length > 0) {
          setNotifications((n) =>
            [...fresh].reverse().concat(n).slice(0, NOTIFY_CAP),
          );
        }
        if (page.next_cursor) {
          cursorRef.current = page.next_cursor;
          writeCursor(storageKey, page.next_cursor);
        }
        if (page.window) setFeedWindow(page.window);
        if (typeof page.unmapped_states === 'number') {
          setUnmapped(page.unmapped_states);
        }
        setLastRefresh(page.generated_at ?? receivedAt);
        if (events.length < PAGE_LIMIT) break;
      }
      backfillRef.current = false;
      setPhaseBoth('live');
      setNote(null);
    } catch {
      setPhaseBoth('error');
      setNote('feed unreachable - retrying on the next poll');
    } finally {
      busyRef.current = false;
    }
  }, [storageKey, setPhaseBoth]);

  useEffect(() => {
    cursorRef.current = readCursor(storageKey);
    // No stored cursor => the first drain replays window HISTORY
    // (backfill), which must never turn into notifications.
    backfillRef.current = cursorRef.current === null;
    // First poll is scheduled, not synchronous: the effect body itself
    // never sets state (react-hooks/set-state-in-effect).
    const kickoff = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => {
      if (phaseRef.current !== 'reanchor_required') void poll();
    }, POLL_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [poll, storageKey]);

  const reanchor = useCallback(() => {
    cursorRef.current = null;
    writeCursor(storageKey, null);
    backfillRef.current = true;
    setPhaseBoth('anchoring');
    setNote('re-anchoring: replayed window history is marked, not notified');
    void poll();
  }, [poll, storageKey, setPhaseBoth]);

  const newestFirst = [...entries].reverse();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Supervisor activity</h2>
          <span
            className={
              'rounded px-2 py-0.5 text-xs ' +
              (phase === 'live'
                ? 'bg-emerald-900'
                : phase === 'anchoring'
                  ? 'bg-slate-700'
                  : 'bg-amber-900')
            }
          >
            {phase === 'live'
              ? 'LIVE'
              : phase === 'anchoring'
                ? 'ANCHORING'
                : phase === 'reanchor_required'
                  ? 'RE-ANCHOR REQUIRED'
                  : 'FEED ERROR'}
          </span>
          {lastRefresh && (
            <span className="text-xs text-slate-500">
              last refresh {lastRefresh}
            </span>
          )}
        </div>

        {note && (
          <p className="mb-2 rounded bg-amber-950 p-2 text-xs text-amber-300">
            {note}
          </p>
        )}
        {phase === 'reanchor_required' && (
          <button
            onClick={reanchor}
            className="mb-3 rounded bg-amber-900 px-3 py-1 text-xs"
          >
            Re-anchor feed
          </button>
        )}

        {newestFirst.length === 0 ? (
          <p className="text-xs text-slate-500">
            no events in the covered window yet
          </p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
            {newestFirst.map((entry) => {
              const e = entry.event;
              const rejected = isSubmitRejection(e);
              return (
                <li
                  key={e.event_id}
                  className={
                    'flex flex-wrap items-center gap-2 border-t ' +
                    'border-slate-800 py-1 ' +
                    (entry.backfill ? 'opacity-60' : '')
                  }
                >
                  <span
                    className={
                      'rounded px-1.5 py-0.5 text-xs ' +
                      (KIND_BADGE[e.kind] ?? 'bg-slate-700')
                    }
                  >
                    {e.kind}
                  </span>
                  {entry.backfill && (
                    <span className="rounded bg-slate-800 px-1 text-xs text-slate-500">
                      history
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    {e.occurred_at}
                  </span>
                  {rejected ? (
                    <span className="text-xs text-fuchsia-300">
                      submit-time rejection (never entered the runtime)
                      {e.correlation_id ? ` - ${e.correlation_id}` : ''}
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-slate-500">
                      {e.goal_id && (
                        <Link
                          href={`/hermes/goals/${e.goal_id}`}
                          className="underline"
                        >
                          goal {shortId(e.goal_id)}
                        </Link>
                      )}{' '}
                      {e.job_id && (
                        <Link
                          href={`/hermes/jobs/${e.job_id}`}
                          className="underline"
                        >
                          job {shortId(e.job_id)}
                        </Link>
                      )}
                    </span>
                  )}
                  {e.provider_role && (
                    <span className="text-xs text-slate-500">
                      {e.provider_role}
                    </span>
                  )}
                  {e.failure_reason && (
                    <span className="text-xs text-red-300">
                      {e.failure_reason}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 rounded bg-slate-950 p-2 text-xs text-slate-500">
          window: goals covered{' '}
          {feedWindow ? feedWindow.goals_covered : 'UNKNOWN'} | goals{' '}
          {feedWindow ? feedWindow.goals_state : 'UNKNOWN'} | jobs{' '}
          {feedWindow ? feedWindow.jobs_state : 'UNKNOWN'} | approvals{' '}
          {feedWindow ? feedWindow.approvals_state : 'UNKNOWN'} | controls{' '}
          {feedWindow
            ? feedWindow.controls_readable
              ? 'readable'
              : 'UNREADABLE'
            : 'UNKNOWN'}{' '}
          | rejections{' '}
          {feedWindow
            ? feedWindow.rejections_readable
              ? 'readable'
              : 'UNREADABLE'
            : 'UNKNOWN'}{' '}
          | migration{' '}
          {feedWindow
            ? feedWindow.migration_applied
              ? 'applied'
              : 'ABSENT'
            : 'UNKNOWN'}{' '}
          | unmapped states {unmapped === null ? 'UNKNOWN' : unmapped}
        </p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">
            Notifications{' '}
            <span className="text-xs text-slate-500">
              ({notifications.length})
            </span>
          </h2>
          {notifications.length > 0 && (
            <button
              onClick={() => setNotifications([])}
              className="rounded bg-slate-800 px-2 py-0.5 text-xs"
            >
              Clear
            </button>
          )}
        </div>
        <p className="mb-2 text-xs text-slate-500">
          in-dashboard only, derived from authoritative supervisor events.
          External delivery (Telegram/SMS/email/push) is a later
          owner-gated slice and is NOT active.
        </p>
        {notifications.length === 0 ? (
          <p className="text-xs text-slate-500">
            no new notifications since this page opened
          </p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-2 border-t border-slate-800 py-1"
              >
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-xs ' +
                    (KIND_BADGE[n.kind] ?? 'bg-slate-700')
                  }
                >
                  {CLASS_LABEL[n.cls] ?? n.cls}
                </span>
                <span className="text-xs text-slate-400">
                  {n.occurred_at}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {n.goal_id ? `goal ${shortId(n.goal_id)} ` : ''}
                  {n.job_id ? `job ${shortId(n.job_id)} ` : ''}
                  {n.approval_id ? `approval ${n.approval_id}` : ''}
                </span>
                {n.failure_reason && (
                  <span className="text-xs text-red-300">
                    {n.failure_reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
