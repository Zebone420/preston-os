# FINAL PRODUCTION ACTIVATION SEQUENCE v1 (master checklist)

Date: 2026-08-17. Purpose: after P2 PASS, eliminate every avoidable
pause. One row per remaining gate, in canonical order. A gate opens
the moment its prerequisite row shows PASS in committed evidence -
fetch origin/master first; the laptop session maintains packets
concurrently. Live-proof rule everywhere: files/DB/HTTP/git ground
truth only; relayed claims are not evidence.

Weight = rough remaining share of the Production-Live gap (~35%)
that closing the gate retires.

## Gate 1 - P2 Claude bounded prod execution (IN PROGRESS, office)

- Prereq: none (current gate).
- Artifact: PRESTON_P2_PROD_HOST_RUNBOOK_v1.md +
  PRESTON_P2_GATE_REPORT_TEMPLATE.md + scripts/p2/p2_drill_verify.ps1.
- Owner action: runbook H-2..H-9 + drills D-P2-1..3 (all owner-run;
  two credential mints inside, H-5/H-6).
- Agent action: verify evidence files, fill the gate report, sign.
- Live proof: template sections 1-3 all PASS with evidence refs.
- Rollback: runbook rollback ladder (timer off / owner_stop /
  capability env off / re-pin / delete host).
- Weight: ~10% (the single heaviest remaining gate).

## Gate 2 - Codex individual production proof

- Prereq: Gate 1 PASS.
- Artifact: PRESTON_CODEX_ACTIVATION_OWNER_PACKET_v1.md (CX-1..CX-5).
- Owner action: resolve the credential decision point (home-dir vs
  env-var auth - env-var requires its own review, do NOT slip it
  in), install codex CLI as preston-worker, fresh prod login,
  append the two env lines, run CX-4 drill x2, prove one revocation.
- Agent action: pre-verify packet vs code (audit running), verify
  drill evidence names codex, close report.
- Live proof: real:*:executed:true + real-audit paths_ok for a
  codex-assigned job, x2, zero sim:*, revocation proven.
- Rollback: CX-5 (env flag off / actor disable / owner_stop).
- Weight: ~4%.

## Gate 3 - Claude + Codex T-mode proof

- Prereq: Gate 2 PASS.
- Artifact: T-mode section of the Codex packet; full packet owed by
  the laptop session AFTER its adversarial machinery review closes
  (in flight; any defects found get fixed+tested first).
- Owner action: submit ONE team goal (Claude plans -> Codex
  implements -> Claude reviews), approve at the parked points.
- Agent action: author the T-mode packet + evidence checklist;
  verify per-provider attribution end-to-end.
- Live proof: one goal, >=2 jobs, DIFFERENT providers, each job's
  evidence names its own provider, own worktree, own approval
  binding; no cross-execution.
- Rollback: same ladder; per-provider env flags are independent.
- Weight: ~5%.

## Gate 4 - Hermes H1 (staging observe-only timer)

- Prereq: Gate 3 PASS (sequence position per status record).
- Artifact: PRESTON_HERMES_PROD_DELTA_PACKET_v1.md H1 +
  PHASE_5J_HERMES_VERIFICATION_PACKET.md (eight checks).
- Owner action: enable staging preston-hermes-observe.timer; run
  the eight read-only checks.
- Agent action: verify evidence, close H1.
- Live proof: checks H1..H8 PASS; zero leases/attempts by hermes.
- Rollback: disable timer; hermes_mode='disabled'.
- Weight: ~2%.

## Gate 5 - Hermes H2 (production observe-only)

- Prereq: Gate 4 PASS.
- Artifact: same packet, H2-1..H2-8 (separate prod identity+store).
- Owner action: H2-1..H2-6 provisioning + enable; fresh hermes
  credential (never worker's).
- Agent action: verify the eight checks against prod evidence.
- Live proof: same eight checks on prod; sends remain impossible.
- Rollback: H2-8.
- Weight: ~2%.

## Gate 6 - n8n first bounded workflow

- Prereq: Gate 5 PASS + legacy console hardening decision (LA-1).
- Artifact: PRESTON_N8N_FIRST_WORKFLOW_PACKET_v1.md + 0016 draft.
- Owner action: apply 0016; provision n8n-1 (-OnlyActor); build the
  3-node intake workflow; RED flip: enable actor + activate.
- Agent action: verify the 5 PASS criteria incl. disabled/enabled
  bracket and idempotency; close report.
- Live proof: packet section 5, all five.
- Rollback: packet section 6 (prove one).
- Weight: ~3%.

## Gate 7 - Remote owner operations proof (production)

- Prereq: Gate 1 PASS (independent of 2-6; can run early if the
  owner prefers - it only uses proven Claude-path machinery).
- Artifact: owed - small packet mirroring the staging phone drill
  (Phase 7 evidence shape: phone compose -> park -> phone approve ->
  resume -> owner_stop from phone).
- Owner action: run the phone drill against prod, laptop closed.
- Agent action: author the packet; verify evidence.
- Live proof: goal completed with owner-remote-1 attribution and a
  phone-issued approval + phone-issued owner_stop halt/resume.
- Rollback: owner_stop; nothing new is enabled by this gate.
- Weight: ~3%.

## Gate 8 - Final multi-agent production drill

- Prereq: Gates 1-7 PASS.
- Artifact: owed - drill script: ONE business-neutral goal touching
  every proven actor: ChatGPT submits (stamped), Claude plans/
  reviews, Codex implements, Hermes observes (decision rows),
  owner approves from phone, n8n-1 submits a parallel doc intake.
- Owner action: run the drill window; approvals; posture choice.
- Agent action: author drill + evidence matrix; verify per-actor
  attribution rows; write
  PRESTON_AI_OS_FULL_MULTI_AGENT_LIVE_REPORT.md.
- Live proof: every actor's stamped row in ONE goal's audit chain.
- Rollback: standard ladder; drill is doc-only.
- Weight: ~3%.

## Gate 9 - Production SSOT activation (declaration gate)

- Prereq: Gate 8 PASS.
- Artifact: mirror SSOT_STAGING_ACTIVATION_OWNER_PACKET.md S1-S4
  for prod (0012-0014 already applied in the P0 chain; actors
  already minted in P1 - remaining: flag verification sweep +
  formal declaration).
- Owner action: verify SSOT flags on prod Vercel (value non-empty -
  the classic empty-value save defect, twice bitten), dated ruling.
- Agent action: full read-only verification sweep; declaration doc.
- Live proof: status gateway serving; all actor legs stamped;
  declaration committed.
- Rollback: flag off (surface only; data stands).
- Weight: ~1.5%.

## Gate 10 - Golden production baseline

- Prereq: Gate 9 PASS.
- Artifact: mirror PRESTON_GOLDEN_STAGING_BASELINE.md for prod.
- Owner action: fresh prod pg_dump + off-host copy (owed item),
  final repin to the folded commit, firewall temp-rule cleanup owed
  since staging Gate H, posture ruling.
- Agent action: author the baseline doc (host pin, unit states,
  posture, backup SHA, open residue), final status-record update.
- Live proof: baseline doc + backup artifact evidence.
- Rollback: n/a (baseline IS the rollback reference).
- Weight: ~1.5%.

## Standing rules across all gates

Fetch origin/master before opening any gate. Fresh credential per
identity, never cross-env reuse. Every enable has a proven disable.
Owner_stop is the universal kill. Evidence files land under
reports/<gate>_evidence/ and commit with the gate report. Gates 2-6
each end at rest posture unless the owner rules otherwise.
