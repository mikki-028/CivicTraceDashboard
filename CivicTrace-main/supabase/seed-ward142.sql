-- CivicTrace — Ward 142 modelled seed (initial illustrative dataset).
--
-- Idempotent: safe to run any number of times. Inserts only what is missing,
-- never updates or deletes operational records. Run once in the Supabase SQL
-- editor (owner access bypasses RLS, which is why the browser role cannot
-- insert public.entities rows directly).

begin;

-- 1. Modelled entities (on conflict do nothing).
insert into public.entities (id, entity_type, ward, location) values
  ('BIN-0037', 'Municipal Waste Bin', 'Ward 142', 'Residential Market, Ward 142'),
  ('BIN-0041', 'Municipal Waste Bin', 'Ward 142', 'Main Road, Ward 142'),
  ('BIN-0052', 'Municipal Waste Bin', 'Ward 142', 'Sector 4 Lane, Ward 142'),
  ('BIN-0064', 'Municipal Waste Bin', 'Ward 142', 'Community Park Gate, Ward 142'),
  ('BIN-0078', 'Municipal Waste Bin', 'Ward 142', 'Market Backlane, Ward 142'),
  ('BIN-0081', 'Municipal Waste Bin', 'Ward 142', 'Residential Market, Ward 142'),
  ('BWG-0142', 'Bulk Waste Generator', 'Ward 142', 'Residential Market, Ward 142'),
  ('BWG-0151', 'Bulk Waste Generator', 'Ward 142', 'Sector 4 Lane, Ward 142'),
  ('BWG-0172', 'Bulk Waste Generator', 'Ward 142', 'Main Road, Ward 142'),
  ('BWG-0190', 'Bulk Waste Generator', 'Ward 142', 'Market Backlane, Ward 142')
on conflict (id) do nothing;

-- 2. Complete the modelled service point on entities that have none recorded.
--    Guarded on location is null so a value set by an operator is never overwritten.
update public.entities e set location = v.location
from (values
  ('BIN-0037', 'Residential Market, Ward 142'),
  ('BIN-0041', 'Main Road, Ward 142'),
  ('BIN-0052', 'Sector 4 Lane, Ward 142'),
  ('BIN-0064', 'Community Park Gate, Ward 142'),
  ('BIN-0078', 'Market Backlane, Ward 142'),
  ('BIN-0081', 'Residential Market, Ward 142'),
  ('BWG-0142', 'Residential Market, Ward 142'),
  ('BWG-0151', 'Sector 4 Lane, Ward 142'),
  ('BWG-0172', 'Main Road, Ward 142'),
  ('BWG-0190', 'Market Backlane, Ward 142')
) as v(id, location)
where e.id = v.id and e.location is null;

-- 3. Modelled events. The natural key (source, entity_id, event_type, created_at)
--    makes the insert idempotent without touching existing rows.
insert into public.events (entity_id, event_type, status, issue_type, note, latitude, longitude, employee_number, source, environment, created_at)
select v.entity_id, v.event_type, v.status, v.issue_type, v.note, v.latitude, v.longitude, v.employee_number,
       'website_2_modelled', 'modelled', v.created_at::timestamptz
from (values
  ('BIN-0037', 'installation', null, null, 'Asset installed — 660 L asset commissioned at Residential Market service point · recorded by MCD Works Division', 28.6421, 77.2183, null, '2026-02-14T09:00:00+00:00'),
  ('BIN-0037', 'repair', null, null, 'Repair recorded — Lid hinge replaced after damage', 28.6421, 77.2183, 'MNT-006', '2026-06-09T09:00:00+00:00'),
  ('BWG-0142', 'compliance', null, null, 'Segregation issue observed — Wet and dry streams mixed at handover · recorded by MCD Inspection Cell', 28.6416, 77.2172, null, '2026-07-11T09:00:00+00:00'),
  ('BIN-0037', 'repair', null, null, 'Repair recorded — Body dent repair, third repair on this asset', 28.6421, 77.2183, 'MNT-011', '2026-08-17T09:00:00+00:00'),
  ('BWG-0142', 'compliance', null, null, 'Segregation issue observed — Second recorded instance within the quarter · recorded by MCD Inspection Cell', 28.6416, 77.2172, null, '2026-09-08T09:00:00+00:00'),
  ('BIN-0081', 'installation', null, null, 'Asset installed as replacement — Replaces BIN-0037 at Residential Market service point · recorded by MCD Works Division', 28.6425, 77.2191, null, '2026-09-21T09:00:00+00:00'),
  ('BIN-0037', 'replacement', null, null, 'Replacement asset recorded — BIN-0081 added at the same service point — reason: repeated damage · recorded by MCD Works Division', 28.6421, 77.2183, null, '2026-09-21T09:00:00+00:00'),
  ('BIN-0037', 'collection', 'Recorded', null, 'Collection recorded', 28.6421, 77.2183, 'WKR-019', '2026-09-24T08:12:00+00:00'),
  ('BIN-0037', 'citizen_report', 'Unverified', 'Overflowing', 'Citizen report — Overflowing · recorded by Citizen (QR)', 28.6421, 77.2183, null, '2026-09-24T09:41:00+00:00'),
  ('BIN-0037', 'collection', 'Recorded', null, 'Collection recorded', 28.6421, 77.2183, 'WKR-019', '2026-10-01T08:05:00+00:00'),
  ('BIN-0037', 'citizen_report', 'Unverified', 'Overflowing', 'Citizen report — Overflowing · recorded by Citizen (QR)', 28.6421, 77.2183, null, '2026-10-01T09:26:00+00:00'),
  ('BWG-0172', 'compliance', null, null, 'Segregation issue observed — Event-day waste handed over unsegregated · recorded by MCD Inspection Cell', 28.6453, 77.2217, null, '2026-10-06T12:40:00+00:00'),
  ('BWG-0142', 'collection', 'Recorded', null, 'Collection recorded — Authorised handler pickup · recorded by GreenRoute Waste Services', 28.6416, 77.2172, null, '2026-10-07T07:20:00+00:00'),
  ('BWG-0142', 'citizen_report', 'Unverified', 'Mixed waste observed', 'Citizen report — Mixed waste observed · recorded by Citizen (QR)', 28.6416, 77.2172, null, '2026-10-07T09:55:00+00:00'),
  ('BWG-0172', 'citizen_report', 'Unverified', 'Mixed waste observed', 'Citizen report — Mixed waste observed · recorded by Citizen (QR)', 28.6453, 77.2217, null, '2026-10-07T13:10:00+00:00'),
  ('BWG-0151', 'collection', 'Recorded', null, 'Collection recorded · recorded by GreenRoute Waste Services', 28.6389, 77.2241, null, '2026-10-08T07:05:00+00:00'),
  ('BWG-0142', 'collection', 'Recorded', null, 'Collection recorded · recorded by GreenRoute Waste Services', 28.6416, 77.2172, null, '2026-10-08T07:15:00+00:00'),
  ('BIN-0041', 'collection', 'Recorded', null, 'Collection recorded — Route 07 · Vehicle DL-01-AB-2042', 28.6448, 77.2231, 'WKR-022', '2026-10-08T07:45:00+00:00'),
  ('BIN-0037', 'collection', 'Recorded', null, 'Collection recorded — Route 07 · Vehicle DL-01-AB-2042', 28.6421, 77.2183, 'WKR-019', '2026-10-08T08:10:00+00:00'),
  ('BIN-0081', 'collection', 'Recorded', null, 'Collection recorded', 28.6425, 77.2191, 'WKR-019', '2026-10-08T08:20:00+00:00'),
  ('BWG-0190', 'inspection', null, null, 'Inspection — registration pending — Registration and authorised handler not on record', 28.6401, 77.2196, 'INS-007', '2026-10-08T09:10:00+00:00'),
  ('BIN-0037', 'citizen_report', 'Unverified', 'Overflowing', 'Citizen report — Overflowing · recorded by Citizen (QR)', 28.6421, 77.2183, null, '2026-10-08T09:18:00+00:00'),
  ('BIN-0037', 'citizen_report', 'Unverified', 'Overflowing', 'Citizen report — Overflowing · recorded by Citizen (QR)', 28.6421, 77.2183, null, '2026-10-08T09:32:00+00:00'),
  ('BIN-0037', 'citizen_report', 'Unverified', 'Overflowing', 'Citizen report — Overflowing · recorded by Citizen (QR)', 28.6421, 77.2183, null, '2026-10-08T09:47:00+00:00'),
  ('BIN-0064', 'repair', null, null, 'Maintenance inspection — Fourth repair request raised for this asset', 28.6465, 77.2148, 'MNT-011', '2026-10-08T10:05:00+00:00'),
  ('BIN-0078', 'citizen_report', 'Unverified', 'Improper dumping', 'Citizen report — Improper dumping · recorded by Citizen (QR)', 28.6408, 77.2205, null, '2026-10-08T10:22:00+00:00'),
  ('BIN-0052', 'citizen_report', 'Unverified', 'Waste not collected', 'Citizen report — Waste not collected · recorded by Citizen (QR)', 28.6392, 77.2256, null, '2026-10-08T11:02:00+00:00'),
  ('BWG-0142', 'inspection', null, null, 'Inspection — segregation issue observed — 4-stream requirement not met at time of inspection', 28.6416, 77.2172, 'INS-004', '2026-10-08T11:30:00+00:00'),
  ('BWG-0142', 'citizen_report', 'Unverified', 'Mixed waste observed', 'Citizen report — Mixed waste observed · recorded by Citizen (QR)', 28.6416, 77.2172, null, '2026-10-08T11:52:00+00:00')
) as v(entity_id, event_type, status, issue_type, note, latitude, longitude, employee_number, created_at)
where not exists (
  select 1 from public.events x
  where x.source = 'website_2_modelled'
    and x.entity_id = v.entity_id
    and x.event_type = v.event_type
    and x.created_at = v.created_at::timestamptz
);

commit;

-- ------------------------------------------------------------------ --
-- OPTIONAL (not required for the seed): entity provenance column.
-- public.entities has no source column, so entity rows cannot carry the
-- same provenance envelope as events. The smallest safe extension is an
-- added column with an 'operational' default — existing rows and Website 1
-- behaviour are unchanged, and the modelled ids can be marked illustrative:
--
--   alter table public.entities add column if not exists source text not null default 'operational';
--   update public.entities set source = 'ward142_illustrative'
--     where id in (-- the ten modelled ids --);
--
-- Uncomment only if you want the distinction stored on the entity row itself;
-- the dashboard already labels modelled history through the events envelope.
--
-- OPTIONAL (not required for the seed): REST insert path for this seed tool.
-- With the current policies the publishable key may NOT insert entities at all
-- and may not write the modelled events envelope, so the SQL above is the
-- seeding path. If you prefer `node scripts/seed-ward142.mjs --apply` to work
-- from a machine with only the publishable key, add the matching policies:
--
--   create policy "Modelled seed writes entities" on public.entities for insert to anon
--     with check (ward = 'Ward 142');
--   create policy "Modelled seed writes events" on public.events for insert to anon
--     with check (source = 'website_2_modelled' and environment = 'modelled');
--
-- Both stay append-only: event rows remain immutable, and no existing policy is
-- weakened. This file does not create them — enable deliberately, not by accident.
-- ------------------------------------------------------------------ --
