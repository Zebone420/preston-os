-- Phase 5 safe order-chain hardening. OWNER-APPLIED, staging first.
-- State/evidence only: no send, payment, refund, or order-placement function.

alter table public.contracts
  add column if not exists included_forms text[] not null default '{}';

alter table public.payment_expectations
  add column if not exists quote_version_id uuid
    references public.quote_versions (id);
alter table public.payment_expectations
  drop constraint if exists payment_expectations_quote_hash_sha256;
alter table public.payment_expectations
  add constraint payment_expectations_quote_hash_sha256
  check (quote_hash ~ '^[0-9a-f]{64}$') not valid;

create unique index if not exists uq_contract_templates_one_current
  on public.contract_templates (name) where is_current;

create table if not exists public.payment_receipt_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  contract_id uuid not null references public.contracts (id),
  quote_version_id uuid not null references public.quote_versions (id),
  milestone text not null
    check (milestone in ('deposit','pre_install','final','pre_order')),
  quote_hash text not null check (quote_hash ~ '^[0-9a-f]{64}$'),
  expected_amount_cents bigint not null check (expected_amount_cents >= 0),
  amount_cents bigint not null check (amount_cents > 0),
  idempotency_key text not null unique,
  occurred_at timestamptz not null,
  recorded_by text not null,
  source_ref text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_receipt_events_contract
  on public.payment_receipt_events (contract_id, milestone, occurred_at);

alter table public.purchase_order_packages
  add column if not exists measurement_sha256 text,
  add column if not exists measurement_version integer,
  add column if not exists template_sha256 text,
  add column if not exists product_line text,
  add column if not exists document_sha256 text,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_evidence_hash text;

-- Runtime may create drafts/evidence, never owner-approved state.
drop policy if exists contract_templates_owner_runtime_ins
  on public.contract_templates;
create policy contract_templates_owner_runtime_ins
  on public.contract_templates for insert to authenticated
  with check (
    public.is_owner() or
    (public.is_runtime_service() and not is_current and
     approved_by is null and approved_at is null)
  );

drop policy if exists payment_expectations_owner_runtime_ins
  on public.payment_expectations;
create policy payment_expectations_owner_runtime_ins
  on public.payment_expectations for insert to authenticated
  with check (
    public.is_owner() or
    (public.is_runtime_service() and state <> 'waived_by_owner')
  );
drop policy if exists payment_expectations_owner_runtime_upd
  on public.payment_expectations;
create policy payment_expectations_owner_upd
  on public.payment_expectations for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy payment_expectations_runtime_upd
  on public.payment_expectations for update to authenticated
  using (public.is_runtime_service() and state <> 'waived_by_owner')
  with check (public.is_runtime_service() and state <> 'waived_by_owner');

drop policy if exists final_measurements_owner_runtime_ins
  on public.final_measurements;
create policy final_measurements_owner_runtime_ins
  on public.final_measurements for insert to authenticated
  with check (
    public.is_owner() or
    (public.is_runtime_service() and status <> 'approved')
  );
drop policy if exists final_measurements_owner_runtime_upd
  on public.final_measurements;
create policy final_measurements_owner_upd
  on public.final_measurements for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy final_measurements_runtime_upd
  on public.final_measurements for update to authenticated
  using (public.is_runtime_service() and status <> 'approved')
  with check (public.is_runtime_service() and status <> 'approved');

drop policy if exists change_orders_owner_runtime_ins on public.change_orders;
create policy change_orders_owner_runtime_ins
  on public.change_orders for insert to authenticated
  with check (
    public.is_owner() or
    (public.is_runtime_service() and state <> 'approved')
  );
drop policy if exists change_orders_owner_runtime_upd on public.change_orders;
create policy change_orders_owner_upd
  on public.change_orders for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy change_orders_runtime_upd
  on public.change_orders for update to authenticated
  using (public.is_runtime_service() and state <> 'approved')
  with check (public.is_runtime_service() and state <> 'approved');

drop policy if exists purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages for insert to authenticated
  with check (
    public.is_owner() or
    (public.is_runtime_service() and state = 'prepared' and
     approved_by is null and approved_at is null and placed_at is null)
  );

alter table public.payment_receipt_events enable row level security;
create policy payment_receipt_events_owner_runtime_sel
  on public.payment_receipt_events for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
create policy payment_receipt_events_owner_runtime_ins
  on public.payment_receipt_events for insert to authenticated
  with check (public.is_owner() or public.is_runtime_service());
revoke all on public.payment_receipt_events from anon;
revoke all on public.payment_receipt_events from authenticated;
grant select, insert on public.payment_receipt_events to authenticated;
