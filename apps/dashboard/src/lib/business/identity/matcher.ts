// Phase 1 Lane A - deterministic project matcher (plan section 4.4).
//
// Signals are tried in this exact priority order; the FIRST signal that
// produces any hit decides the outcome:
//
//   1 project_code     exact Project ID                   -> linked_auto
//   2 external_id      exact source-system external ID    -> linked_auto
//   3 gmail_thread     existing Gmail thread mapping      -> linked_auto
//   4 order_number     quote / order number               -> linked_auto
//   5 property_client  exact property + confirmed client  -> linked_auto*
//   6 known_contact    exact known contact (email/phone)  -> linked_auto*
//   7 approved_alias   approved deterministic alias       -> linked_auto*
//   8 ai_candidate     AI candidate                       -> candidate
//
// (*) only when exactly one project is implied. Two or more different
// projects on the same signal = 'ambiguous' - the matcher FAILS CLOSED,
// proposes a review-queue item, and never falls through to a weaker
// signal to break the tie. Signal 8 can only ever yield 'candidate';
// AI confidence alone never links, let alone merges. Names are not a
// signal at all: two clients with the same last name and different
// addresses share nothing this module looks at.

import type { IdentityConfidence } from './confidence';
import { normalizeEmail, normalizePhone, propertyKey } from './normalize';
import { isProjectCode, normalizeProjectCodeInText } from './project-code';
import type { ReviewItemInput } from './review-queue';

export type ExternalSystem =
  | 'airtable'
  | 'gmail_thread'
  | 'iqplus'
  | 'home_depot_case'
  | 'home_depot_quote'
  | 'andersen_lead'
  | 'docusign_envelope'
  | 'drive_folder';

export const EXTERNAL_SYSTEMS: readonly ExternalSystem[] = [
  'airtable',
  'gmail_thread',
  'iqplus',
  'home_depot_case',
  'home_depot_quote',
  'andersen_lead',
  'docusign_envelope',
  'drive_folder',
] as const;

export type MatchSignal =
  | 'project_code'
  | 'external_id'
  | 'gmail_thread'
  | 'order_number'
  | 'property_client'
  | 'known_contact'
  | 'approved_alias'
  | 'ai_candidate';

// Rank 1..8; lower wins. Exported so persistence (identity_links.signal)
// and reports can show the rank next to the name.
export const SIGNAL_PRIORITY: readonly MatchSignal[] = [
  'project_code',
  'external_id',
  'gmail_thread',
  'order_number',
  'property_client',
  'known_contact',
  'approved_alias',
  'ai_candidate',
] as const;

export function signalRank(signal: MatchSignal): number {
  return SIGNAL_PRIORITY.indexOf(signal) + 1;
}

export type MatchOutcome = 'linked' | 'candidate' | 'ambiguous' | 'orphan';

export interface MatchEvidence {
  signal: MatchSignal;
  rank: number;
  detail: string;
  project_ids: string[];
}

export interface MatchResult {
  outcome: MatchOutcome;
  confidence: IdentityConfidence;
  project_id?: string;
  signal: MatchSignal | null;
  evidence: MatchEvidence[];
  review_item?: ReviewItemInput;
}

// --- input -----------------------------------------------------------------

export interface MatchInput {
  // Signal 1: an explicit code and/or free text (subject, filename) to
  // scan for one.
  project_code?: string | null;
  text?: string | null;
  // Signal 2.
  external?: { system: ExternalSystem; id: string } | null;
  // Signal 3.
  gmail_thread_id?: string | null;
  // Signal 4: quote / vendor order numbers seen in the input.
  order_numbers?: string[] | null;
  // Signal 5: the property as seen in the input plus the CONFIRMED
  // client id the caller already established (an unconfirmed client id
  // must not be passed here).
  property?: { address_line: string; unit?: string | null } | null;
  confirmed_client_id?: string | null;
  // Signals 6 and 7: contact channels as seen in the input.
  contact?: { email?: string | null; phone?: string | null } | null;
  // Signal 8: what an AI matcher proposed. May only yield 'candidate'.
  ai_candidate?: { project_id: string; rationale: string } | null;
  // Where the input came from, for the review item.
  subject_type?: string;
  subject_id?: string | null;
}

// --- index (a read-only snapshot the caller loads from the SSOT) -----------

export interface IndexProject {
  id: string;
  project_code: string | null;
  client_id: string;
  property_id: string | null;
  archived?: boolean;
}

export interface IndexExternalLink {
  external_system: ExternalSystem;
  external_id: string;
  entity_type: string;
  entity_id: string;
  confidence: IdentityConfidence;
}

export interface IndexOrderNumber {
  number: string;
  project_id: string;
}

export interface IndexProperty {
  id: string;
  client_id: string | null;
  address_line: string;
  unit?: string | null;
}

export interface IndexContact {
  id: string;
  client_id: string;
  email?: string | null;
  phone?: string | null;
}

export interface IndexAlias {
  alias_kind: 'email' | 'phone' | 'address';
  normalized_value: string;
  client_id?: string | null;
  contact_id?: string | null;
  property_id?: string | null;
  project_id?: string | null;
  approved: boolean;
  active: boolean;
}

export interface ProjectIndex {
  projects: IndexProject[];
  external_links?: IndexExternalLink[];
  order_numbers?: IndexOrderNumber[];
  properties?: IndexProperty[];
  contacts?: IndexContact[];
  aliases?: IndexAlias[];
}

// --- helpers ---------------------------------------------------------------

function uniq(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

function projectsOfClient(index: ProjectIndex, clientId: string): string[] {
  return uniq(
    index.projects
      .filter((p) => p.client_id === clientId && !p.archived)
      .map((p) => p.id),
  );
}

function projectsOfProperty(
  index: ProjectIndex,
  propertyId: string,
): string[] {
  return uniq(
    index.projects
      .filter((p) => p.property_id === propertyId && !p.archived)
      .map((p) => p.id),
  );
}

function knownProject(index: ProjectIndex, id: string): boolean {
  return index.projects.some((p) => p.id === id);
}

// Only links that already reached at least linked_auto count as an
// existing mapping; a candidate row is not a mapping.
function usableLink(l: IndexExternalLink): boolean {
  return (
    l.entity_type === 'project' &&
    (l.confidence === 'linked_auto' || l.confidence === 'confirmed')
  );
}

interface SignalHit {
  signal: MatchSignal;
  detail: string;
  project_ids: string[];
}

type SignalFn = (input: MatchInput, index: ProjectIndex) => SignalHit | null;

const sigProjectCode: SignalFn = (input, index) => {
  const codes: string[] = [];
  if (isProjectCode(input.project_code)) codes.push(input.project_code);
  if (typeof input.text === 'string') {
    codes.push(...normalizeProjectCodeInText(input.text));
  }
  const wanted = uniq(codes);
  if (wanted.length === 0) return null;
  const ids = uniq(
    index.projects
      .filter((p) => p.project_code && wanted.includes(p.project_code))
      .map((p) => p.id),
  );
  if (ids.length === 0) return null;
  return { signal: 'project_code', detail: wanted.join(','), project_ids: ids };
};

const sigExternalId: SignalFn = (input, index) => {
  const ext = input.external;
  if (!ext || !ext.id || ext.system === 'gmail_thread') return null;
  const ids = uniq(
    (index.external_links ?? [])
      .filter(
        (l) =>
          usableLink(l) &&
          l.external_system === ext.system &&
          l.external_id === ext.id,
      )
      .map((l) => l.entity_id)
      .filter((id) => knownProject(index, id)),
  );
  if (ids.length === 0) return null;
  return {
    signal: 'external_id',
    detail: `${ext.system}:${ext.id}`,
    project_ids: ids,
  };
};

const sigGmailThread: SignalFn = (input, index) => {
  const thread =
    input.gmail_thread_id ??
    (input.external?.system === 'gmail_thread' ? input.external.id : null);
  if (!thread) return null;
  const ids = uniq(
    (index.external_links ?? [])
      .filter(
        (l) =>
          usableLink(l) &&
          l.external_system === 'gmail_thread' &&
          l.external_id === thread,
      )
      .map((l) => l.entity_id)
      .filter((id) => knownProject(index, id)),
  );
  if (ids.length === 0) return null;
  return { signal: 'gmail_thread', detail: thread, project_ids: ids };
};

const sigOrderNumber: SignalFn = (input, index) => {
  const numbers = uniq(
    (input.order_numbers ?? [])
      .map((n) => n.trim().toUpperCase())
      .filter((n) => n.length > 0),
  );
  if (numbers.length === 0) return null;
  const ids = uniq(
    (index.order_numbers ?? [])
      .filter((o) => numbers.includes(o.number.trim().toUpperCase()))
      .map((o) => o.project_id)
      .filter((id) => knownProject(index, id)),
  );
  if (ids.length === 0) return null;
  return { signal: 'order_number', detail: numbers.join(','), project_ids: ids };
};

const sigPropertyClient: SignalFn = (input, index) => {
  if (!input.property || !input.confirmed_client_id) return null;
  const key = propertyKey(input.property.address_line, input.property.unit);
  if (!key) return null;
  const clientId = input.confirmed_client_id;
  const propIds = (index.properties ?? [])
    .filter(
      (p) =>
        p.client_id === clientId &&
        propertyKey(p.address_line, p.unit) === key,
    )
    .map((p) => p.id);
  if (propIds.length === 0) return null;
  const ids = uniq(
    propIds.flatMap((pid) =>
      projectsOfProperty(index, pid).filter((id) =>
        index.projects.some((p) => p.id === id && p.client_id === clientId),
      ),
    ),
  );
  if (ids.length === 0) return null;
  return {
    signal: 'property_client',
    detail: `${key} client:${clientId}`,
    project_ids: ids,
  };
};

const sigKnownContact: SignalFn = (input, index) => {
  if (!input.contact) return null;
  const email = normalizeEmail(input.contact.email ?? '');
  const phone = normalizePhone(input.contact.phone ?? '');
  if (!email && !phone) return null;
  const hits = (index.contacts ?? []).filter((c) => {
    const ce = normalizeEmail(c.email ?? '');
    const cp = normalizePhone(c.phone ?? '');
    return (email && ce && ce === email) || (phone && cp && cp === phone);
  });
  if (hits.length === 0) return null;
  const ids = uniq(hits.flatMap((c) => projectsOfClient(index, c.client_id)));
  if (ids.length === 0) return null;
  return {
    signal: 'known_contact',
    detail: [email, phone].filter(Boolean).join(','),
    project_ids: ids,
  };
};

const sigApprovedAlias: SignalFn = (input, index) => {
  const wanted: Array<{ kind: IndexAlias['alias_kind']; value: string }> = [];
  const email = normalizeEmail(input.contact?.email ?? '');
  const phone = normalizePhone(input.contact?.phone ?? '');
  if (email) wanted.push({ kind: 'email', value: email });
  if (phone) wanted.push({ kind: 'phone', value: phone });
  if (input.property) {
    const key = propertyKey(input.property.address_line, input.property.unit);
    if (key) wanted.push({ kind: 'address', value: key });
  }
  if (wanted.length === 0) return null;
  const hits = (index.aliases ?? []).filter(
    (a) =>
      a.approved &&
      a.active &&
      wanted.some(
        (w) => w.kind === a.alias_kind && w.value === a.normalized_value,
      ),
  );
  if (hits.length === 0) return null;
  const ids = uniq(
    hits.flatMap((a) => {
      if (a.project_id) return knownProject(index, a.project_id) ? [a.project_id] : [];
      if (a.property_id) return projectsOfProperty(index, a.property_id);
      if (a.client_id) return projectsOfClient(index, a.client_id);
      if (a.contact_id) {
        const c = (index.contacts ?? []).find((x) => x.id === a.contact_id);
        return c ? projectsOfClient(index, c.client_id) : [];
      }
      return [];
    }),
  );
  if (ids.length === 0) return null;
  return {
    signal: 'approved_alias',
    detail: wanted.map((w) => `${w.kind}:${w.value}`).join(','),
    project_ids: ids,
  };
};

const sigAiCandidate: SignalFn = (input, index) => {
  const c = input.ai_candidate;
  if (!c || !c.project_id || !knownProject(index, c.project_id)) return null;
  return {
    signal: 'ai_candidate',
    detail: c.rationale || 'ai candidate',
    project_ids: [c.project_id],
  };
};

const SIGNAL_FNS: Record<MatchSignal, SignalFn> = {
  project_code: sigProjectCode,
  external_id: sigExternalId,
  gmail_thread: sigGmailThread,
  order_number: sigOrderNumber,
  property_client: sigPropertyClient,
  known_contact: sigKnownContact,
  approved_alias: sigApprovedAlias,
  ai_candidate: sigAiCandidate,
};

// --- entry point -----------------------------------------------------------

export function matchProject(
  input: MatchInput,
  index: ProjectIndex,
): MatchResult {
  const evidence: MatchEvidence[] = [];
  for (const signal of SIGNAL_PRIORITY) {
    const hit = SIGNAL_FNS[signal](input, index);
    if (!hit) continue;
    const rank = signalRank(signal);
    evidence.push({
      signal,
      rank,
      detail: hit.detail,
      project_ids: hit.project_ids,
    });
    if (hit.project_ids.length > 1) {
      return {
        outcome: 'ambiguous',
        confidence: 'orphan',
        signal,
        evidence,
        review_item: {
          subject_type: input.subject_type ?? 'match_input',
          subject_id: input.subject_id ?? null,
          candidate_entity_type: 'project',
          candidate_entity_id: null,
          reason:
            `signal ${rank} (${signal}) matched ${hit.project_ids.length} ` +
            'projects; human decision required',
          signals: evidence,
        },
      };
    }
    const project_id = hit.project_ids[0];
    if (signal === 'ai_candidate') {
      return {
        outcome: 'candidate',
        confidence: 'candidate',
        project_id,
        signal,
        evidence,
        review_item: {
          subject_type: input.subject_type ?? 'match_input',
          subject_id: input.subject_id ?? null,
          candidate_entity_type: 'project',
          candidate_entity_id: project_id,
          reason: 'ai candidate match; human confirmation required',
          signals: evidence,
        },
      };
    }
    return {
      outcome: 'linked',
      confidence: 'linked_auto',
      project_id,
      signal,
      evidence,
    };
  }
  return { outcome: 'orphan', confidence: 'orphan', signal: null, evidence };
}
