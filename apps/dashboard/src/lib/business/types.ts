// Business Command Center V1 - domain types.
// Mirrors supabase/migrations/0009_phase6b_business_foundation.sql.
// All money values are integer cents (bigint columns -> number here;
// values are validated to be safe integers). All rates are integer
// milli-percent (thousandths of a percent) over the fixed
// denominator 100000: 8875 = 8.875 percent, so the NYC total is
// subtotal * (100000 + 8875) / 100000 - exactly the owner-ruled
// 1.08875 multiplier (Verification Register V2).

export type ClientType =
  | 'residential'
  | 'commercial'
  | 'institution'
  | 'other';

export type Region = 'NYC' | 'NJ' | 'OTHER';

export type LeadStage =
  | 'lead'
  | 'qualified'
  | 'site_visit'
  | 'quote_requested'
  | 'quote_drafted'
  | 'quote_sent'
  | 'follow_up'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'deferred';

export const LEAD_STAGES: LeadStage[] = [
  'lead',
  'qualified',
  'site_visit',
  'quote_requested',
  'quote_drafted',
  'quote_sent',
  'follow_up',
  'negotiation',
  'won',
  'lost',
  'deferred',
];

export type QuoteStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'archived';

export type ScopeType = 'installation' | 'product_only';

// Only these two jurisdictions are supported. NYC 8.875 pct is
// owner-ruled (Verification Register V2). NJ 6.625 pct is canonical
// per the Phase 6 master goal, with register ruling V5 pending, so
// every NJ draft carries an owner-confirmation assumption flag.
export type Jurisdiction = 'NYC' | 'NJ';

// Fixed rate denominator: rates are milli-percent over 100000.
export const RATE_DENOMINATOR = 100000;

export const TAX_RATE_MILLI_PCT: Record<Jurisdiction, number> = {
  NYC: 8875,
  NJ: 6625,
};

export type MarkupMode = 'none' | 'percent_milli' | 'fixed_cents';

export type PaymentScheduleType =
  | 'installation_50_25_25'
  | 'product_only_75_25';

export type ProjectStatus =
  | 'pending_contract'
  | 'contracted'
  | 'in_progress'
  | 'punch_list'
  | 'final_inspection'
  | 'closed'
  | 'cancelled';

export type MilestoneKind =
  | 'contract'
  | 'deposit'
  | 'measurement'
  | 'ordering'
  | 'permit_lpc'
  | 'permit_dob'
  | 'delivery'
  | 'installation'
  | 'punch_list'
  | 'final_inspection'
  | 'final_payment'
  | 'warranty_closeout';

export type MilestoneStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'not_applicable';

export type DeliveryStatus =
  | 'not_ordered'
  | 'ordered'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'backordered'
  | 'exception';

export type InstallationStatus =
  | 'tentative'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'rescheduled'
  | 'cancelled';

export type PaymentEventKind =
  | 'deposit_recorded'
  | 'payment_recorded'
  | 'adjustment_recorded';

export type CommunicationChannel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'phone'
  | 'in_person'
  | 'other';

export type CommunicationDirection = 'inbound' | 'outbound_draft';

export type MessageState = 'draft' | 'received' | 'logged';

export type RecommendationKind =
  | 'quote_follow_up'
  | 'missing_payment'
  | 'stalled_project'
  | 'delayed_order'
  | 'installation_risk'
  | 'missing_document'
  | 'margin_anomaly'
  | 'client_response';

export type RecommendationConfidence = 'low' | 'medium' | 'high';

export type RecommendationStatus =
  | 'open'
  | 'acknowledged'
  | 'dismissed'
  | 'superseded';

export type QuoteDraftRunStatus =
  | 'completed'
  | 'failed_validation'
  | 'failed_error';

export type ApprovalLinkKind =
  | 'quote_draft_approval'
  | 'communication_approval'
  | 'data_change_proposal'
  | 'agent_recommendation';

export type SimulationState = 'simulation';

export interface Provenanced {
  source: string;
  source_record_id?: string | null;
  provenance: Record<string, unknown>;
}

export interface BusinessClient extends Provenanced {
  id: string;
  display_name: string;
  client_type: ClientType;
  primary_email?: string | null;
  primary_phone?: string | null;
  notes?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessContact extends Provenanced {
  id: string;
  client_id: string;
  full_name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessProperty extends Provenanced {
  id: string;
  client_id?: string | null;
  address_line: string;
  unit?: string | null;
  city?: string | null;
  region: Region;
  postal_code?: string | null;
  lpc_review: boolean;
  dob_permit: boolean;
  access_notes?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface SalesLead extends Provenanced {
  id: string;
  client_id?: string | null;
  property_id?: string | null;
  display_name: string;
  stage: LeadStage;
  stage_changed_at: string;
  lead_source?: string | null;
  owner_next_action?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Quote extends Provenanced {
  id: string;
  client_id: string;
  property_id?: string | null;
  lead_id?: string | null;
  project_id?: string | null;
  title: string;
  status: QuoteStatus;
  current_version: number;
  approval_id?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentStage {
  label: string;
  fraction_milli: number; // milli-percent, e.g. 50000 = 50 percent
  amount_cents: number;
}

export interface PaymentSchedulePlan {
  schedule_type: PaymentScheduleType;
  stages: PaymentStage[];
  total_cents: number;
}

export interface QuoteVersion {
  id: string;
  quote_id: string;
  version: number;
  product_line: string;
  scope_type: ScopeType;
  jurisdiction: Jurisdiction;
  tax_rate_milli_pct: number;
  material_cents: number;
  labor_cents: number;
  fees_cents: number;
  markup_mode: MarkupMode;
  markup_value: number;
  markup_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_cents: number;
  payment_schedule: PaymentSchedulePlan | Record<string, never>;
  assumptions: string[];
  exclusions: string[];
  missing_fields: string[];
  owner_confirmation_required: boolean;
  st124_tracking: Record<string, unknown>;
  draft_provenance: Record<string, unknown>;
  simulation_state: SimulationState;
  approval_id?: string | null;
  correlation_id: string;
  created_by: string;
  created_at: string;
}

export interface QuoteItem {
  id: string;
  quote_version_id: string;
  position: number;
  opening_label: string;
  product_line: string;
  description: string;
  quantity: number;
  unit_material_cents: number;
  unit_labor_cents: number;
  line_fees_cents: number;
  line_total_cents: number;
  item_flags: string[];
  created_at: string;
}

export interface Project extends Provenanced {
  id: string;
  client_id: string;
  property_id?: string | null;
  quote_id?: string | null;
  title: string;
  status: ProjectStatus;
  contract_status: string;
  deposit_status: string;
  milestone_summary: Record<string, unknown>;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  kind: MilestoneKind;
  status: MilestoneStatus;
  due_date?: string | null;
  completed_at?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorOrder extends Provenanced {
  id: string;
  project_id: string;
  vendor: string;
  order_number?: string | null;
  order_date?: string | null;
  expected_ship_date?: string | null;
  actual_ship_date?: string | null;
  delivery_status: DeliveryStatus;
  backordered: boolean;
  exception_note?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface InstallationEvent {
  id: string;
  project_id: string;
  scheduled_date?: string | null;
  crew?: string | null;
  site_ready: boolean;
  status: InstallationStatus;
  note?: string | null;
  source: string;
  provenance: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PaymentScheduleRecord {
  id: string;
  quote_version_id?: string | null;
  project_id?: string | null;
  schedule_type: PaymentScheduleType;
  stages: PaymentStage[];
  total_cents: number;
  created_at: string;
}

export interface PaymentEvent {
  id: string;
  project_id?: string | null;
  quote_id?: string | null;
  kind: PaymentEventKind;
  amount_cents: number;
  method?: string | null;
  recorded_by: string;
  note?: string | null;
  correlation_id: string;
  idempotency_key: string;
  created_at: string;
}

export interface CommunicationRecord {
  id: string;
  client_id?: string | null;
  project_id?: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string;
  summary: string;
  occurred_at: string;
  source_link?: string | null;
  message_state: MessageState;
  approval_id?: string | null;
  source: string;
  provenance: Record<string, unknown>;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessActivityEvent {
  id: string;
  source: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  actor: string;
  provenance: Record<string, unknown>;
  correlation_id: string;
  approval_id?: string | null;
  simulation_state: string;
  idempotency_key: string;
  created_at: string;
}

export interface AgentRecommendation {
  id: string;
  kind: RecommendationKind;
  entity_type: string;
  entity_id: string;
  evidence: string[];
  assumptions: string[];
  confidence: RecommendationConfidence;
  suggested_next_step: string;
  approval_required: boolean;
  status: RecommendationStatus;
  correlation_id: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface QuoteDraftRun {
  id: string;
  agent_name: string;
  input: Record<string, unknown>;
  input_missing_fields: string[];
  quote_id?: string | null;
  quote_version_id?: string | null;
  status: QuoteDraftRunStatus;
  failure_reason?: string | null;
  assumptions: string[];
  simulation_only: true;
  execution_eligible: false;
  correlation_id: string;
  idempotency_key: string;
  created_by: string;
  created_at: string;
}

export interface ApprovalLink {
  id: string;
  approval_id: string;
  entity_type: string;
  entity_id: string;
  link_kind: ApprovalLinkKind;
  created_at: string;
}

// ------------------------------------------------------------
// Small shared validation helpers (pure, deterministic)
// ------------------------------------------------------------

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Max supported money value: 500 million dollars in cents. Inputs
// above this are rejected as implausible rather than risk integer
// precision loss.
export const MAX_MONEY_CENTS = 50_000_000_000;

export function isMoneyCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_MONEY_CENTS
  );
}

export function isJurisdiction(value: unknown): value is Jurisdiction {
  return value === 'NYC' || value === 'NJ';
}

export function isScopeType(value: unknown): value is ScopeType {
  return value === 'installation' || value === 'product_only';
}

export function isMarkupMode(value: unknown): value is MarkupMode {
  return (
    value === 'none' ||
    value === 'percent_milli' ||
    value === 'fixed_cents'
  );
}
