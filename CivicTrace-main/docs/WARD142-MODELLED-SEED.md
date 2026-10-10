# Ward 142 modelled dataset — seeded into the shared Supabase project

The illustrative Ward 142 dataset that used to power the prototype from a frontend
mock module is now the **initial record set of the shared database**. Both websites
read it from the same tables as every later operational record; no frontend mock
data is merged at display time.

## What was recovered

Recovered from the original upload archive (`CivicTrace-main.zip`, module
`src/lib/civic/seed.ts`, 2026-10-08):

| Item | Count | Where it lives now |
|---|---|---|
| Municipal waste assets (BIN-0037, 0041, 0052, 0064, 0078, 0081) | 6 | `public.entities` (all present) |
| Bulk waste generators (BWG-0142, 0151, 0172, 0190) | 4 | `public.entities` (all present) |
| Events (installations, repairs, replacement, collections, citizen reports, compliance, inspections) | 29 | `public.events`, envelope `website_2_modelled`/`modelled` |
| Demo headline totals (38 assets / 17 BWGs / 124 collections / 31 reports) | — | documented in `scripts/data/ward142-modelled.json` (not displayed; the UI shows real counts) |

The bootstrap SQL (`supabase-setup/civictrace.sql` from Website 1) had already
created the base ID range (BIN-0001…0038, BWG-0001…0017); the nine modelled rows
outside that range and all 29 events were written through **owner SQL** — the
browser key cannot perform those inserts (see RLS below).

Preserved verbatim: ids, event types, timestamps, statuses, issue types, actor
identities and the modelled Ward 142 coordinates (stored on the events, the only
coordinate storage the shared schema offers).

## Provenance rules in the dashboard

| Envelope | Meaning | Dashboard treatment |
|---|---|---|
| `website_2_modelled` / `modelled` | illustrative initial dataset | **included** in all figures, labelled `ILLUSTRATIVE` per row |
| `public_qr_website` / `field_test` | Website 1 (public QR site) | operational — included |
| `website_2_dashboard` / `official_dashboard` | this dashboard | operational — included |
| `integration_test` envelopes, notes containing “safe to delete” | test artifacts | held out of the live figures behind “Include integration-test rows” |

`public.entities` has no source column, so an entity is labelled illustrative when
at least one of its events comes from the modelled dataset. Every modelled entity
has such an event. A hard per-entity marker needs the optional column in the SQL file.

## Seed tool

```bash
npm run seed:ward142        # dry run: reports what is present / missing
npm run seed:ward142:sql    # rewrites supabase/seed-ward142.sql
node scripts/seed-ward142.mjs --apply   # inserts only missing rows via REST (RLS permitting)
```

Idempotency key: `(source = 'website_2_modelled', entity_id, event_type, created_at)`.
Entities insert with `on conflict (id) do nothing`. Running it repeatedly inserts
nothing new — verified twice against the live project (`Inserted: 0 entities, 0 events`
with the modelled row count unchanged at 29).

Input data: [scripts/data/ward142-modelled.json](../scripts/data/ward142-modelled.json) —
never imported by the app bundle.

## Owner SQL

[supabase/seed-ward142.sql](../supabase/seed-ward142.sql) — single transaction,
idempotent, inserts only what is missing. Run it once in the Supabase SQL editor to:

1. insert any missing modelled entities (`on conflict (id) do nothing`);
2. complete `entities.location` where it is null (guarded — operator-set values are
   never overwritten). **Known gap today: `BIN-0037.location` is null**, so its page
   shows “Service point not recorded”;
3. insert any missing modelled events (`where not exists` on the natural key).

The file also documents, **commented out**, the two deliberate schema extensions we
did *not* apply: an `entities.source` provenance column and REST insert policies for
the modelled envelope. Nothing in the seed requires them today.

## RLS facts (proven, publishable key)

| Operation | Result |
|---|---|
| `INSERT public.entities` | denied — `42501` (constraint probe, no row created) |
| `INSERT public.events` with `website_2_modelled`/`modelled` | denied — `42501` |
| `INSERT public.events` with `website_2_dashboard`/`official_dashboard` | allowed (reaches SQL) |
| `INSERT public.events` with `public_qr_website`/`field_test` | allowed |
| `UPDATE` / `DELETE` on both tables | denied |

## Verification performed (2026-10-10)

1. Dashboard figures checked against an independent REST computation: **43 assets,
   21 BWGs, 9 collections, 19 citizen reports** — exact match.
2. Banner + entity header + event timeline show the `ILLUSTRATIVE` label (14 chips
   on the BIN-0037 page).
3. GIS map: “11 locations · 36 GPS fixes · 53 unmapped” — exactly the entities with
   stored coordinates; no invented positions; initial view fits the Ward 142 points.
4. **Website 1 → Website 2 (through Website 1's real UI)**: report filed on the
   deployed public site for BIN-0041 → row `d2a0201f-8803-49c6-8cc3-ad72b190bedd`
   (`public_qr_website/field_test`, Unverified) → visible on the BIN-0041 timeline
   in the dashboard.
5. **Website 2 → database → Website 1**: collection recorded through the dashboard UI
   → row `c8976da6-d766-4469-9e62-5b01cf85ccc3` (`website_2_dashboard/official_dashboard`,
   `WKR-019`) → readable through the same key/table that Website 1 uses; Website 1's
   client reads `entities` live (its deployed page shows current DB values) but has no
   event-history view, so cross-visibility is verified at the data layer.
6. Idempotency: two `--apply` runs, zero inserts, no duplicates.
7. `tsc`, `eslint` (errors), `prettier` and `vite build` all pass.

## Cleanup candidates (owner SQL — the browser key cannot DELETE)

Test rows created during integration work, all excluded from live figures:
`9e5dbe60…`, `d3c04b9d…`, `ca3326e8…`, `ed66c1c5…`, `374fe511…`, `8eee708e…`,
`155ef53f…`, plus the 26 rows currently reported in the banner.

Two rows created deliberately during the acceptance tests above are *operational*
(not marked, counted live): `8988657e-723a-4a88-9435-41b5f6e25c7a` and
`d2a0201f-8803-49c6-8cc3-ad72b190bedd` on BIN-0041. Delete via SQL only if the
demo should not keep them.

## Residual limitations

- `BIN-0037.location` is null until the owner SQL runs (one guarded `update`).
- Rich modelled attributes (capacity, expected collection time, BWG type, handler,
  segregation streams, illustrative photo flags) have no columns in the shared
  schema; they remain documented in the dataset JSON and are shown as “Not recorded”.
- Time-windowed attention rules age with the dataset: the modelled “today” is
  2026-10-08, so only date-independent patterns (e.g. BWG-0142 recurring compliance)
  still raise queue signals today. Re-run the seed with fresh timestamps only if the
  demo should look newly active.
- Realtime is not enabled for the shared tables; polling + focus refetch keeps both
  websites in step.
