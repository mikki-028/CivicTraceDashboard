# Ward 142 enriched illustrative dataset

The shared database now carries a comprehensive, interconnected illustrative dataset on top of
the original modelled records — collection histories, citizen reports, inspections, compliance
records, repairs, verifications and the event patterns that raise the dashboard's rule-based
attention flags. Everything is Ward 142, every event carries the established illustrative
envelope (`website_2_modelled` / `modelled`, shown as **ILLUSTRATIVE** in the UI), and nothing
overwrites or deletes existing records.

Generator: [scripts/generate-ward142-enriched.mjs](../scripts/generate-ward142-enriched.mjs) ·
Dataset: [scripts/data/ward142-enriched.json](../scripts/data/ward142-enriched.json) ·
Owner migration: [supabase/seed-ward142-enriched.sql](../supabase/seed-ward142-enriched.sql)

```bash
npm run seed:ward142:enrich          # regenerate dataset + SQL (deterministic)
npm run seed:ward142:enrich:verify   # DB counts, idempotency, flag simulation
npm run seed:ward142:enrich:apply    # insert the REST-permitted subset (reports)
```

## Counts: before → now → after the owner SQL

| Category                         | Before | Now (verified) | After SQL (pending) | Requested target          |
| -------------------------------- | ------ | -------------- | ------------------- | ------------------------- |
| Assets                           | 43     | 43             | 43                  | 40–60 ✓                   |
| BWGs                             | 21     | 21             | 21                  | 15–20 ✓                   |
| Live events (all)                | 50     | 56             | **150**             | 100–150 ✓                 |
| — collections                    | 13     | 13             | **65**              | —                         |
| — citizen reports                | 22     | **28**         | **34**              | 20–30 (4 over, see notes) |
| — compliance                     | 3      | 3              | **13**              | —                         |
| — inspections                    | 4      | 4              | **11**              | —                         |
| — repairs                        | 3      | 3              | **10**              | —                         |
| — installations                  | 2      | 2              | **8**               | —                         |
| — verifications                  | 2      | 2              | **7**               | —                         |
| — replacements                   | 1      | 1              | **2**               | —                         |
| Entities with a service point    | 9      | 9              | **64 (all)**        | —                         |
| Entities with stored coordinates | 11     | **15**         | **44**              | —                         |
| Attention flags (visible)        | 1      | **3**          | **10–11**           | 8–15 ✓                    |

"Now" counts are live in the database and verified through the dashboard. "After SQL" figures are
computed by the generator from the pending 94 events + 55 guarded location updates.

## What was inserted where

**Inserted by the assistant (verified in the database):** six citizen reports under the
`website_2_modelled`/`modelled` envelope — BWG-0002 ×2 (Mixed waste observed), BWG-0006 ×2
(Mixed waste observed), BIN-0006 (Damaged, resolved by a later verification), BIN-0007
(Improper dumping, open). These passed RLS with the publishable key, carry Ward 142 coordinates
and immediately appear on the Reports page and entity timelines.

**Pending owner SQL** (the publishable key is not permitted to insert these shapes — see the RLS
matrix): 94 events (collections, installations, repairs, compliance, inspections, verifications,
the date-critical R1/R2 reports) and 55 guarded `entities.location` backfills. Until this runs,
those categories show their current, smaller values.

## Provenance and idempotency

- Every generated event carries `source='website_2_modelled'`, `environment='modelled'` — the
  existing provenance envelope; the dashboard labels each row **ILLUSTRATIVE** automatically.
- Every event has a deterministic UUID (v5 over a stable key). The SQL uses
  `on conflict (id) do nothing`; the REST path uses `resolution=ignore-duplicates`. Running
  either any number of times inserts nothing new (verified: second `--apply` inserted 0).
- `entities.location` updates are guarded on `location is null` — operator-set values are never
  overwritten.
- No new entities are created: the existing 43 assets and 21 BWGs already satisfy the targets,
  so enrichment is entirely event + location based.

## RLS matrix (verified with constraint probes)

| Envelope                                     | Shapes the publishable key may insert           |
| -------------------------------------------- | ----------------------------------------------- |
| `website_2_modelled` / `modelled`            | `citizen_report` only                           |
| `website_2_dashboard` / `official_dashboard` | all event shapes (operational dashboard writes) |
| `public_qr_website` / `field_test`           | `citizen_report` only                           |
| `entities` INSERT / UPDATE / DELETE          | denied                                          |

That is why the enriched events are split into a REST-insertable subset and an owner migration.

## Flag design (what the SQL activates)

| Entity              | Rule                                                            | Severity (after SQL) | Pattern                                            |
| ------------------- | --------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| BIN-0002            | R1 recurring post-collection overflow                           | attention            | collection today + 2 overflow reports after it     |
| BIN-0003            | R1 (present, but settled by an existing live resolution record) | —                    | collection today + overflow reports                |
| BIN-0004            | R2 collection overdue                                           | attention            | "Not collected" report today, no collection today  |
| BIN-0005            | R2 + scheduled field check                                      | verification bucket  | same signal, escalated                             |
| BIN-0008 / BIN-0009 | R3 high-maintenance asset                                       | maintenance          | 4 and 3 recorded repairs                           |
| BWG-0002 / BWG-0006 | R4 repeated compliance concern                                  | priority             | 2 compliance events + inspection issue + 2 reports |
| BWG-0003            | R4                                                              | attention            | 2 compliance events + inspection issue             |
| BWG-0004            | R4 + scheduled field check                                      | verification bucket  | same signal, escalated                             |
| BWG-0005            | R4                                                              | resolved (hidden)    | concern closed by a recorded verification          |
| BWG-0142            | R4 (existing modelled data)                                     | attention            | carried over from the original dataset             |

Flags are derived, never stored: they are computed by `src/lib/civic/rules.ts` from the event
log, and a verification record with a later timestamp settles them. The generator's `--verify`
mode mirrors those rules and reports the simulated outcome (10 flags: 2 priority, 6 attention,
2 maintenance) before the SQL is even run.

## How to execute the owner migration

1. Open the shared project's SQL editor (Supabase → SQL Editor → New query).
2. Paste the contents of `supabase/seed-ward142-enriched.sql` (idempotent, single transaction).
3. Run it. Expected: `UPDATE 55`, `INSERT 0 94` (or fewer if any ids already exist).
4. Verify:
   ```sql
   select event_type, count(*) from public.events
   where source = 'website_2_modelled' group by 1 order by 2 desc;
   ```
5. Reload the dashboard — collections, flags, service points and map markers populate
   immediately; no application restart is needed.

Timestamps are anchored to the day the migration runs (`Asia/Kolkata`), so the "today"-based
R1/R2 signals are always current at execution time. Optional: the SQL file documents (commented
out) the policies that would let future seeds run through `--apply` instead.

## Verification performed

- Dataset integrity: 100 events, 0 orphaned entity references, 0 duplicate UUIDs, 0 duplicate
  natural keys, all coordinates inside the modelled Ward 142 bounding box, 5 coordinate-free
  verification events by design.
- Six REST-inserted reports read back from the database with correct envelope, issue type,
  coordinates and IST-anchored timestamps.
- Second `--apply` run: "Nothing to insert" — idempotency proven.
- Dashboard: Reports page 28 rows including the new entries, banner "35 seed records" (auto),
  map "15 locations · 45 fixes", BWG-0002 page shows both reports with ILLUSTRATIVE chips and
  the attention status derived from them.
- Flag simulation matches the live UI for the currently-inserted subset.

## Notes and limitations

- **Reports land at 34, four above the requested 20–30.** The flag rules consume report volume
  (each R1/R2/R4 pattern needs reports), and existing records count toward the target. Fifteen
  of the 34 are the historical pre-existing rows.
- **No photo evidence is fabricated**, so R1's `priority` severity (which requires an attached
  photo) is unreachable by design; the two priority flags come from compliance triggers instead.
- The dashboard says "Service point not recorded" for 55 entities until the owner SQL runs; the
  migration fills them all.
- Realtime remains disabled on the shared tables; the dashboard keeps polling + focus refetch.
- Time-windowed rules always depend on the execution day: run the migration when the demo
  should look current.
