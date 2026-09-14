// Phase 1 Lane A - business field-ownership matrix (plan section 3.3:
// every synchronized field has exactly ONE owner; no ambiguous two-way
// authority). Supabase owns identity, stage, clocks and money; Airtable
// is a mirror surface; Gmail owns message facts; vendor systems own
// their own reference numbers; 'owner' marks human-decided fields.
//
// This constant is the typed twin of the seed rows in migration 0028
// (business_field_ownership). The migration lint test pins the two
// lists to each other. assertWritable is the fail-closed gate every
// sync/ingest writer must call before touching a business column.

export type OwnerSystem =
  | 'supabase'
  | 'airtable'
  | 'gmail'
  | 'drive'
  | 'iqplus'
  | 'owner';

export type SyncDirection =
  | 'none'
  | 'supabase_to_airtable'
  | 'airtable_to_supabase';

export interface FieldOwnership {
  owner_system: OwnerSystem;
  sync_direction: SyncDirection;
  note: string;
}

const S2A: SyncDirection = 'supabase_to_airtable';

export const FIELD_OWNERSHIP: Readonly<Record<string, FieldOwnership>> = {
  'business_clients.display_name': o('supabase', S2A, 'identity'),
  'business_clients.client_type': o('supabase', S2A, 'identity'),
  'business_clients.primary_email': o('supabase', S2A, 'identity'),
  'business_clients.primary_phone': o('supabase', S2A, 'identity'),
  'business_clients.notes': o('owner', 'none', 'owner free text'),
  'business_contacts.full_name': o('supabase', S2A, 'identity'),
  'business_contacts.email': o('supabase', S2A, 'identity'),
  'business_contacts.phone': o('supabase', S2A, 'identity'),
  'business_properties.address_line': o('supabase', S2A, 'identity'),
  'business_properties.unit': o('supabase', S2A, 'identity'),
  'business_properties.city': o('supabase', S2A, 'identity'),
  'business_properties.postal_code': o('supabase', S2A, 'identity'),
  'business_properties.lpc_review': o('owner', S2A, 'owner compliance ruling'),
  'business_properties.dob_permit': o('owner', S2A, 'owner compliance ruling'),
  'sales_leads.stage': o('supabase', S2A, 'stage'),
  'sales_leads.stage_changed_at': o('supabase', S2A, 'clock'),
  'sales_leads.lead_source': o('supabase', S2A, 'identity'),
  'sales_leads.owner_next_action': o('owner', 'none', 'owner free text'),
  'quotes.status': o('supabase', S2A, 'stage'),
  'quotes.current_version': o('supabase', 'none', 'identity'),
  'quote_versions.total_cents': o('supabase', 'none', 'money - never mirrored'),
  'quote_versions.subtotal_cents': o('supabase', 'none', 'money - never mirrored'),
  'projects.project_code': o('supabase', S2A, 'identity - DB-minted only'),
  'projects.status': o('supabase', S2A, 'stage'),
  'projects.stage': o(
    'supabase',
    S2A,
    'stage-gate model stage; column lands with the stage-gate migration',
  ),
  'projects.contract_status': o('supabase', S2A, 'stage'),
  'projects.deposit_status': o('supabase', S2A, 'stage'),
  'projects.milestone_summary': o('supabase', 'none', 'derived'),
  'projects.created_at': o('supabase', 'none', 'clock'),
  'projects.updated_at': o('supabase', 'none', 'clock'),
  'project_milestones.status': o('supabase', S2A, 'stage'),
  'project_milestones.due_date': o('supabase', S2A, 'clock'),
  'project_milestones.completed_at': o('supabase', 'none', 'clock'),
  'vendor_orders.order_number': o(
    'iqplus',
    'none',
    'vendor reference - reconciled, never invented',
  ),
  'vendor_orders.delivery_status': o('supabase', S2A, 'stage'),
  'vendor_orders.expected_ship_date': o('supabase', S2A, 'clock'),
  'installation_events.scheduled_date': o('supabase', S2A, 'clock'),
  'installation_events.status': o('supabase', S2A, 'stage'),
  'payment_schedules.stages': o('supabase', 'none', 'money - never mirrored'),
  'payment_schedules.total_cents': o('supabase', 'none', 'money - never mirrored'),
  'payment_events.amount_cents': o('supabase', 'none', 'money - never mirrored'),
  'communication_records.subject': o('gmail', 'none', 'message fact'),
  'communication_records.occurred_at': o('gmail', 'none', 'message fact'),
  'communication_records.source_link': o('gmail', 'none', 'message fact'),
  'business_activity_events.summary': o('supabase', 'none', 'ledger'),
};

function o(
  owner_system: OwnerSystem,
  sync_direction: SyncDirection,
  note: string,
): FieldOwnership {
  return { owner_system, sync_direction, note };
}

export const OWNER_SYSTEMS: readonly OwnerSystem[] = [
  'supabase',
  'airtable',
  'gmail',
  'drive',
  'iqplus',
  'owner',
] as const;

export function isOwnerSystem(v: unknown): v is OwnerSystem {
  return (
    typeof v === 'string' && (OWNER_SYSTEMS as readonly string[]).includes(v)
  );
}

export type WritableVerdict =
  | { ok: true; owner_system: OwnerSystem }
  | { ok: false; reason: string; owner_system: OwnerSystem | null };

// Fail-closed: an unknown field has no owner and therefore no writer;
// a known field is writable only by its owner system. Airtable can
// never write a supabase_to_airtable field (it is the mirror side).
export function assertWritable(
  fieldPath: string,
  writerSystem: string,
): WritableVerdict {
  const entry = FIELD_OWNERSHIP[fieldPath];
  if (!entry) {
    return {
      ok: false,
      reason: `no ownership entry for ${fieldPath}`,
      owner_system: null,
    };
  }
  if (!isOwnerSystem(writerSystem)) {
    return {
      ok: false,
      reason: `unknown writer system ${writerSystem}`,
      owner_system: entry.owner_system,
    };
  }
  if (writerSystem !== entry.owner_system) {
    return {
      ok: false,
      reason:
        `${fieldPath} is owned by ${entry.owner_system}; ` +
        `${writerSystem} may not write it`,
      owner_system: entry.owner_system,
    };
  }
  return { ok: true, owner_system: entry.owner_system };
}

export function requireWritable(fieldPath: string, writerSystem: string): void {
  const v = assertWritable(fieldPath, writerSystem);
  if (!v.ok) throw new Error(`field_ownership_refused: ${v.reason}`);
}

// Fields a given writer may touch, for sync adapters that need to
// project a payload down to their allowed columns.
export function writableFieldsFor(writerSystem: OwnerSystem): string[] {
  return Object.keys(FIELD_OWNERSHIP)
    .filter((k) => FIELD_OWNERSHIP[k].owner_system === writerSystem)
    .sort();
}

// Fields the Airtable mirror receives from Supabase (read-only there).
export function mirroredToAirtable(): string[] {
  return Object.keys(FIELD_OWNERSHIP)
    .filter((k) => FIELD_OWNERSHIP[k].sync_direction === S2A)
    .sort();
}
