# CivicTrace dashboard ↔ shared Supabase integration

Website 2 (this project, `civic-trace-iota.vercel.app`) now reads and writes the **same
Supabase project** as Website 1 (`civic-trace-public.vercel.app`).

Everything below was verified against the live project with the publishable key —
no table, column or policy is assumed.

---

## 1. Audit result

| Question | Finding |
| --- | --- |
| Where was the dashboard pointing? | The committed `.env` pointed at a Lovable Cloud proxy (`wixevizwwavvjbxvwjkp`) with a different publishable key — **not** the shared project. The deployed bundle already carried the shared URL/key via Vercel env vars, so the source and the deployment disagreed. |
| Did the dashboard talk to the database at all? | No. `src/lib/civic/store.tsx` served hard-coded arrays from `src/lib/civic/seed.ts` (38 assets, 17 BWGs, `DEMO_TOTALS`) plus `localStorage`. No query, no write, no subscription existed. |
| Generated types | `src/integrations/supabase/types.ts` was an empty stub (`Tables: { [_ in never]: never }`), so any query would have failed type-checking. |
| Why were stored records missing? | Two independent reasons: the app never queried the database, and the app's configured project was the wrong one. |
| Live data volume | 64 entities (43 Municipal Waste Bin + 21 Bulk Waste Generator, all Ward 142) and 67 events. |

The dashboard's mock headline figures (38 assets / 17 BWGs) came from the same project's
real entity counts, which is why the demo looked plausible.

---

## 2. Verified shared schema

### `public.entities` — readable, not writable from the browser

| column | notes |
| --- | --- |
| `id` | `BIN-0037`, `BWG-0142`, … |
| `entity_type` | `Municipal Waste Bin` \| `Bulk Waste Generator` |
| `ward` | `Ward 142` |
| `location` | service-point text, e.g. `Residential Market, Ward 142` (often `null`) |
| `active` | boolean |

**Not present:** coordinates, capacity, asset name, BWG type, segregation streams,
collection frequency, authorised handler, registration flag.

### `public.events` — readable, append-only from the browser

| column | notes |
| --- | --- |
| `id` | uuid |
| `entity_id` | FK to `entities.id` |
| `event_type` | `citizen_report`, `collection`, `inspection`, `repair`, `maintenance`, `replacement`, `compliance`, `verification`, `installation` |
| `status` | free text: `Unverified`, `Recorded`, `Scheduled`, `Verified`, `Dismissed` |
| `issue_type` | free text: `Overflowing`, `Not collected`, `Waste not collected`, `Damaged`, `Mixed waste observed`, `Improper dumping` |
| `audit_result` | `Verified / OK`, `Issue found`, `Needs attention` |
| `note`, `photo_url` | evidence/reference columns |
| `latitude`, `longitude`, `accuracy` | real GPS fix when the reporter/worker allowed it |
| `source`, `environment` | provenance of the row |
| `worker_id`, `employee_number` | crew identity |
| `created_at` | ISO timestamp |

### `public.workers`
Readable but currently empty; it backs Website 1's phone-OTP worker sign-in.

### Storage
Bucket `event-photos` (public URLs referenced by `events.photo_url`).

---

## 3. Row-level security as observed from the browser

| operation | result |
| --- | --- |
| `SELECT` on `entities` / `events` | allowed |
| `INSERT` on `events` with the envelopes below | allowed |
| `INSERT` on `events` with any other `source`/`environment` | rejected — `42501 new row violates row-level security policy` |
| `UPDATE` on `events` | denied — PostgREST returns an empty set, no row changes |
| `DELETE` on `events` | denied — same |
| `INSERT` / `UPDATE` on `entities` | denied |

Accepted write envelopes:

| envelope | used by | purpose |
| --- | --- | --- |
| `public_qr_website` / `field_test` | Website 1 | citizen reports, worker collections, inspections |
| `website_2_dashboard` / `official_dashboard` | this dashboard | reports, collections, MCD verifications, resolutions |

Consequence: the dashboard is **append-only**. A resolution is a new `verification`
row, not an `UPDATE` on the original report — which is exactly how Website 1 already
works, so both sites stay consistent. No RLS policy was disabled or weakened.

---

## 4. Page → table mapping

| Screen | Source | Derived from |
| --- | --- | --- |
| Overview KPIs | `entities`, `events` | assets/BWGs = entity counts by `entity_type`; collections = `event_type='collection'`; reports = `event_type='citizen_report'`; flags = rule engine |
| Overview map | `events.latitude/longitude` | last fix per entity + every recorded fix |
| Recent activity | `events` | newest 12 rows in scope |
| Ward activity summary | `entities`, `events` | same counters, scoped to the selected ward |
| Geographic concentration | rule engine | 2+ flagged entities sharing a service point |
| Notifications | rule engine + `events` | flags plus the newest reports/collections |
| Assets | `entities` (`entity_type='Municipal Waste Bin'`) | status, last collection, open reports, maintenance derive from `events` |
| Asset detail | `entities` + `events` | full history, lifetime counts, recorded GPS |
| BWGs | `entities` (`entity_type='Bulk Waste Generator'`) | verification state + compliance events derive from `events` |
| BWG detail | `entities` + `events` | verification trail built from `verification`/`inspection` rows |
| GIS map | `entities` + `events` | entity markers (last known fix) and one marker per recorded fix |
| Attention Queue | rule engine over `events` | R1–R4; resolutions suppress signals |
| Citizen Reports | `events` (`citizen_report`) | issue types, evidence links, per-entity report state |
| Event History | `events` | all types, actors, derived location |

### Fields shown as "Not recorded"
Asset name, capacity, expected collection time; BWG name/type, segregation stream
requirement, required collection frequency, authorised handler. These columns do not
exist on the shared tables, so the UI states that instead of inventing values.

### Derived (labelled as such)
Maintenance required (repairs/damage reports), historical similar incidents
(overflow reports on record), lifetime counters (recorded events), registration
verified (a clean verification/inspection record), compliance concerns (compliance
events + reports). Rule R2 was rewritten to key off a recorded "not collected"
report because the shared schema has no expected collection time.

---

## 5. Write matrix (all persisted, none frontend-only)

| Action in the dashboard | Written row | Envelope |
| --- | --- | --- |
| Record Collection | `event_type='collection'`, `employee_number`, note `Route · Vehicle`, optional real device GPS | `website_2_dashboard` |
| Report Issue | `event_type='citizen_report'`, `status='Unverified'`, `issue_type`, optional note + GPS | `website_2_dashboard` |
| Schedule Inspection | `event_type='verification'`, `status='Scheduled'` | `website_2_dashboard` |
| Mark as Verified Non-Compliance | `event_type='verification'`, `status='Verified'`, `audit_result='Issue found'` | `website_2_dashboard` |
| Dismiss / No Issue Found | `event_type='verification'`, `status='Dismissed'`, `audit_result='Verified / OK'` | `website_2_dashboard` |
| Dismiss a queue signal | same as above with the rule id in the note | `website_2_dashboard` |

Every modal awaits the Supabase response and shows the stored record's timestamp;
failures surface the database message and never claim success. Deletes are not
offered because the policy denies them.

---

## 6. Live updates

Supabase Realtime `postgres_changes` is **not enabled** for `events` or `entities`.
The server rejects the subscription with:

> Unable to subscribe to changes with given parameters. Please check Realtime is
> enabled for the given connect parameters: [event: *, schema: public, table: events]

Enabling it would require adding the tables to the `supabase_realtime` publication
(a database-owner action).

Fallback in use, as allowed by the brief:

* interval refetch every 20 s, continuing in background tabs (`refetchIntervalInBackground`),
* refetch on window focus and reconnect,
* refetch after any local write (query invalidation).

The subscription is still attempted: if the tables are later published, the channel
switches to live mode (60 s safety poll) automatically, and the header badge reports
`Live` only once a change has actually been delivered.

Provenance is treated explicitly (see [WARD142-MODELLED-SEED.md](./WARD142-MODELLED-SEED.md)):
rows in the illustrative Ward 142 modelled dataset (`source='website_2_modelled'` /
`environment='modelled'`) are part of the live record history, labelled `ILLUSTRATIVE`.
Only integration-test rows and records explicitly marked *"safe to delete"* are held out
of the live figures; their count is shown in the status banner and the database menu has
an "Include integration-test rows" switch. Nothing is ever deleted.

---

## 7. Configuration

`.env` (and the Vercel project env for deployments) must point at the shared project:

```
VITE_SUPABASE_URL="https://kzeibmyavxmxjgxvpote.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_i2Ptz6IejRvjInnuU1vMOQ_scn-CTtU"
```

Only the publishable key is used — no service-role key exists in the repo or the bundle.
