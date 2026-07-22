# N8N WORKFLOW AUDIT

Date: 2026-07-21. Read-only. No n8n API credential exists in this
environment (N8N_API_KEY is an empty placeholder read by no code -
VERIFIED). No workflow was enabled, disabled, published,
unpublished, executed, or edited.

## Instance

- URL: https://automation.prestonwd.com - VERIFIED reachable
  today, serving the n8n UI shell. Auth posture at the UI level
  not probed beyond the front page (no login attempted).
- Host: INFERRED gmail-dev-n8n (188.245.80.146); confirm via DNS
  (packet F).
- Version/patch level: UNKNOWN (packet C captures it). n8n
  versions age fast; an unpatched public automation console is
  the top security concern of this audit (see hygiene plan).
- Local dependency: ZERO references to the instance, its URL, any
  webhook path, or any workflow name anywhere in preston-os
  (VERIFIED sweep). The OS's only n8n code BLOCKS activation.

## Per-workflow analysis (state UNKNOWN until packet C export)

For each: what is known, what the export must answer, and the
proposed disposition. Common export questions: active flag,
triggers/schedules, webhook paths, credential references (safe
identifiers only), external reads/writes/sends, error handling,
last execution success/failure, execution counts.

1. PM-1 Program Manager - Health Monitor v1
   Purpose (INFERRED): scheduled health checks over legacy
   services. Overlap: Preston OS already has /os controls,
   systemd timers, preflight-health.sh, worker/Hermes health and
   heartbeats - a second monitoring loop would duplicate it.
   Export must answer: WHAT it monitors (if it watches assets the
   OS does not - e.g. n8n itself, Airtable, domains - that logic
   is worth porting). Disposition: INVESTIGATE -> INTEGRATE
   unique checks into Mission Control (proposal 4) -> ARCHIVE.

2. EXT-4 Open Loop Coordinator v1
   Purpose (INFERRED): detects open business loops (unanswered
   threads, pending follow-ups) and coordinates nudges. Maps
   directly onto the OS recommendation engine (quote_follow_up,
   stalled_project, delayed_order, client_response rules already
   exist). Export must answer: source systems, loop definitions,
   whether it SENDS anything. Disposition: INVESTIGATE ->
   INTEGRATE loop rules as additional simulation-only
   recommendation kinds (proposal 3) -> ARCHIVE.

3. EXT-3 Outstanding Deposit Detector v1
   Purpose (INFERRED): finds jobs with outstanding deposits.
   The OS already re-implemented a first version of this idea
   (missing_payment recommendation, Phase 6). Export must
   answer: its detection rules (thresholds, Airtable fields) so
   the OS rule can be tuned to owner-proven logic; whether it
   ever contacted clients (if yes, that behavior is NOT ported -
   V1 recommendations never contact anyone). Disposition:
   INVESTIGATE -> INTEGRATE rule refinements (proposal 2) ->
   ARCHIVE.

4. WF-1_ANDERSEN_INDEX_INGEST
   Purpose (INFERRED): ingest Andersen documents -> index/
   embeddings, likely into Supabase preston-ai-andersen. Export
   must answer: source (vault repo? uploads?), destination
   tables, embedding model + dimensions, chunking parameters.
   This is the highest-reuse-value workflow: it encodes the
   ingestion design for the future knowledge layer. Disposition:
   RETAIN (exported definition) -> INTEGRATE design into the
   knowledge layer (proposal 1); the n8n copy is archived after.

5. WF-3_ANDERSEN_ASK_MVP
   Purpose (INFERRED): retrieval + LLM answer over the Andersen
   index. Export must answer: retrieval query shape, model,
   prompt, provenance handling. Reuse: blueprint for a read-only
   Andersen research agent inside Preston OS (simulation-only,
   citations required). Disposition: RETAIN (exported) ->
   INTEGRATE (proposal 1) -> ARCHIVE n8n copy.

6. Andersen KB Read Test
   Purpose (INFERRED): connectivity/read smoke test. Disposition:
   ARCHIVE after export (evidence value only); DELETE CANDIDATE
   in the retirement packet once WF-1/WF-3 are ported.

7. "My workflow"
   Purpose: UNKNOWN (n8n default name - usually scratch). Export
   + execution history must answer whether it ever ran or holds
   credentials. Disposition: INVESTIGATE -> DELETE CANDIDATE
   (the only workflow proposed for eventual deletion rather than
   archive, and only after the export proves it empty/scratch).

## Credential note

Workflow exports EMBED credential IDs and can embed OAuth data.
Packet C instructs the owner to export with credentials EXCLUDED
and to share only sanitized JSON; the repo scanners run over any
export before it is committed (if archived in-repo at all -
default is owner-side archive storage).

## Automation-admin direction (proposal 5)

Read-only inventory first (this audit), draft-only changes in
n8n/drafts/ (already the repo convention, currently empty),
approval-gated publish/delete later, never a browser-held API
key. No code is required in this phase.
