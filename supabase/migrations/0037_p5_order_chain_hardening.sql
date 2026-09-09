-- Phase 5 safe order-chain hardening. OWNER-APPLIED, staging first.
-- State/evidence only: no send, payment, refund, or order-placement function.

alter table public.contracts
  add column if not exists included_forms text[] not null default '{}';
alter table public.contracts
  drop constraint if exists contracts_issued_bindings_required;
alter table public.contracts
  add constraint contracts_issued_bindings_required check (
    state = 'drafted' or
    (quote_version_id is not null and payload_hash ~ '^[0-9a-f]{64}$')
  ) not valid;

create or replace function public.guard_contract_state_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id or
     new.quote_version_id is distinct from old.quote_version_id or
     new.template_id is distinct from old.template_id or
     new.template_sha256 is distinct from old.template_sha256 or
     new.payload_hash is distinct from old.payload_hash or
     new.included_forms is distinct from old.included_forms or
     new.provider is distinct from old.provider then
    raise exception 'contract issuance bindings are immutable';
  end if;
  if old.provider_envelope_id is not null and
     new.provider_envelope_id is distinct from old.provider_envelope_id then
    raise exception 'contract envelope binding is immutable once set';
  end if;
  if (old.signed_at is not null or old.provider_event_verified) and
     (new.signed_at is distinct from old.signed_at or
      new.provider_event_verified is distinct from old.provider_event_verified) then
    raise exception 'contract signature evidence is immutable once set';
  end if;
  if not (
    new.state = old.state or
    (old.state = 'drafted' and
     new.state in ('sent','voided','expired','superseded')) or
    (old.state = 'sent' and
     new.state in ('viewed','completed','voided','expired','superseded')) or
    (old.state = 'viewed' and
     new.state in ('completed','voided','expired','superseded')) or
    (old.state = 'completed' and new.state = 'superseded')
  ) then
    raise exception 'invalid contract state transition';
  end if;
  if new.state in ('sent','viewed','completed') and not exists (
    select 1 from public.contract_templates t
    where t.id = new.template_id
      and t.is_current = true
      and t.approved_by is not null
      and t.approved_at is not null
      and t.sha256 = new.template_sha256
      and t.required_forms <@ new.included_forms
  ) then
    raise exception 'current approved template and required forms are required';
  end if;
  if new.state = 'completed' and not exists (
    select 1 from public.contract_provider_events e
    where e.contract_id = old.id
      and e.event_type = 'envelope-completed'
      and e.verified = true
      and e.occurred_at = new.signed_at
      and e.payload ->> 'provider_envelope_id' = new.provider_envelope_id
  ) then
    raise exception 'verified completion evidence required';
  end if;
  if new.state <> 'completed' and
     (new.provider_event_verified or new.signed_at is not null) and not (
       old.state = 'completed' and new.state = 'superseded' and
       new.provider_event_verified = old.provider_event_verified and
       new.signed_at is not distinct from old.signed_at
     ) then
    raise exception 'signature state requires completed contract';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_contract_state_update on public.contracts;
create trigger trg_guard_contract_state_update
before update on public.contracts
for each row execute function public.guard_contract_state_update();

create or replace function public.guard_contract_template_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (new.is_current or new.approved_by is not null or
        new.approved_at is not null) and (
        new.approved_by is distinct from auth.uid()::text or
        new.approved_at is null
    ) then
      raise exception 'template approval attribution mismatch';
    end if;
  elsif old.is_current or old.approved_by is not null or
        old.approved_at is not null then
    if new.name is distinct from old.name or
       new.version is distinct from old.version or
       new.sha256 is distinct from old.sha256 or
       new.document_id is distinct from old.document_id or
       new.required_forms is distinct from old.required_forms or
       new.approved_by is distinct from old.approved_by or
       new.approved_at is distinct from old.approved_at or
       new.created_at is distinct from old.created_at or
       (not old.is_current and new.is_current) then
      raise exception 'approved template version is immutable';
    end if;
  elsif (new.is_current is distinct from old.is_current or
         new.approved_by is distinct from old.approved_by or
         new.approved_at is distinct from old.approved_at) and
        (new.is_current or new.approved_by is not null or
         new.approved_at is not null) and (
         new.approved_by is distinct from auth.uid()::text or
         new.approved_at is null
  ) then
      raise exception 'template approval attribution mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_contract_template_approval
  on public.contract_templates;
create trigger trg_guard_contract_template_approval
before insert or update on public.contract_templates
for each row execute function public.guard_contract_template_approval();

create or replace function public.guard_final_measurement_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  contract_signed_at timestamptz;
  earliest_measure_utc timestamp without time zone;
  business_days integer := 0;
begin
  if new.project_id is distinct from old.project_id or
     new.contract_id is distinct from old.contract_id or
     new.version is distinct from old.version or
     new.source is distinct from old.source or
     new.measured_at is distinct from old.measured_at or
     new.measured_by is distinct from old.measured_by or
     new.openings is distinct from old.openings or
     new.sha256 is distinct from old.sha256 or
     new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'final measurement bindings are immutable';
  end if;
  if (old.approved_by is not null or old.approved_at is not null) and
     (new.approved_by is distinct from old.approved_by or
      new.approved_at is distinct from old.approved_at) then
    raise exception 'measurement approval evidence is immutable once set';
  end if;
  if not (
    new.status = old.status or
    (old.status = 'draft' and new.status = 'submitted') or
    (old.status = 'submitted' and new.status = 'approved') or
    (old.status = 'approved' and new.status = 'superseded')
  ) then
    raise exception 'invalid final measurement state transition';
  end if;
  if new.status = 'approved' and (
      new.approved_by is distinct from auth.uid()::text or
      new.approved_at is null
  ) then
    raise exception 'measurement approval attribution mismatch';
  end if;
  if old.status = 'submitted' and new.status = 'approved' then
    select c.signed_at into contract_signed_at
    from public.contracts c
    where c.id = new.contract_id
      and c.project_id = new.project_id
      and c.state = 'completed'
      and c.provider_event_verified = true;
    if contract_signed_at is null then
      raise exception 'authoritative signed contract required';
    end if;
    earliest_measure_utc := contract_signed_at at time zone 'UTC';
    while business_days < 3 loop
      earliest_measure_utc := earliest_measure_utc + interval '1 day';
      if extract(isodow from earliest_measure_utc) < 6 then
        business_days := business_days + 1;
      end if;
    end loop;
    if new.measured_at < earliest_measure_utc at time zone 'UTC' then
      raise exception 'final measurement is earlier than three business days';
    end if;
  end if;
  if new.status <> 'approved' and
     (new.approved_by is not null or new.approved_at is not null) and not (
       old.status = 'approved' and new.status = 'superseded' and
       new.approved_by is not distinct from old.approved_by and
       new.approved_at is not distinct from old.approved_at
     ) then
    raise exception 'measurement approval evidence is invalid';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_final_measurement_update
  on public.final_measurements;
create trigger trg_guard_final_measurement_update
before update on public.final_measurements
for each row execute function public.guard_final_measurement_update();

create or replace function public.guard_change_order_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id or
     new.contract_id is distinct from old.contract_id or
     new.reason is distinct from old.reason or
     new.from_measurement_id is distinct from old.from_measurement_id or
     new.to_measurement_id is distinct from old.to_measurement_id or
     new.delta is distinct from old.delta or
     new.created_at is distinct from old.created_at then
    raise exception 'change order bindings are immutable';
  end if;
  if not (
    new.state = old.state or
    (old.state = 'proposed' and new.state = 'owner_review')
  ) then
    raise exception 'governed change order decision evidence required';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_change_order_update on public.change_orders;
create trigger trg_guard_change_order_update
before update on public.change_orders
for each row execute function public.guard_change_order_update();

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
  expected_amount_cents bigint not null
    check (expected_amount_cents between 0 and 50000000000),
  amount_cents bigint not null check (amount_cents between 1 and 50000000000),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 1 and 256),
  occurred_at timestamptz not null,
  recorded_by text not null check (length(btrim(recorded_by)) between 1 and 256),
  source_ref text not null check (length(btrim(source_ref)) between 1 and 512),
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
alter table public.purchase_order_packages
  drop constraint if exists po_packages_integrity_bindings_required;
alter table public.purchase_order_packages
  add constraint po_packages_integrity_bindings_required check (
    measurement_sha256 is not null and
    measurement_sha256 ~ '^[0-9a-f]{64}$' and
    measurement_version is not null and measurement_version >= 1 and
    template_sha256 is not null and
    template_sha256 ~ '^[0-9a-f]{64}$' and
    product_line is not null and length(btrim(product_line)) > 0 and
    document_sha256 is not null and
    document_sha256 ~ '^[0-9a-f]{64}$'
  ) not valid;
alter table public.purchase_order_packages
  drop constraint if exists po_packages_approval_evidence_required;
alter table public.purchase_order_packages
  add constraint po_packages_approval_evidence_required check (
    state not in ('approved_for_placement','placed_by_owner') or
    (approved_by is not null and approved_at is not null and
     approval_evidence_hash is not null and
     approval_evidence_hash ~ '^[0-9a-f]{64}$')
  ) not valid;

create or replace function public.guard_purchase_order_package_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id or
     new.contract_id is distinct from old.contract_id or
     new.measurement_id is distinct from old.measurement_id or
     new.configuration_hash is distinct from old.configuration_hash or
     new.po_hash is distinct from old.po_hash or
     new.document_id is distinct from old.document_id or
     new.vendor is distinct from old.vendor or
     new.line_items is distinct from old.line_items or
     new.sold_to is distinct from old.sold_to or
     new.ship_to is distinct from old.ship_to or
     new.prepared_at is distinct from old.prepared_at or
     new.measurement_sha256 is distinct from old.measurement_sha256 or
     new.measurement_version is distinct from old.measurement_version or
     new.template_sha256 is distinct from old.template_sha256 or
     new.product_line is distinct from old.product_line or
     new.document_sha256 is distinct from old.document_sha256 then
    raise exception 'purchase order package bindings are immutable';
  end if;
  if not (
    new.state = old.state or
    (old.state = 'prepared' and new.state in ('owner_review','cancelled')) or
    (old.state = 'owner_review' and new.state = 'cancelled')
  ) then
    raise exception 'governed purchase order approval evidence required';
  end if;
  if new.approved_by is not null or new.approved_at is not null or
     new.approval_evidence_hash is not null or new.placed_at is not null then
    raise exception 'purchase order approval persistence is not enabled';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_purchase_order_package_update
  on public.purchase_order_packages;
create trigger trg_guard_purchase_order_package_update
before update on public.purchase_order_packages
for each row execute function public.guard_purchase_order_package_update();

-- Runtime may create drafts/evidence, never owner-approved state.
drop policy if exists contracts_owner_runtime_ins on public.contracts;
create policy contracts_owner_runtime_ins
  on public.contracts for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
    state = 'drafted' and provider_envelope_id is null and
    signed_at is null and provider_event_verified = false
  );

drop policy if exists contract_templates_owner_runtime_ins
  on public.contract_templates;
create policy contract_templates_owner_runtime_ins
  on public.contract_templates for insert to authenticated
  with check (
    (public.is_owner() and (
      (not is_current and approved_by is null and approved_at is null) or
      (approved_by = auth.uid()::text and approved_at is not null)
    )) or
    (public.is_runtime_service() and not is_current and
     approved_by is null and approved_at is null)
  );

drop policy if exists payment_expectations_owner_runtime_ins
  on public.payment_expectations;
create policy payment_expectations_owner_runtime_ins
  on public.payment_expectations for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
    state = 'expected' and
     received_cents = 0 and reconciliation_state = 'unreconciled' and
     quote_version_id is not null and quote_hash ~ '^[0-9a-f]{64}$'
  );
drop policy if exists payment_expectations_owner_runtime_upd
  on public.payment_expectations;
drop policy if exists payment_expectations_owner_upd
  on public.payment_expectations;
-- No authenticated UPDATE: payment state is derived from append-only receipt
-- facts. Owner waiver/reconciliation requires a separately evidenced path.

drop policy if exists final_measurements_owner_runtime_ins
  on public.final_measurements;
create policy final_measurements_owner_runtime_ins
  on public.final_measurements for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
    status <> 'approved' and approved_by is null and approved_at is null
  );
drop policy if exists final_measurements_owner_runtime_upd
  on public.final_measurements;
create policy final_measurements_owner_upd
  on public.final_measurements for update to authenticated
  using (public.is_owner())
  with check (
    public.is_owner() and
    (status <> 'approved' or approved_by = auth.uid()::text)
  );
create policy final_measurements_runtime_upd
  on public.final_measurements for update to authenticated
  using (public.is_runtime_service() and status <> 'approved')
  with check (public.is_runtime_service() and status <> 'approved');

drop policy if exists change_orders_owner_runtime_ins on public.change_orders;
create policy change_orders_owner_runtime_ins
  on public.change_orders for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
    state in ('proposed','owner_review')
  );
drop policy if exists change_orders_owner_runtime_upd on public.change_orders;
create policy change_orders_owner_upd
  on public.change_orders for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy change_orders_runtime_upd
  on public.change_orders for update to authenticated
  using (public.is_runtime_service() and state in ('proposed','owner_review'))
  with check (
    public.is_runtime_service() and state in ('proposed','owner_review')
  );

drop policy if exists purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_runtime_ins
  on public.purchase_order_packages for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
     state = 'prepared' and
     approved_by is null and approved_at is null and placed_at is null and
     measurement_sha256 ~ '^[0-9a-f]{64}$' and
     measurement_version >= 1 and
     template_sha256 ~ '^[0-9a-f]{64}$' and
     length(btrim(product_line)) > 0 and
     document_sha256 ~ '^[0-9a-f]{64}$' and
     approval_evidence_hash is null
  );
drop policy if exists purchase_order_packages_owner_upd
  on public.purchase_order_packages;
create policy purchase_order_packages_owner_upd
  on public.purchase_order_packages for update to authenticated
  using (public.is_owner())
  with check (
    public.is_owner() and (
      state not in ('approved_for_placement','placed_by_owner') or
      approved_by = auth.uid()::text
    )
  );

alter table public.payment_receipt_events enable row level security;
create policy payment_receipt_events_owner_runtime_sel
  on public.payment_receipt_events for select to authenticated
  using (public.is_owner() or public.is_runtime_service());
create policy payment_receipt_events_owner_runtime_ins
  on public.payment_receipt_events for insert to authenticated
  with check (
    (public.is_owner() or public.is_runtime_service()) and
    recorded_by = auth.uid()::text and
    exists (
      select 1 from public.payment_expectations p
      where p.project_id = payment_receipt_events.project_id
        and p.contract_id = payment_receipt_events.contract_id
        and p.quote_version_id = payment_receipt_events.quote_version_id
        and p.milestone = payment_receipt_events.milestone
        and p.quote_hash = payment_receipt_events.quote_hash
        and p.expected_amount_cents =
          payment_receipt_events.expected_amount_cents
    )
  );
revoke all on public.payment_receipt_events from anon;
revoke all on public.payment_receipt_events from authenticated;
grant select, insert on public.payment_receipt_events to authenticated;
