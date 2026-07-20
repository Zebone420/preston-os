import type { AgentRecord } from './types';
import type { Job } from './queue';
import type { ObserveCandidate } from './orchestrator';
import { resolveResume } from './checkpoint';
import {
  selectCandidateJobs,
  stagingCheckpoint,
  stagingEnvelope,
} from './candidates';
import {
  acquireLease,
  completeSimulatedJob,
  listJobsByStatus,
  markJobLeased,
  readLatestCheckpoint,
  readSystemControlsChecked,
  recoverExpiredLeasedJobs,
  releaseLease,
  requeueJob,
  upsertAgent,
  type RuntimeClient,
} from './store';
import { mapJobRow } from './candidates';
import type { SystemControls } from './controls';
import { workerOnce } from './worker-service';

// Preston AI OS - staging simulation service (Phase 5E). Drives one bounded
// evidence-producing pass over DB-sourced candidates: select -> lease (CAS,
// fenced) -> resume check -> simulate (executed ALWAYS false) -> checkpoint +
// attempt evidence -> complete/requeue (token-fenced CAS). It performs NO
// business action, NO outbound send, NO execution; execution_enabled and
// remote_runner_enabled are never read as permission here because nothing
// executes. Bounded by maxJobs; every step is race-safe and fail-closed.

export interface StagingCycleOptions {
  agent: AgentRecord;
  maxJobs: number;
  leaseTtlMs: number;
  now: string;
  tokenFactory?: () => string; // injectable for deterministic tests
}

export interface JobEvidence {
  jobId: string;
  outcome:
    | 'simulated'        // full chain: lease + attempt + checkpoint + completed
    | 'requeued'         // simulation blocked -> attempt recorded, job requeued
    | 'skipped_completed'// prior complete checkpoint -> idempotent completion
    | 'lease_unavailable'
    | 'lost_race'
    | 'resume_rejected';
  leaseVia?: 'fresh' | 'takeover';
  attemptWritten: boolean;
  checkpointWritten: boolean;
  completed: boolean;
  reason?: string;
}

export interface StagingCycleResult {
  halted: boolean;
  considered: number;
  recovered: number; // expired-lease jobs swept back to 'queued' this cycle
  rejected: { id: string | null; reason: string }[];
  evidence: JobEvidence[];
}

// One bounded staging worker cycle. Controls are read FIRST and the halt gate
// FAILS CLOSED on an unreadable control plane (audit fix: DEFAULT_CONTROLS
// has owner_stop=false, so a read error must count as halted, not as "not
// stopped"). The per-candidate loop re-checks and stops mid-batch.
export async function runStagingWorkerCycle(
  client: RuntimeClient,
  opts: StagingCycleOptions,
): Promise<StagingCycleResult> {
  const { agent, now } = opts;
  const token = opts.tokenFactory ?? (() => globalThis.crypto.randomUUID());

  const first = await readSystemControlsChecked(client);
  if (!first.readOk || first.controls.owner_stop || first.controls.paused) {
    return { halted: true, considered: 0, recovered: 0, rejected: [], evidence: [] };
  }

  // Crash recovery sweep (audit fix): requeue jobs stranded in 'leased' by a
  // dead generation. Time-fenced - live leases are untouched.
  const swept = await recoverExpiredLeasedJobs(client, now);

  // Registry heartbeat: candidates are only eligible for a live agent.
  await upsertAgent(client, { ...agent, last_seen: now, status: 'idle' });

  const read = await listJobsByStatus(client, 'queued', opts.maxJobs);
  const sel = selectCandidateJobs(read.rows, { now, limit: opts.maxJobs, controls: first.controls });
  const evidence: JobEvidence[] = [];

  for (const job of sel.selected) {
    // Re-check halt between candidates; a read failure counts as halted.
    const c = await readSystemControlsChecked(client);
    if (!c.readOk || c.controls.owner_stop || c.controls.paused) {
      return { halted: true, considered: sel.selected.length, recovered: swept.recovered, rejected: sel.rejected, evidence };
    }
    evidence.push(await runOneJob(client, job, { ...opts, tokenFactory: token }, c.controls));
  }

  return { halted: false, considered: sel.selected.length, recovered: swept.recovered, rejected: sel.rejected, evidence };
}

async function runOneJob(
  client: RuntimeClient,
  job: Job,
  opts: StagingCycleOptions,
  controls: SystemControls,
): Promise<JobEvidence> {
  const { agent, now } = opts;
  const token = (opts.tokenFactory ?? (() => globalThis.crypto.randomUUID()))();
  const none = { attemptWritten: false, checkpointWritten: false, completed: false };

  // 1. Lease acquisition (DB unique(job_id) CAS; expired leases recoverable).
  const acq = await acquireLease(client, job.id, agent.id, token, opts.leaseTtlMs, now);
  if (!acq.ok) return { jobId: job.id, outcome: 'lease_unavailable', ...none, reason: acq.error };

  const leaseExpires = new Date(Date.parse(now) + opts.leaseTtlMs).toISOString();

  // 2. Job CAS queued -> leased. Losing means another generation got the job
  //    row first; compensate by expiring the lease we just took.
  const cas = await markJobLeased(client, job.id, agent.id, token, leaseExpires, now);
  if (!cas.ok) {
    await releaseLease(client, job.id, agent.id, token, now);
    return { jobId: job.id, outcome: 'lost_race', leaseVia: acq.via, ...none, reason: cas.error };
  }

  // 3. Crash-recovery resume resolution. Fail-closed on corrupt/stale rows AND
  //    on a failed checkpoint READ (audit fix: an unreadable checkpoint must
  //    not be mistaken for "no prior checkpoint" - that path would re-do work).
  const cp = await readLatestCheckpoint(client, job.id);
  if (cp.error) {
    await releaseLease(client, job.id, agent.id, token, now);
    return {
      jobId: job.id, outcome: 'resume_rejected', leaseVia: acq.via, ...none,
      reason: 'checkpoint read failed (fail-closed): ' + cp.error,
    };
  }
  const resume = resolveResume(cp.row, job);
  if (resume.action === 'reject') {
    await releaseLease(client, job.id, agent.id, token, now);
    return { jobId: job.id, outcome: 'resume_rejected', leaseVia: acq.via, ...none, reason: resume.reason };
  }
  if (resume.action === 'skip_completed') {
    // Idempotent completion: no new attempt, no duplicate work.
    const done = await completeSimulatedJob(client, job.id, token, job.attempts, now);
    await releaseLease(client, job.id, agent.id, token, now);
    return {
      jobId: job.id, outcome: 'skipped_completed', leaseVia: acq.via,
      attemptWritten: false, checkpointWritten: false, completed: done.ok, reason: resume.reason,
    };
  }

  // 4. Bounded simulation (executed ALWAYS false). The leased snapshot carries
  //    this generation's token so the attempt id embeds it (generation fence).
  const leased: Job = {
    ...job, status: 'leased', lease_owner: agent.id, lease_token: token,
    lease_expires_at: leaseExpires,
  };
  const r = await workerOnce({
    client,
    cycle: {
      eligibility: {
        agent, job: leased, controls,
        requiredCapabilities: ['code'], requiredConnectors: ['github'], now,
      },
      envelope: stagingEnvelope(leased),
      now,
      mode: 'simulation',
    },
    jobId: job.id,
    agentId: agent.id,
    checkpoint: stagingCheckpoint(leased, agent, now),
    now,
  });

  // 5. Token-fenced completion CAS: simulated ok -> checkpointed (terminal for
  //    the staging drill; selection never re-picks it), blocked -> requeue with
  //    the attempt counted (selection rejects it once attempts are exhausted).
  const attempts = job.attempts + 1;
  const fin = r.simulatedOk
    ? await completeSimulatedJob(client, job.id, token, attempts, now)
    : await requeueJob(client, job.id, token, attempts, now);

  return {
    jobId: job.id,
    outcome: r.simulatedOk ? 'simulated' : 'requeued',
    leaseVia: acq.via,
    attemptWritten: r.attemptWritten,
    checkpointWritten: r.checkpointWritten,
    completed: r.simulatedOk && fin.ok,
    reason: fin.ok ? undefined : fin.error,
  };
}

// Hermes observe batch, DB-sourced (Phase 5E). Read-only assembly over BOTH
// 'queued' and 'checkpointed' jobs (audit fix: worker and Hermes run on
// independent timers, and the worker usually drains the queue first - if
// Hermes only observed 'queued' it might never see a drill job at all).
// Observing a checkpointed job is idempotent: the decision/event ids are
// keyed on the job id, so re-observation writes nothing new. Command is null;
// observe_only mode does not consult it, and propose/dispatch modes fail
// closed on a missing packet. Fails closed to an empty batch when the control
// plane is unreadable.
export async function buildHermesObserveBatch(
  client: RuntimeClient,
  agent: AgentRecord,
  maxJobs: number,
  now: string,
): Promise<ObserveCandidate[]> {
  const checked = await readSystemControlsChecked(client);
  if (!checked.readOk) return [];
  const controls = checked.controls;
  const queued = await listJobsByStatus(client, 'queued', maxJobs);
  const done = await listJobsByStatus(client, 'checkpointed', maxJobs);
  const jobs = [...queued.rows, ...done.rows]
    .map(mapJobRow)
    .filter((j): j is Job => j !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, maxJobs));
  return jobs.map((job) => ({
    id: job.id,
    input: {
      controls,
      command: null,
      eligibility: {
        agent, job, controls,
        requiredCapabilities: [], requiredConnectors: [], now,
      },
      now,
    },
  }));
}
