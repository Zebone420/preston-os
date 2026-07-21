-- PRESTON AI OS - Phase 6 OPTIONAL staging fixtures (owner-run).
-- File: supabase/fixtures/business_staging_fixtures.sql
-- NOT a migration. Run manually in the Supabase STAGING SQL editor
-- ONLY IF you want labeled demo rows to exercise the Business
-- Command Center before real data entry. Requires migration 0009.
-- Never run against production. Idempotent: fixed uuids + on
-- conflict do nothing. Every row is labeled source='fixture' with
-- provenance fixture:true so the UI provenance is honest.
-- Remove later by deleting rows whose source = 'fixture' (owner-run
-- cleanup SQL lives in the Phase 6 migration owner packet).

insert into business_clients
  (id, display_name, client_type, notes, source, provenance)
values
  ('00000000-0000-4000-8000-000000000101',
   'Brownstone Rowhouse (fixture)', 'residential',
   'Landmark block; LPC review likely.', 'fixture',
   '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000102',
   'Tribeca Loft Co-op (fixture)', 'residential',
   null, 'fixture', '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000103',
   'Jersey City Townhouse (fixture)', 'residential',
   'NJ project; tax treatment needs owner review.', 'fixture',
   '{"fixture": true}')
on conflict (id) do nothing;

insert into business_properties
  (id, client_id, address_line, unit, city, region, lpc_review,
   dob_permit, source, provenance)
values
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000101',
   '123 Fixture Street (fixture)', null, 'Brooklyn', 'NYC',
   true, false, 'fixture', '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000102',
   '45 Fixture Avenue (fixture)', '3F', 'New York', 'NYC',
   false, true, 'fixture', '{"fixture": true}')
on conflict (id) do nothing;

insert into sales_leads
  (id, client_id, property_id, display_name, stage, lead_source,
   owner_next_action, source, provenance)
values
  ('00000000-0000-4000-8000-000000000301',
   '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000201',
   'Brownstone window replacement (fixture)', 'quote_requested',
   'referral', 'Draft a quote with the agent form.', 'fixture',
   '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000302',
   '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000202',
   'Loft casement package (fixture)', 'negotiation', 'website',
   'Follow up on revised scope.', 'fixture', '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000303',
   '00000000-0000-4000-8000-000000000103', null,
   'JC townhouse product order (fixture)', 'site_visit',
   'repeat_client', 'Schedule measurements.', 'fixture',
   '{"fixture": true}'),
  ('00000000-0000-4000-8000-000000000304', null, null,
   'Park Slope inquiry (fixture)', 'lead', 'phone',
   'Qualify and book site visit.', 'fixture', '{"fixture": true}')
on conflict (id) do nothing;

insert into projects
  (id, client_id, property_id, title, status, contract_status,
   deposit_status, source, provenance)
values
  ('00000000-0000-4000-8000-000000000501',
   '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000201',
   'Brownstone facade replacement (fixture)', 'in_progress',
   'signed', 'received', 'fixture', '{"fixture": true}')
on conflict (id) do nothing;

insert into project_milestones
  (id, project_id, kind, status, due_date, note)
values
  ('00000000-0000-4000-8000-000000000510',
   '00000000-0000-4000-8000-000000000501', 'contract', 'done',
   null, null),
  ('00000000-0000-4000-8000-000000000511',
   '00000000-0000-4000-8000-000000000501', 'deposit', 'done',
   null, null),
  ('00000000-0000-4000-8000-000000000512',
   '00000000-0000-4000-8000-000000000501', 'permit_lpc',
   'in_progress', '2026-08-01', 'LPC filing under review.'),
  ('00000000-0000-4000-8000-000000000514',
   '00000000-0000-4000-8000-000000000501', 'installation',
   'pending', '2026-08-15', null)
on conflict (id) do nothing;

insert into vendor_orders
  (id, project_id, vendor, order_number, order_date,
   expected_ship_date, delivery_status, source, provenance)
values
  ('00000000-0000-4000-8000-000000000601',
   '00000000-0000-4000-8000-000000000501',
   'Window Vendor A (fixture)', 'FIX-1001', '2026-07-15',
   '2026-08-05', 'in_production', 'fixture', '{"fixture": true}')
on conflict (id) do nothing;

insert into installation_events
  (id, project_id, scheduled_date, crew, site_ready, status, note,
   source, provenance)
values
  ('00000000-0000-4000-8000-000000000701',
   '00000000-0000-4000-8000-000000000501', '2026-08-15', 'Crew 1',
   false, 'tentative',
   'Awaiting LPC approval before confirming.', 'fixture',
   '{"fixture": true}')
on conflict (id) do nothing;

-- Verification (owner-run, read-only):
-- select count(*) from business_clients where source = 'fixture';
-- Expect 3. Then open /business on the staging dashboard: the
-- overview should show 4 active leads and 1 active project, and
-- the quote form's client dropdown should list the fixtures.
