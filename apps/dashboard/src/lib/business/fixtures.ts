// Deterministic Business Command Center fixture dataset.
//
// Purpose: UI setup-mode fallback and test data. Every record is
// clearly labeled as fixture data (source 'fixture', provenance
// fixture:true) so no fabricated record can be presented as real.
// All ids and timestamps are FIXED constants; quote numbers are
// computed by the deterministic quote engine at module load, so
// fixtures can never disagree with the engine.

import { calculateQuote } from './quote-engine';
import type {
  AgentRecommendation,
  BusinessActivityEvent,
  BusinessClient,
  BusinessProperty,
  CommunicationRecord,
  InstallationEvent,
  PaymentEvent,
  Project,
  ProjectMilestone,
  Quote,
  QuoteDraftRun,
  QuoteItem,
  QuoteVersion,
  SalesLead,
  VendorOrder,
} from './types';

const FIX = {
  source: 'fixture',
  provenance: {
    fixture: true,
    note: 'deterministic demo data - not a real business record',
  },
} as const;

const T0 = '2026-07-06T09:00:00.000Z';
const T1 = '2026-07-10T14:30:00.000Z';
const T2 = '2026-07-15T11:00:00.000Z';
const T3 = '2026-07-18T16:45:00.000Z';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const FIXTURE_IDS = {
  clientBrownstone: id(101),
  clientLoft: id(102),
  clientTownhouse: id(103),
  propBrownstone: id(201),
  propLoft: id(202),
  leadBrownstone: id(301),
  leadLoft: id(302),
  leadTownhouse: id(303),
  leadNew1: id(304),
  leadNew2: id(305),
  quoteBrownstone: id(401),
  quoteVersionBrownstone: id(402),
  quoteLoft: id(403),
  quoteVersionLoft: id(404),
  projectBrownstone: id(501),
  orderBrownstone: id(601),
  installBrownstone: id(701),
  runBrownstone: id(801),
} as const;

export const clients: BusinessClient[] = [
  {
    id: FIXTURE_IDS.clientBrownstone,
    display_name: 'Brownstone Rowhouse (fixture)',
    client_type: 'residential',
    primary_email: null,
    primary_phone: null,
    notes: 'Landmark block; LPC review likely.',
    archived: false,
    created_at: T0,
    updated_at: T0,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.clientLoft,
    display_name: 'Tribeca Loft Co-op (fixture)',
    client_type: 'residential',
    primary_email: null,
    primary_phone: null,
    notes: null,
    archived: false,
    created_at: T0,
    updated_at: T0,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.clientTownhouse,
    display_name: 'Jersey City Townhouse (fixture)',
    client_type: 'residential',
    primary_email: null,
    primary_phone: null,
    notes: 'NJ project; tax treatment needs owner review.',
    archived: false,
    created_at: T1,
    updated_at: T1,
    ...FIX,
  },
];

export const properties: BusinessProperty[] = [
  {
    id: FIXTURE_IDS.propBrownstone,
    client_id: FIXTURE_IDS.clientBrownstone,
    address_line: '123 Fixture Street (fixture)',
    unit: null,
    city: 'Brooklyn',
    region: 'NYC',
    postal_code: null,
    lpc_review: true,
    dob_permit: false,
    access_notes: null,
    archived: false,
    created_at: T0,
    updated_at: T0,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.propLoft,
    client_id: FIXTURE_IDS.clientLoft,
    address_line: '45 Fixture Avenue (fixture)',
    unit: '3F',
    city: 'New York',
    region: 'NYC',
    postal_code: null,
    lpc_review: false,
    dob_permit: true,
    access_notes: 'Freight elevator reservation required.',
    archived: false,
    created_at: T0,
    updated_at: T0,
    ...FIX,
  },
];

export const leads: SalesLead[] = [
  {
    id: FIXTURE_IDS.leadBrownstone,
    client_id: FIXTURE_IDS.clientBrownstone,
    property_id: FIXTURE_IDS.propBrownstone,
    display_name: 'Brownstone window replacement (fixture)',
    stage: 'quote_drafted',
    stage_changed_at: T2,
    lead_source: 'referral',
    owner_next_action: 'Review agent quote draft.',
    archived: false,
    created_at: T0,
    updated_at: T2,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.leadLoft,
    client_id: FIXTURE_IDS.clientLoft,
    property_id: FIXTURE_IDS.propLoft,
    display_name: 'Loft casement package (fixture)',
    stage: 'negotiation',
    stage_changed_at: T3,
    lead_source: 'website',
    owner_next_action: 'Follow up on revised scope.',
    archived: false,
    created_at: T0,
    updated_at: T3,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.leadTownhouse,
    client_id: FIXTURE_IDS.clientTownhouse,
    property_id: null,
    display_name: 'JC townhouse product order (fixture)',
    stage: 'site_visit',
    stage_changed_at: T1,
    lead_source: 'repeat_client',
    owner_next_action: 'Schedule measurements.',
    archived: false,
    created_at: T1,
    updated_at: T1,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.leadNew1,
    client_id: null,
    property_id: null,
    display_name: 'Park Slope inquiry (fixture)',
    stage: 'lead',
    stage_changed_at: T3,
    lead_source: 'phone',
    owner_next_action: 'Qualify and book site visit.',
    archived: false,
    created_at: T3,
    updated_at: T3,
    ...FIX,
  },
  {
    id: FIXTURE_IDS.leadNew2,
    client_id: null,
    property_id: null,
    display_name: 'UWS pre-war casements (fixture)',
    stage: 'lost',
    stage_changed_at: T2,
    lead_source: 'website',
    owner_next_action: null,
    archived: false,
    created_at: T0,
    updated_at: T2,
    ...FIX,
  },
];

// Quote numbers computed by the engine so fixtures never drift.
export const brownstoneQuoteInput = {
  scope_type: 'installation',
  jurisdiction: 'NYC',
  quote_fees_cents: 20000,
  items: [
    {
      opening_label: 'W1-W3',
      product_line: 'double-hung',
      description: 'Front facade double-hung, LPC profile',
      quantity: 3,
      unit_material_cents: 120000,
      unit_labor_cents: 45000,
    },
    {
      opening_label: 'D1',
      product_line: 'entry-door',
      description: 'Entry door with transom',
      quantity: 1,
      unit_material_cents: 250000,
      unit_labor_cents: 80000,
      line_fees_cents: 5000,
    },
  ],
  st124_tracking: { st124_claimed: 'owner_to_review' },
  exclusions: ['Interior painting', 'Structural repairs'],
} as const;

export const brownstoneCalc = calculateQuote(brownstoneQuoteInput);

export const loftQuoteInput = {
  scope_type: 'product_only',
  jurisdiction: 'NYC',
  items: [
    {
      opening_label: 'C1-C4',
      product_line: 'casement',
      description: 'Casement package, product only',
      quantity: 4,
      unit_material_cents: 180000,
    },
  ],
  exclusions: ['Installation', 'Disposal'],
} as const;

export const loftCalc = calculateQuote(loftQuoteInput);

export const quotes: Quote[] = [
  {
    id: FIXTURE_IDS.quoteBrownstone,
    client_id: FIXTURE_IDS.clientBrownstone,
    property_id: FIXTURE_IDS.propBrownstone,
    lead_id: FIXTURE_IDS.leadBrownstone,
    project_id: FIXTURE_IDS.projectBrownstone,
    title: 'Brownstone facade windows + entry door (fixture)',
    status: 'pending_approval',
    current_version: 1,
    approval_id: null,
    archived: false,
    created_at: T2,
    updated_at: T2,
    ...FIX,
    source: 'agent_simulation',
  },
  {
    id: FIXTURE_IDS.quoteLoft,
    client_id: FIXTURE_IDS.clientLoft,
    property_id: FIXTURE_IDS.propLoft,
    lead_id: FIXTURE_IDS.leadLoft,
    project_id: null,
    title: 'Loft casement package, product only (fixture)',
    status: 'draft',
    current_version: 1,
    approval_id: null,
    archived: false,
    created_at: T3,
    updated_at: T3,
    ...FIX,
    source: 'agent_simulation',
  },
];

function versionFromCalc(
  versionId: string,
  quoteId: string,
  calc: typeof brownstoneCalc,
  createdAt: string,
  correlation: string,
): QuoteVersion {
  return {
    id: versionId,
    quote_id: quoteId,
    version: 1,
    product_line: calc.items[0]?.product_line ?? '',
    scope_type: calc.scope_type,
    jurisdiction: calc.jurisdiction,
    tax_rate_milli_pct: calc.tax_rate_milli_pct,
    material_cents: calc.material_cents,
    labor_cents: calc.labor_cents,
    fees_cents: calc.fees_cents,
    markup_mode: calc.markup_mode,
    markup_value: calc.markup_value,
    markup_cents: calc.markup_cents,
    subtotal_cents: calc.subtotal_cents,
    tax_cents: calc.tax_cents,
    total_cents: calc.total_cents,
    margin_cents: calc.margin_cents,
    payment_schedule: calc.payment_schedule,
    assumptions: calc.assumptions,
    exclusions: calc.exclusions,
    missing_fields: [],
    owner_confirmation_required: true,
    st124_tracking: calc.st124_tracking,
    draft_provenance: { ...FIX.provenance, engine: 'quote-engine' },
    simulation_state: 'simulation',
    approval_id: null,
    correlation_id: correlation,
    created_by: 'quote-draft-agent',
    created_at: createdAt,
  };
}

export const quoteVersions: QuoteVersion[] = [
  versionFromCalc(
    FIXTURE_IDS.quoteVersionBrownstone,
    FIXTURE_IDS.quoteBrownstone,
    brownstoneCalc,
    T2,
    'fixture:quote:brownstone:v1',
  ),
  versionFromCalc(
    FIXTURE_IDS.quoteVersionLoft,
    FIXTURE_IDS.quoteLoft,
    loftCalc,
    T3,
    'fixture:quote:loft:v1',
  ),
];

export const quoteItems: QuoteItem[] = [
  ...brownstoneCalc.items.map((it, i) => ({
    id: id(410 + i),
    quote_version_id: FIXTURE_IDS.quoteVersionBrownstone,
    position: it.position,
    opening_label: it.opening_label,
    product_line: it.product_line,
    description: it.description,
    quantity: it.quantity,
    unit_material_cents: it.unit_material_cents,
    unit_labor_cents: it.unit_labor_cents,
    line_fees_cents: it.line_fees_cents,
    line_total_cents: it.line_total_cents,
    item_flags: it.item_flags,
    created_at: T2,
  })),
  ...loftCalc.items.map((it, i) => ({
    id: id(420 + i),
    quote_version_id: FIXTURE_IDS.quoteVersionLoft,
    position: it.position,
    opening_label: it.opening_label,
    product_line: it.product_line,
    description: it.description,
    quantity: it.quantity,
    unit_material_cents: it.unit_material_cents,
    unit_labor_cents: it.unit_labor_cents,
    line_fees_cents: it.line_fees_cents,
    line_total_cents: it.line_total_cents,
    item_flags: it.item_flags,
    created_at: T3,
  })),
];

export const projects: Project[] = [
  {
    id: FIXTURE_IDS.projectBrownstone,
    client_id: FIXTURE_IDS.clientBrownstone,
    property_id: FIXTURE_IDS.propBrownstone,
    quote_id: FIXTURE_IDS.quoteBrownstone,
    title: 'Brownstone facade replacement (fixture)',
    status: 'in_progress',
    contract_status: 'signed',
    deposit_status: 'received',
    milestone_summary: {},
    archived: false,
    created_at: T1,
    updated_at: T3,
    ...FIX,
  },
];

export const milestones: ProjectMilestone[] = [
  {
    id: id(510),
    project_id: FIXTURE_IDS.projectBrownstone,
    kind: 'contract',
    status: 'done',
    due_date: null,
    completed_at: T1,
    note: null,
    created_at: T1,
    updated_at: T1,
  },
  {
    id: id(511),
    project_id: FIXTURE_IDS.projectBrownstone,
    kind: 'deposit',
    status: 'done',
    due_date: null,
    completed_at: T1,
    note: null,
    created_at: T1,
    updated_at: T1,
  },
  {
    id: id(512),
    project_id: FIXTURE_IDS.projectBrownstone,
    kind: 'permit_lpc',
    status: 'in_progress',
    due_date: '2026-08-01',
    completed_at: null,
    note: 'LPC filing under review.',
    created_at: T1,
    updated_at: T3,
  },
  {
    id: id(513),
    project_id: FIXTURE_IDS.projectBrownstone,
    kind: 'ordering',
    status: 'done',
    due_date: null,
    completed_at: T2,
    note: null,
    created_at: T1,
    updated_at: T2,
  },
  {
    id: id(514),
    project_id: FIXTURE_IDS.projectBrownstone,
    kind: 'installation',
    status: 'pending',
    due_date: '2026-08-15',
    completed_at: null,
    note: null,
    created_at: T1,
    updated_at: T1,
  },
];

export const vendorOrders: VendorOrder[] = [
  {
    id: FIXTURE_IDS.orderBrownstone,
    project_id: FIXTURE_IDS.projectBrownstone,
    vendor: 'Window Vendor A (fixture)',
    order_number: 'FIX-1001',
    order_date: '2026-07-15',
    expected_ship_date: '2026-08-05',
    actual_ship_date: null,
    delivery_status: 'in_production',
    backordered: false,
    exception_note: null,
    archived: false,
    created_at: T2,
    updated_at: T2,
    ...FIX,
  },
];

export const installationEvents: InstallationEvent[] = [
  {
    id: FIXTURE_IDS.installBrownstone,
    project_id: FIXTURE_IDS.projectBrownstone,
    scheduled_date: '2026-08-15',
    crew: 'Crew 1',
    site_ready: false,
    status: 'tentative',
    note: 'Awaiting LPC approval before confirming.',
    source: 'fixture',
    provenance: FIX.provenance,
    created_at: T2,
    updated_at: T2,
  },
];

export const paymentEvents: PaymentEvent[] = [
  {
    id: id(710),
    project_id: FIXTURE_IDS.projectBrownstone,
    quote_id: FIXTURE_IDS.quoteBrownstone,
    kind: 'deposit_recorded',
    amount_cents: brownstoneCalc.payment_schedule.stages[0].amount_cents,
    method: 'check',
    recorded_by: 'owner',
    note: 'Deposit per 50/25/25 schedule (fixture).',
    correlation_id: 'fixture:payment:brownstone:deposit',
    idempotency_key: 'fixture-payment-brownstone-deposit',
    created_at: T1,
  },
];

export const communications: CommunicationRecord[] = [
  {
    id: id(720),
    client_id: FIXTURE_IDS.clientBrownstone,
    project_id: FIXTURE_IDS.projectBrownstone,
    channel: 'email',
    direction: 'inbound',
    subject: 'LPC timeline question (fixture)',
    summary: 'Client asked when LPC review completes.',
    occurred_at: T3,
    source_link: null,
    message_state: 'received',
    approval_id: null,
    source: 'fixture',
    provenance: FIX.provenance,
    archived: false,
    created_at: T3,
    updated_at: T3,
  },
  {
    id: id(721),
    client_id: FIXTURE_IDS.clientBrownstone,
    project_id: FIXTURE_IDS.projectBrownstone,
    channel: 'email',
    direction: 'outbound_draft',
    subject: 'Re: LPC timeline (fixture draft)',
    summary:
      'DRAFT reply summarizing LPC status. Never sent by the system.',
    occurred_at: T3,
    source_link: null,
    message_state: 'draft',
    approval_id: null,
    source: 'fixture',
    provenance: FIX.provenance,
    archived: false,
    created_at: T3,
    updated_at: T3,
  },
  {
    id: id(722),
    client_id: FIXTURE_IDS.clientLoft,
    project_id: null,
    channel: 'phone',
    direction: 'inbound',
    subject: 'Scope revision call (fixture)',
    summary: 'Client wants to drop one casement from the package.',
    occurred_at: T2,
    source_link: null,
    message_state: 'logged',
    approval_id: null,
    source: 'fixture',
    provenance: FIX.provenance,
    archived: false,
    created_at: T2,
    updated_at: T2,
  },
];

export const recommendations: AgentRecommendation[] = [
  {
    id: id(730),
    kind: 'quote_follow_up',
    entity_type: 'quote',
    entity_id: FIXTURE_IDS.quoteLoft,
    evidence: [
      'Quote draft created and client called about scope revision.',
      'No follow-up recorded in 3 days.',
    ],
    assumptions: ['Client is still deciding; no urgency signal.'],
    confidence: 'medium',
    suggested_next_step:
      'Draft a revised quote version with 3 casements for owner review.',
    approval_required: true,
    status: 'open',
    correlation_id: 'fixture:rec:quote-follow-up',
    idempotency_key: 'fixture-rec-quote-follow-up',
    created_at: T3,
    updated_at: T3,
  },
  {
    id: id(731),
    kind: 'installation_risk',
    entity_type: 'project',
    entity_id: FIXTURE_IDS.projectBrownstone,
    evidence: [
      'Installation tentatively 2026-08-15.',
      'LPC milestone still in progress with due date 2026-08-01.',
    ],
    assumptions: ['LPC review may slip past its due date.'],
    confidence: 'medium',
    suggested_next_step:
      'Confirm LPC status before locking the installation date.',
    approval_required: true,
    status: 'open',
    correlation_id: 'fixture:rec:installation-risk',
    idempotency_key: 'fixture-rec-installation-risk',
    created_at: T3,
    updated_at: T3,
  },
  {
    id: id(732),
    kind: 'missing_payment',
    entity_type: 'project',
    entity_id: FIXTURE_IDS.projectBrownstone,
    evidence: [
      'Deposit recorded; before-installation stage not yet recorded.',
      'Vendor order already in production.',
    ],
    assumptions: [
      'Second stage is typically collected before installation.',
    ],
    confidence: 'low',
    suggested_next_step:
      'Review whether the before-installation payment should be requested.',
    approval_required: true,
    status: 'open',
    correlation_id: 'fixture:rec:missing-payment',
    idempotency_key: 'fixture-rec-missing-payment',
    created_at: T3,
    updated_at: T3,
  },
];

export const quoteDraftRuns: QuoteDraftRun[] = [
  {
    id: FIXTURE_IDS.runBrownstone,
    agent_name: 'quote-draft-agent',
    input: brownstoneQuoteInput as unknown as Record<string, unknown>,
    input_missing_fields: [],
    quote_id: FIXTURE_IDS.quoteBrownstone,
    quote_version_id: FIXTURE_IDS.quoteVersionBrownstone,
    status: 'completed',
    failure_reason: null,
    assumptions: brownstoneCalc.assumptions,
    simulation_only: true,
    execution_eligible: false,
    correlation_id: 'fixture:run:brownstone:v1',
    idempotency_key: 'fixture-run-brownstone-v1',
    created_by: 'owner',
    created_at: T2,
  },
];

export const activityEvents: BusinessActivityEvent[] = [
  {
    id: 'fixture-act-0001',
    source: 'fixture',
    entity_type: 'quote',
    entity_id: FIXTURE_IDS.quoteBrownstone,
    action: 'quote_draft_created',
    summary:
      'Quote draft v1 created by quote-draft-agent (simulation).',
    actor: 'quote-draft-agent',
    provenance: FIX.provenance,
    correlation_id: 'fixture:run:brownstone:v1',
    approval_id: null,
    simulation_state: 'simulation',
    idempotency_key: 'fixture-act-0001',
    created_at: T2,
  },
  {
    id: 'fixture-act-0002',
    source: 'fixture',
    entity_type: 'project',
    entity_id: FIXTURE_IDS.projectBrownstone,
    action: 'payment_recorded',
    summary: 'Deposit recorded against 50/25/25 schedule.',
    actor: 'owner',
    provenance: FIX.provenance,
    correlation_id: 'fixture:payment:brownstone:deposit',
    approval_id: null,
    simulation_state: 'simulation',
    idempotency_key: 'fixture-act-0002',
    created_at: T1,
  },
  {
    id: 'fixture-act-0003',
    source: 'fixture',
    entity_type: 'vendor_order',
    entity_id: FIXTURE_IDS.orderBrownstone,
    action: 'order_status_updated',
    summary: 'Vendor order FIX-1001 moved to in production.',
    actor: 'owner',
    provenance: FIX.provenance,
    correlation_id: 'fixture:order:brownstone',
    approval_id: null,
    simulation_state: 'simulation',
    idempotency_key: 'fixture-act-0003',
    created_at: T2,
  },
];

export interface BusinessFixtureDataset {
  clients: BusinessClient[];
  properties: BusinessProperty[];
  leads: SalesLead[];
  quotes: Quote[];
  quoteVersions: QuoteVersion[];
  quoteItems: QuoteItem[];
  projects: Project[];
  milestones: ProjectMilestone[];
  vendorOrders: VendorOrder[];
  installationEvents: InstallationEvent[];
  paymentEvents: PaymentEvent[];
  communications: CommunicationRecord[];
  recommendations: AgentRecommendation[];
  quoteDraftRuns: QuoteDraftRun[];
  activityEvents: BusinessActivityEvent[];
}

export function buildFixtureDataset(): BusinessFixtureDataset {
  return {
    clients,
    properties,
    leads,
    quotes,
    quoteVersions,
    quoteItems,
    projects,
    milestones,
    vendorOrders,
    installationEvents,
    paymentEvents,
    communications,
    recommendations,
    quoteDraftRuns,
    activityEvents,
  };
}
