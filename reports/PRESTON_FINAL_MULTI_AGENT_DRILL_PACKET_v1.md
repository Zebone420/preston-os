# FINAL MULTI-AGENT PRODUCTION DRILL PACKET v1 (PLAN)

Date: 2026-08-17. Status: PLAN. Gate 8 of
reports/PRESTON_FINAL_ACTIVATION_SEQUENCE_v1.md. Prereq: gates 1-7
ALL PASS (P2, Codex, T-mode, Hermes H1+H2, n8n-1, remote owner ops).
This drill proves every actor in ONE production goal's audit chain.
Doc-only, business-neutral, one drill window.

## Cast and expected stamp

| Actor | Path | Expected durable evidence |
|-------|------|---------------------------|
| ChatGPT (chatgpt-1) | submits the master goal via intake | remote_intake_requests row actor_id=chatgpt-1, consumed |
| Owner (owner-remote-1) | approves from PHONE | orchestration_approvals decided one-time, phone window attested |
| Claude (claude-1 / claude adapter) | plans + reviews jobs | its jobs: assigned_role=claude, real:* executed:true |
| Codex (codex adapter) | implements job | its job: assigned_role='codex', real:* executed:true |
| Hermes | observes only | orchestration_decisions rows w/ route:* reasons, decision=observe, zero leases |
| n8n (n8n-1) | parallel doc intake row (separate request) | its own remote_intake_requests row actor_id=n8n-1 |

## Drill script (owner-run window)

M-1  Fetch origin/master; confirm all gate 1-7 reports PASS; confirm
     posture: execution_enabled=true, remote_runner_enabled=true,
     owner_stop=false, hermes_mode=observe_only, timers per baseline.
M-2  ChatGPT submits the goal by DIRECT API call (never relayed
     claims - staging lesson): neutral text that decomposes to a
     plan->implement->review chain with "... implemented using codex"
     phrasing so exactly one job routes assigned_role='codex'.
     request_id fmad-01.
M-3  n8n-1 workflow fires its single bounded intake (request_id
     n8n-fmad-01) - proves coexistence, its goal stays doc-only.
M-4  Goal parks at approval; owner approves FROM PHONE (gate 7
     procedure). No workstation in the approval loop.
M-5  Let the orchestrator run to completion (multiple ticks OK).
M-6  Mid-drill kill proof (optional but recommended): after the
     first job completes, owner_stop=true from phone -> single-line
     halt exit 75 -> restore -> clean resume.
M-7  Evidence capture after completion:
       .\scripts\p2\p2_drill_verify.ps1 -Label fmad-01 ...
     plus hermes.log + orchestrator.log excerpts for the window.

## PASS criteria (ALL required)

1. One master goal completed, environment='production'.
2. Intake attribution: chatgpt-1 stamped on the goal request; the
   parallel n8n-1 row exists independently consumed/pending per its
   own gate posture.
3. >= 2 executed jobs with DIFFERENT providers: at least one
   assigned_role=claude and one assigned_role='codex', each with
   real:*:completed:executed:true + real-audit paths_ok:clean and
   zero sim:* on executed jobs.
4. Approval decided from the phone, one-time, replay refused.
5. Hermes: decision rows present for the window, all observe;
   zero hermes leases, zero hermes job_attempts.
6. If M-6 ran: halt exit 75 + clean resume evidenced.
7. Post-drill safety sweep: P2 gate template section 3 checklist
   re-run PASS (RLS, anon zero, path allowlist, no external side
   effects, posture matches ruling).
8. No credential value in any artifact.

## Output

reports/PRESTON_AI_OS_FULL_MULTI_AGENT_LIVE_REPORT.md - the final
proof document: cast table with real ids, evidence file list,
per-actor stamp citations, CLAUDE.md gate block, owner ruling line.
On PASS -> Gate 9 (production SSOT activation declaration).

## Rollback

Standard ladder (owner_stop / timers / capability env / per-actor
disable). The drill itself is doc-only; a failed drill leaves only
cancellable/dead-letterable rows and consumed one-time approvals.
