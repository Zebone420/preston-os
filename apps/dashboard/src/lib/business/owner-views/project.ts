// Phase 2 - Hermes PROJECT truth view. PURE.
//
// One object that answers "what is blocking Project X" and "show me the
// current proposal / contract / vendor quote" from facts already in the
// SSOT. Stage gates come from identity/stage-gates (the same predicates
// that gate advancement), documents from the Lane B registry (current
// versions only; restricted privacy classes are excluded unless the
// caller holds owner scope), communications from Lane D. Documents are
// referenced by registry id + drive_file_id only - never a Drive URL.

import {
  evaluateGate,
  isProjectStage,
  nextStage,
  type GateVerdict,
  type ProjectFacts,
  type ProjectStage,
} from '../identity/stage-gates';
import {
  RESTRICTED_PRIVACY_CLASSES,
  type DocumentType,
} from '../documents/types';
import {
  DEEP_LINKS,
  attentionEvidenceRefs,
  bounded,
  bool,
  num,
  parseMs,
  str,
  strOrNull,
  type ReadState,
  type Row,
  type Severity,
} from './types';

export type ProjectScope = 'owner' | 'restricted';

export interface ProjectTruthInput {
  now: string;
  scope: ProjectScope;
  project: Row | null;
  client: Row | null;
  property: Row | null;
  stage: string | null;
  facts: ProjectFacts | null;
  messages: Row[];
  commEvents: Row[];
  quotes: Row[];
  quoteVersions: Row[];
  documents: Row[];
  appointments: Row[];
  measurements: Row[];
  payments: Row[];
  paymentExpectations: Row[];
  contracts: Row[];
  orders: Row[];
  poPackages: Row[];
  receiving: Row[];
  installEvents: Row[];
  installStates: Row[];
  punchItems: Row[];
  attentionItems: Row[];
  readStates: Record<string, ReadState>;
}

export interface ProjectDocument {
  document_id: string;
  document_type: string;
  document_subtype: string | null;
  canonical_filename: string;
  version: number;
  drive_file_id: string | null;
  authority_class: string;
  privacy_class: string;
  verification_status: string;
  registered_at: string;
}

export interface ProjectBlocker {
  kind: 'gate_predicate' | 'attention' | 'ai_job';
  ref: string;
  title: string;
  severity: Severity;
  due_at: string | null;
  deep_link: string;
}

export interface TimelineEntry {
  at: string;
  kind: string;
  ref: string;
  title: string;
}

export interface ProjectTruth {
  found: boolean;
  generated_at: string;
  project_id: string | null;
  project_code: string | null;
  title: string;
  status: string;
  deep_link: string;
  client: { client_id: string; display_name: string; client_type: string } | null;
  property: {
    property_id: string;
    address_line: string;
    unit: string | null;
    city: string | null;
    lpc_review: boolean;
    dob_permit: boolean;
  } | null;
  stage: {
    current: string | null;
    gate: GateVerdict | null;
    next_stage: string | null;
    next_action: string;
  };
  communications: Array<{
    message_id: string;
    direction: string;
    subject: string;
    from: string;
    received_at: string;
    link_confidence: string;
    ingestion_class: string;
  }>;
  quotes: Array<{
    quote_id: string;
    status: string;
    current_version: number;
    updated_at: string;
    versions: number;
  }>;
  documents: {
    current: ProjectDocument[];
    by_type: Partial<Record<DocumentType, ProjectDocument | null>>;
    restricted_excluded: number;
  };
  appointments: Array<{ ref: string; kind: string; at: string | null; status: string }>;
  measurements: Array<{
    measurement_id: string;
    recorded_at: string | null;
    approved: boolean;
    hash: string | null;
  }>;
  lpc_building: {
    lpc_review: boolean;
    dob_permit: boolean;
    lpc: string;
    dob: string;
    building_approval: string;
    documents: ProjectDocument[];
  };
  payments: {
    events: Array<{ payment_id: string; kind: string; amount_cents: number; at: string }>;
    expectations: Array<{
      expectation_id: string;
      stage: string;
      amount_cents: number;
      status: string;
    }>;
    received_cents: number;
  };
  order: {
    contracts: Array<{ contract_id: string; state: string; signed_at: string | null }>;
    po_packages: Array<{ po_id: string; state: string; hash: string | null }>;
    vendor_orders: Array<{
      order_id: string;
      vendor: string;
      order_number: string | null;
      delivery_status: string;
      backordered: boolean;
    }>;
  };
  delivery: Array<{ ref: string; kind: string; at: string | null; status: string }>;
  install: {
    state: string | null;
    events: Array<{ ref: string; at: string | null; status: string }>;
    punch_open: number;
  };
  blockers: ProjectBlocker[];
  timeline: TimelineEntry[];
  evidence: string[];
  read_states: Record<string, ReadState>;
  unreadable: string[];
}

const MAX_TIMELINE = 200;
const MAX_LIST = 100;

// Document types that answer "show me the current X" directly.
export const PRIMARY_DOCUMENT_TYPES: readonly DocumentType[] = [
  'proposal',
  'contract',
  'vendor_quote',
  'purchase_order',
  'order_confirmation',
  'measurement',
  'lpc_dob_building',
  'payment_receipt',
];

function projectDocument(r: Row): ProjectDocument {
  return {
    document_id: str(r, 'id'),
    document_type: str(r, 'document_type'),
    document_subtype: strOrNull(r, 'document_subtype'),
    canonical_filename: bounded(r['canonical_filename'], 200),
    version: num(r, 'version'),
    drive_file_id: strOrNull(r, 'drive_file_id'),
    authority_class: str(r, 'authority_class'),
    privacy_class: str(r, 'privacy_class'),
    verification_status: str(r, 'verification_status'),
    registered_at: str(r, 'registered_at'),
  };
}

// Highest version wins; ties resolve to the latest registration.
function newer(a: ProjectDocument, b: ProjectDocument): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.registered_at > b.registered_at;
}

function selectDocuments(rows: Row[], scope: ProjectScope) {
  const restricted = new Set<string>(RESTRICTED_PRIVACY_CLASSES);
  let excluded = 0;
  const current: ProjectDocument[] = [];
  for (const r of rows) {
    if (r['is_current'] === false) continue;
    const privacy = str(r, 'privacy_class');
    // EXCLUDE is never surfaced to anyone; other restricted classes
    // require owner scope.
    if (privacy === 'EXCLUDE' || (scope !== 'owner' && restricted.has(privacy))) {
      excluded += 1;
      continue;
    }
    current.push(projectDocument(r));
  }
  current.sort((a, b) => {
    if (a.document_type !== b.document_type) {
      return a.document_type < b.document_type ? -1 : 1;
    }
    return newer(a, b) ? -1 : 1;
  });
  const byType: Partial<Record<DocumentType, ProjectDocument | null>> = {};
  for (const t of PRIMARY_DOCUMENT_TYPES) byType[t] = null;
  for (const d of current) {
    const t = d.document_type as DocumentType;
    const prev = byType[t];
    if (!prev || newer(d, prev)) byType[t] = d;
  }
  return { current: current.slice(0, MAX_LIST), by_type: byType, restricted_excluded: excluded };
}

function evaluateStage(stage: string | null, facts: ProjectFacts | null) {
  if (!stage || !isProjectStage(stage) || !facts) {
    return {
      current: stage,
      gate: null,
      next_stage: stage && isProjectStage(stage) ? nextStage(stage) : null,
      next_action: stage ? 'stage_facts_unavailable' : 'stage_unknown',
    };
  }
  const next = nextStage(stage as ProjectStage);
  // The blocking question is about the NEXT stage's gate: what is missing
  // before the project may advance.
  const gate = next ? evaluateGate(next, facts) : evaluateGate(stage, facts);
  const nextAction = !next
    ? 'project_closed'
    : gate.ok
      ? 'advance_to_' + next
      : 'satisfy_' + gate.failed_predicates[0];
  return { current: stage, gate, next_stage: next, next_action: nextAction };
}

function timelineOf(input: ProjectTruthInput, docs: ProjectDocument[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const add = (at: unknown, kind: string, ref: string, title: unknown) => {
    if (typeof at !== 'string' || parseMs(at) === null) return;
    out.push({ at, kind, ref, title: bounded(title, 160) });
  };
  for (const m of input.messages) {
    add(m['received_at'], 'message:' + str(m, 'direction'),
      'message:' + str(m, 'id'), str(m, 'subject'));
  }
  for (const e of input.commEvents) {
    add(e['occurred_at'], 'event:' + str(e, 'event_type'),
      'event:' + str(e, 'id'), str(e, 'event_type'));
  }
  for (const d of docs) {
    add(d.registered_at, 'document:' + d.document_type,
      'document:' + d.document_id, d.canonical_filename + ' v' + d.version);
  }
  for (const p of input.payments) {
    add(p['created_at'], 'payment:' + str(p, 'kind'),
      'payment:' + str(p, 'id'), str(p, 'kind') + ' ' + num(p, 'amount_cents'));
  }
  for (const c of input.contracts) {
    add(c['signed_at'] ?? c['updated_at'], 'contract:' + str(c, 'state'),
      'contract:' + str(c, 'id'), str(c, 'state'));
  }
  for (const m of input.measurements) {
    add(m['recorded_at'], 'measurement', 'measurement:' + str(m, 'id'),
      bool(m, 'approved') ? 'final measure approved' : 'final measure recorded');
  }
  for (const o of input.orders) {
    add(o['order_date'], 'order:placed', 'vendor_order:' + str(o, 'id'),
      str(o, 'vendor') + ' ' + str(o, 'order_number'));
    add(o['actual_ship_date'], 'order:shipped', 'vendor_order:' + str(o, 'id'),
      str(o, 'vendor') + ' shipped');
  }
  for (const r of input.receiving) {
    add(r['received_at'] ?? r['created_at'], 'receiving',
      'receiving:' + str(r, 'id'), str(r, 'kind') || 'received');
  }
  for (const a of input.appointments) {
    add(a['due_date'] ?? a['scheduled_at'], 'appointment:' + str(a, 'kind'),
      'milestone:' + str(a, 'id'), str(a, 'kind') + ' ' + str(a, 'status'));
  }
  for (const i of input.installEvents) {
    add(i['scheduled_date'], 'install:' + str(i, 'status'),
      'install:' + str(i, 'id'), str(i, 'status'));
  }
  for (const a of input.attentionItems) {
    add(a['first_seen_at'], 'attention:' + str(a, 'item_type'),
      'attention:' + str(a, 'id'), str(a, 'subject'));
  }
  out.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });
  return out.slice(0, MAX_TIMELINE);
}

function blockersOf(
  gate: GateVerdict | null,
  attention: Row[],
  nowMs: number,
  projectRef: string,
): ProjectBlocker[] {
  const out: ProjectBlocker[] = [];
  if (gate && !gate.ok) {
    for (const p of gate.failed_predicates) {
      out.push({
        kind: 'gate_predicate',
        ref: 'gate:' + gate.stage + ':' + p,
        title: 'gate ' + gate.stage + ' requires ' + p,
        severity: 'high',
        due_at: null,
        deep_link: DEEP_LINKS.project(projectRef),
      });
    }
  }
  for (const a of attention) {
    if (str(a, 'status') !== 'open') continue;
    const type = str(a, 'item_type');
    if (type === 'OPPORTUNITY') continue;
    const due = strOrNull(a, 'due_at');
    const dueMs = parseMs(due);
    const overdue = dueMs !== null && dueMs < nowMs;
    out.push({
      kind: 'attention',
      ref: 'attention:' + str(a, 'id'),
      title: bounded(type + ': ' + (str(a, 'subject') || str(a, 'detector')), 200),
      severity: type === 'RISK' || overdue ? 'high' : 'normal',
      due_at: due,
      deep_link: DEEP_LINKS.attention(str(a, 'id'), projectRef),
    });
  }
  out.sort((a, b) => {
    const rank = { critical: 0, high: 1, normal: 2 } as const;
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });
  return out;
}

export function buildProjectTruth(
  projectRef: string,
  input: ProjectTruthInput,
): ProjectTruth {
  const nowMs = Date.parse(input.now);
  const unreadable = Object.entries(input.readStates)
    .filter(([, s]) => s !== 'ok' && s !== 'empty')
    .map(([k]) => k)
    .sort();
  const p = input.project;
  const projectId = p ? strOrNull(p, 'id') : null;
  const projectCode = p ? strOrNull(p, 'project_code') : null;
  const ref = projectCode ?? projectId ?? projectRef;
  const docs = selectDocuments(input.documents, input.scope);
  const stage = evaluateStage(input.stage, input.facts);
  const facts = input.facts;
  const property = input.property;
  const lpcDocs = docs.current.filter((d) => d.document_type === 'lpc_dob_building');
  const evidence = new Set<string>();
  for (const d of docs.current) evidence.add('document:' + d.document_id);
  for (const m of input.messages.slice(0, MAX_LIST)) evidence.add('message:' + str(m, 'id'));
  for (const a of input.attentionItems) {
    for (const e of attentionEvidenceRefs(a['evidence'])) evidence.add(e);
  }
  const received = input.payments
    .filter((e) => /received|deposit|payment/i.test(str(e, 'kind')) &&
      !/refund|expected/i.test(str(e, 'kind')))
    .reduce((sum, e) => sum + num(e, 'amount_cents'), 0);

  return {
    found: p !== null,
    generated_at: input.now,
    project_id: projectId,
    project_code: projectCode,
    title: bounded(p ? p['title'] : '', 200),
    status: p ? str(p, 'status') : 'not_found',
    deep_link: DEEP_LINKS.project(ref),
    client: input.client ? {
      client_id: str(input.client, 'id'),
      display_name: bounded(input.client['display_name'], 120),
      client_type: str(input.client, 'client_type'),
    } : null,
    property: property ? {
      property_id: str(property, 'id'),
      address_line: bounded(property['address_line'], 160),
      unit: strOrNull(property, 'unit'),
      city: strOrNull(property, 'city'),
      lpc_review: bool(property, 'lpc_review'),
      dob_permit: bool(property, 'dob_permit'),
    } : null,
    stage,
    communications: input.messages.slice(0, MAX_LIST).map((m) => ({
      message_id: str(m, 'id'),
      direction: str(m, 'direction'),
      subject: bounded(m['subject'], 160),
      from: bounded(m['from_address_norm'], 120),
      received_at: str(m, 'received_at'),
      link_confidence: str(m, 'link_confidence'),
      ingestion_class: str(m, 'ingestion_class'),
    })),
    quotes: input.quotes.slice(0, MAX_LIST).map((q) => ({
      quote_id: str(q, 'id'),
      status: str(q, 'status'),
      current_version: num(q, 'current_version'),
      updated_at: str(q, 'updated_at'),
      versions: input.quoteVersions
        .filter((v) => str(v, 'quote_id') === str(q, 'id')).length,
    })),
    documents: docs,
    appointments: input.appointments.slice(0, MAX_LIST).map((a) => ({
      ref: 'milestone:' + str(a, 'id'),
      kind: str(a, 'kind'),
      at: strOrNull(a, 'due_date') ?? strOrNull(a, 'scheduled_at'),
      status: str(a, 'status'),
    })),
    measurements: input.measurements.slice(0, MAX_LIST).map((m) => ({
      measurement_id: str(m, 'id'),
      recorded_at: strOrNull(m, 'recorded_at'),
      approved: bool(m, 'approved'),
      hash: strOrNull(m, 'measurement_hash') ?? strOrNull(m, 'hash'),
    })),
    lpc_building: {
      lpc_review: property ? bool(property, 'lpc_review') : false,
      dob_permit: property ? bool(property, 'dob_permit') : false,
      lpc: facts ? facts.lpc : 'unknown',
      dob: facts ? facts.dob : 'unknown',
      building_approval: facts ? facts.building_approval : 'unknown',
      documents: lpcDocs,
    },
    payments: {
      events: input.payments.slice(0, MAX_LIST).map((e) => ({
        payment_id: str(e, 'id'),
        kind: str(e, 'kind'),
        amount_cents: num(e, 'amount_cents'),
        at: str(e, 'created_at'),
      })),
      expectations: input.paymentExpectations.slice(0, MAX_LIST).map((e) => ({
        expectation_id: str(e, 'id'),
        stage: str(e, 'stage'),
        amount_cents: num(e, 'amount_cents'),
        status: str(e, 'status'),
      })),
      received_cents: received,
    },
    order: {
      contracts: input.contracts.slice(0, MAX_LIST).map((c) => ({
        contract_id: str(c, 'id'),
        state: str(c, 'state'),
        signed_at: strOrNull(c, 'signed_at'),
      })),
      po_packages: input.poPackages.slice(0, MAX_LIST).map((c) => ({
        po_id: str(c, 'id'),
        state: str(c, 'state'),
        hash: strOrNull(c, 'package_hash') ?? strOrNull(c, 'hash'),
      })),
      vendor_orders: input.orders.slice(0, MAX_LIST).map((o) => ({
        order_id: str(o, 'id'),
        vendor: str(o, 'vendor'),
        order_number: strOrNull(o, 'order_number'),
        delivery_status: str(o, 'delivery_status'),
        backordered: bool(o, 'backordered'),
      })),
    },
    delivery: input.receiving.slice(0, MAX_LIST).map((r) => ({
      ref: 'receiving:' + str(r, 'id'),
      kind: str(r, 'kind'),
      at: strOrNull(r, 'received_at') ?? strOrNull(r, 'created_at'),
      status: str(r, 'status') || str(r, 'condition'),
    })),
    install: {
      state: input.installStates.length > 0
        ? str(input.installStates[0], 'state') : null,
      events: input.installEvents.slice(0, MAX_LIST).map((i) => ({
        ref: 'install:' + str(i, 'id'),
        at: strOrNull(i, 'scheduled_date'),
        status: str(i, 'status'),
      })),
      punch_open: input.punchItems
        .filter((x) => str(x, 'status') !== 'resolved' && !x['resolved_at']).length,
    },
    blockers: blockersOf(stage.gate, input.attentionItems, nowMs, ref),
    timeline: timelineOf(input, docs.current),
    evidence: [...evidence].sort().slice(0, MAX_TIMELINE),
    read_states: input.readStates,
    unreadable,
  };
}
