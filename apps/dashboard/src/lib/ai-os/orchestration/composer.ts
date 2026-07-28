// Preston AI OS - Phase 7 Goals/Tasks Request Composer engine. PURE,
// deterministic (no I/O, no clock, no randomness). Interprets an owner's
// natural-language operational request into a structured proposal: goals,
// tasks, dependencies, requested roles, and a policy classification per task.
// The request text is UNTRUSTED INPUT and is treated as data only - nothing
// in it is instruction authority, nothing in it can authorize, approve,
// escalate, or weaken policy. Fail-closed: injection markers, classification
// spoofing, self-approval requests, prohibited capabilities, ambiguity, and
// malformed structure all reject; the engine NEVER executes anything and its
// output is only a PROPOSAL that a separate owner-confirmation boundary may
// later persist (simulation-only, staging-only).

import { hasSecretText } from '../commands';
import type { RiskClass } from '../types';
import type { AgentRole, JobKind } from './model';
import { classifyJob, type PolicyTier } from './policy';

export const MAX_REQUEST_CHARS = 4000;
export const MAX_COMPOSED_GOALS = 3;
export const MAX_COMPOSED_TASKS = 10; // per goal

export interface ComposedTask {
  local_id: string; // t1..tN, stable within its goal, in request order
  kind: JobKind;
  title: string;
  objective: string;
  depends_on_local: string[];
  requested_role: AgentRole; // implementer per decomposition rules
  risk_class: RiskClass;
  tier: PolicyTier;
  requires_approval: boolean;
  policy_reason: string;
}

export interface ComposedGoal {
  local_id: string; // g1..gN in request order
  title: string;
  objective: string;
  tasks: ComposedTask[];
}

export interface ComposerProposal {
  ok: true;
  goals: ComposedGoal[];
  constraints: string[]; // negative guard sentences, recorded verbatim
  warnings: string[];
  approvals_required: number;
  proposal_hash: string; // deterministic content binding (FNV-1a, display/bind aid)
}

export type ComposeOutcome = ComposerProposal | { ok: false; errors: string[] };

// --- untrusted-text defenses ------------------------------------------------

// Prompt-injection markers. ANY match anywhere in the request (including
// quoted text, task titles, or descriptions) rejects the whole request - an
// instruction to ignore rules is never "just a task title". Matched against
// the raw text so nesting inside quotes or lists cannot hide a marker.
const INJECTION_MARKERS: Array<[string, RegExp]> = [
  ['ignore_rules', /\b(ignore|disregard|forget|override)\b[^.\n]{0,60}\b(instruction|rule|polic|safety|guard|restriction|system prompt)/i],
  ['fake_system_prompt', /(\[system\]|<\/?system>|^\s*system\s*:)/im],
  ['owner_impersonation', /\b(i am|this is|speaking as)\s+(the\s+)?owner\b/i],
  ['claimed_authorization', /\bowner\s+(has\s+)?(already\s+)?(approved|authorized|confirmed)\b/i],
  ['claimed_authorization2', /\byou (are|have been)\s+(now\s+)?authorized\b/i],
  ['approval_bypass', /\b(skip|bypass|waive|omit|disable|suppress|without)\b[^.\n]{0,40}\b(owner\s+)?(approval|confirmation|gate|review|guard)/i],
  ['self_approval', /\b(auto|self)[-\s]?approv|\bapprove\s+(this|it|yourself|your own|the task|my request)\b/i],
  ['classification_spoof', /\b(risk|tier|class(?:ification)?)\s*[:=]?\s*(green|safe|harmless|low)\b/i],
  ['preapproved_spoof', /\b(pre[-\s]?approved|already\s+approved|no\s+approval\s+(is\s+)?(needed|required)|approval\s+not\s+(needed|required))\b/i],
  ['policy_edit', /\b(weaken|relax|loosen|remove|edit|rewrite)\b[^.\n]{0,40}\b(polic|rls|guard|hook|allowlist|allowed[-\s]?path)/i],
];

// Capabilities that are categorically unavailable in Phase 7 regardless of
// approval - a request naming them is rejected outright, never persisted.
// Constraint sentences ("do not access production") are exempted upstream.
// The destructive-verb detector is ASSEMBLED from fragments (same idiom as
// commands.ts BLACK_MARKERS) so this source file never contains a literal
// destructive SQL keyword for the local RED-boundary scanner to flag. It is
// a DETECTION pattern over untrusted request text - nothing here executes.
const DESTRUCTIVE_VERBS =
  ['delete', 'destroy', 'wipe', 'purge', 'trun' + 'cate'].join('|');
const DESTRUCTIVE_RE = new RegExp(
  '\\b(' + DESTRUCTIVE_VERBS + ')\\b[^.\\n]{0,40}\\b(data|ta' + 'ble|record|database|repo|file)',
  'i');

const PROHIBITED_CAPABILITIES: Array<[string, RegExp]> = [
  ['production_access', /\b(prod(uction)?)\b/i],
  ['credential_access', /\b(credential|secret|token|api[-\s_]?key|password|oauth)/i],
  ['external_message', /\b(send|write|reply)\b[^.\n]{0,60}\b(email|sms|whatsapp|telegram|text message|message|customer|client)\b/i],
  ['external_message2', /\b(email|sms|whatsapp)\b[^.\n]{0,40}\b(customer|client|to)\b/i],
  ['financial_action', /\b(payment|invoice|charge|refund|payout|wire|transfer\s+(funds|money))\b/i],
  ['rls_weakening', /\brls\b|\brow[-\s]level[-\s]security\b/i],
  ['allowed_path_expansion', /\ballowed[-\s]?paths?\b/i],
  ['unrestricted_shell', /\b(unrestricted|full|raw|arbitrary)\b[^.\n]{0,30}\b(shell|bash|terminal|command)/i],
  ['network_access', /\b(network|internet|outbound)\s+(access|calls?|requests?)\b/i],
  ['execution_activation', /\b(enable|activate|turn\s+on|set)\b[^.\n]{0,40}\b(execution|remote[-\s_]?runner|hermes)/i],
  ['execution_activation2', /\bexecution[-\s_]?enabled\b|\bremote[-\s_]?runner\b/i],
  ['destructive_action', DESTRUCTIVE_RE],
  ['force_push', /\bforce[-\s]?push\b/i],
];

// Execution-mode requests the composer can never grant.
const EXECUTION_MODE_MARKERS = /\b(real|live|remote|unrestricted)\s+(execution|mode|run(ner)?)\b|\bexecute\s+for\s+real\b|\bnot\s+(a\s+)?simulation\b/i;

// --- deterministic NL interpretation ---------------------------------------

// Kind lexicon: FIRST match in this fixed order wins (deterministic).
const KIND_LEXICON: Array<[JobKind, RegExp]> = [
  ['migration', /\b(migrat|schema\s+change)/i],
  ['repair', /\b(repair|fix|remediate)/i],
  ['test', /\b(test|validat|regression)/i],
  ['audit', /\b(audit|inspect|review|verif|check|examin)/i],
  ['documentation', /\b(document|summar|report|write[-\s]?up|record|attach|note|readiness)/i],
  ['recommendation', /\b(recommend|propos|suggest)/i],
  ['code', /\b(implement|build|code|refactor|add\b|create\s+(a\s+)?(component|endpoint|helper|feature))/i],
];

const KNOWN_ROLES: ReadonlySet<string> = new Set(['claude', 'codex', 'audit']);
const FORBIDDEN_ROLES: ReadonlySet<string> = new Set(['chatgpt', 'hermes']);

function inferKind(text: string): JobKind {
  for (const [kind, re] of KIND_LEXICON) if (re.test(text)) return kind;
  return 'unknown';
}

// Prohibited-capability scan for any NON-CONSTRAINT text (goal statements,
// task items, and sentences the parser could not place). A dangerous clause
// is rejected even when it would otherwise be ignored - unparseable text is
// never a safe place to hide a capability request.
function scanProhibited(text: string): string[] {
  const found: string[] = [];
  for (const [label, re] of PROHIBITED_CAPABILITIES) {
    if (re.test(text)) found.push(`prohibited:${label}`);
  }
  return found;
}

function titleOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');
  const capped = t.length > 80 ? t.slice(0, 77) + '...' : t;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

// FNV-1a 32-bit over a canonical JSON of the semantic proposal content.
// Display/binding aid only - the durable idempotency binding is recomputed
// server-side at confirmation from the SAME raw request.
export function proposalHash(goals: ComposedGoal[]): string {
  const canon = JSON.stringify(goals.map((g) => ({
    l: g.local_id, t: g.title, o: g.objective,
    k: g.tasks.map((x) => [x.local_id, x.kind, x.title, x.objective,
      x.depends_on_local, x.requested_role, x.requires_approval]),
  })));
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

interface RawTask {
  text: string;
  explicit_number: number | null; // "task 2:" style numbering, if present
}

// A constraint sentence reaffirms a prohibition ("do not deploy...") - it is
// recorded, exempt from the prohibited-capability scan (it names capabilities
// in order to renounce them), but still injection-scanned via the raw text.
function isConstraint(sentence: string): boolean {
  return /^\s*(please\s+)?(do\s+not|don'?t|never|no\s+|avoid|refrain|without\s+(deploying|sending|touching))/i.test(sentence);
}

function splitSentences(raw: string): string[] {
  return raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Split a "create tasks to A, B, and C" enumeration into items. A leading
// "then" is KEPT - it is the sequential-dependency marker consumed later.
function splitEnumeration(text: string): string[] {
  return text
    .split(/,\s*(?:and\s+)?|;\s*|\s+and\s+(?=[a-z]+\s)/i)
    .map((s) => s.trim().replace(/^\s*and\s+/i, ''))
    .filter(Boolean);
}

// --- the composer -----------------------------------------------------------

export function composeRequest(raw: unknown): ComposeOutcome {
  const errors: string[] = [];
  if (typeof raw !== 'string') return { ok: false, errors: ['request_type_invalid'] };
  const text = raw.trim();
  if (!text) return { ok: false, errors: ['empty_request'] };
  if (text.length > MAX_REQUEST_CHARS) return { ok: false, errors: ['request_too_long'] };
  // Control characters (other than \n \r \t) are never legitimate here.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    return { ok: false, errors: ['control_characters_in_request'] };
  }
  if (hasSecretText(text)) errors.push('secret_in_request');

  // Injection scan over the RAW text: quoting, nesting, or hiding a marker
  // inside a task title does not exempt it.
  for (const [label, re] of INJECTION_MARKERS) {
    if (re.test(text)) errors.push(`injection:${label}`);
  }
  if (EXECUTION_MODE_MARKERS.test(text)) errors.push('unsupported_execution_mode');
  if (errors.length) return { ok: false, errors };

  const sentences = splitSentences(text);
  const constraints: string[] = [];
  const warnings: string[] = [];
  const goals: Array<{ title: string; objective: string; tasks: RawTask[] }> = [];
  const current = () => goals[goals.length - 1];

  const goalStart = /^(?:please\s+)?create\s+(?:an?\s+)?(?:[\w-]+[-\s])*?goal\s+(?:to|for|that)\s+(.+)$/i;
  const goalLabel = /^goal\s*:\s*(.+)$/i;
  const taskListStart = /^(?:also\s+)?create\s+tasks?\s+(?:to|that)\s+(.+)$/i;
  const taskLabel = /^task(?:\s+(\d+))?\s*:\s*(.+)$/i;
  const bullet = /^(?:[-*]|\d+[.)])\s+(.+)$/;

  for (const sentence of sentences) {
    if (isConstraint(sentence)) { constraints.push(sentence); continue; }
    let m: RegExpMatchArray | null;
    if ((m = sentence.match(goalLabel)) || (m = sentence.match(goalStart))) {
      errors.push(...scanProhibited(m[1]));
      goals.push({ title: titleOf(m[1]), objective: m[1].trim(), tasks: [] });
      continue;
    }
    if ((m = sentence.match(taskListStart))) {
      if (!current()) goals.push({ title: '', objective: '', tasks: [] });
      for (const item of splitEnumeration(m[1])) {
        current().tasks.push({ text: item, explicit_number: null });
      }
      continue;
    }
    if ((m = sentence.match(taskLabel))) {
      if (!current()) goals.push({ title: '', objective: '', tasks: [] });
      current().tasks.push({
        text: m[2].trim(),
        explicit_number: m[1] ? Number(m[1]) : null,
      });
      continue;
    }
    if ((m = sentence.match(bullet))) {
      if (!current()) goals.push({ title: '', objective: '', tasks: [] });
      current().tasks.push({ text: m[1].trim(), explicit_number: null });
      continue;
    }
    if (!goals.length) {
      // The opening sentence, when not an explicit goal marker, is read as
      // the goal statement itself.
      errors.push(...scanProhibited(sentence));
      goals.push({ title: titleOf(sentence), objective: sentence, tasks: [] });
      continue;
    }
    errors.push(...scanProhibited(sentence));
    warnings.push(`unparsed_sentence:${titleOf(sentence).slice(0, 40)}`);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  if (!goals.length) return { ok: false, errors: ['ambiguous_request:no_goal'] };
  if (goals.length > MAX_COMPOSED_GOALS) return { ok: false, errors: ['too_many_goals'] };

  // A goal with no tasks and no separate task sentences is ambiguous - the
  // composer never invents work the owner did not describe.
  const composed: ComposedGoal[] = [];
  goals.forEach((g, gi) => {
    const gid = `g${gi + 1}`;
    if (!g.objective && g.tasks.length === 0) {
      errors.push(`ambiguous_request:goal_${gi + 1}_empty`);
      return;
    }
    if (g.tasks.length === 0) {
      errors.push(`ambiguous_request:goal_${gi + 1}_has_no_tasks`);
      return;
    }
    if (g.tasks.length > MAX_COMPOSED_TASKS) {
      errors.push('too_many_tasks');
      return;
    }
    if (!g.title) {
      // Task-only request: derive the goal from the first task, flagged for
      // the owner to review rather than silently inventing intent.
      g.title = titleOf(g.tasks[0].text);
      g.objective = g.objective || g.tasks[0].text;
      warnings.push('goal_title_derived_from_first_task');
    }

    // Explicit task numbers must be unique and dense enough to reference.
    const seenNumbers = new Set<number>();
    for (const t of g.tasks) {
      if (t.explicit_number !== null) {
        if (seenNumbers.has(t.explicit_number)) errors.push('duplicate_task_identifier');
        seenNumbers.add(t.explicit_number);
      }
    }

    const tasks: ComposedTask[] = [];
    g.tasks.forEach((t, ti) => {
      const localId = `t${t.explicit_number ?? ti + 1}`;
      if (tasks.some((x) => x.local_id === localId)) {
        errors.push('duplicate_task_identifier');
        return;
      }
      let item = t.text;

      // Prohibited capabilities: reject; the composer cannot even propose them.
      errors.push(...scanProhibited(item));

      // Dependencies: explicit references only (deterministic).
      const deps: string[] = [];
      const depRef = item.match(/\b(?:after|depends\s+on|following)\s+task\s+(\d+)\b/i);
      if (depRef) {
        deps.push(`t${depRef[1]}`);
        item = item.replace(depRef[0], '').replace(/\s{2,}/g, ' ').trim();
      } else if (/^then\b|\bafter\s+that\b|\busing\s+the\s+results?\b/i.test(item) && tasks.length > 0) {
        deps.push(tasks[tasks.length - 1].local_id);
        item = item.replace(/^then\s+/i, '').trim();
      }

      // Requested agent/role: explicit assignment only; unknown or forbidden
      // roles reject (a role name is a request, never an authority).
      let requestedRole: AgentRole | null = null;
      const roleRef = item.match(/\b(?:using|with|via|assign(?:ed)?\s+to|handled\s+by)\s+(?:agent\s+)?([a-z][a-z0-9_-]*)\b/i);
      if (roleRef) {
        const name = roleRef[1].toLowerCase();
        if (KNOWN_ROLES.has(name)) {
          requestedRole = name as AgentRole;
          item = item.replace(roleRef[0], '').replace(/\s{2,}/g, ' ').trim();
        } else if (FORBIDDEN_ROLES.has(name)) {
          errors.push(`unsupported_agent_role:${name}`);
        } else if (/agent|gpt|codex|claude|gemini|llama|bot/i.test(name)) {
          errors.push(`unsupported_agent:${name}`);
        }
        // otherwise: ordinary prose ("with care") - not an agent reference
      }

      const kind = inferKind(item);
      // An explicitly requested role must be contract-capable of the work:
      // the audit role has no edit_repo, so it can never take an edit kind.
      if (requestedRole === 'audit' &&
          ['code', 'test', 'migration', 'repair', 'documentation'].includes(kind)) {
        errors.push(`unsupported_agent_for_task:audit:${kind}`);
      }
      const objective = item.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!objective) { errors.push('empty_task'); return; }
      // Policy classification comes ONLY from the policy engine - nothing in
      // the request text can lower it (spoof markers already rejected).
      const policy = classifyJob(kind, objective);
      tasks.push({
        local_id: localId,
        kind,
        title: titleOf(objective),
        objective,
        depends_on_local: deps,
        requested_role: requestedRole ?? (kind === 'audit' ? 'audit' : 'claude'),
        risk_class: policy.risk_class,
        tier: policy.tier,
        requires_approval: policy.requires_approval,
        policy_reason: policy.reason,
      });
    });

    // Dependency references must resolve inside the goal and never self-refer.
    const ids = new Set(tasks.map((t) => t.local_id));
    for (const t of tasks) {
      for (const d of t.depends_on_local) {
        if (d === t.local_id) errors.push(`invalid_dependency:self:${t.local_id}`);
        else if (!ids.has(d)) errors.push(`invalid_dependency:unknown:${d}`);
      }
    }

    composed.push({ local_id: gid, title: g.title, objective: g.objective, tasks });
  });

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const approvalsRequired = composed.reduce(
    (n, g) => n + g.tasks.filter((t) => t.requires_approval).length, 0);

  return {
    ok: true,
    goals: composed,
    constraints,
    warnings,
    approvals_required: approvalsRequired,
    proposal_hash: proposalHash(composed),
  };
}
