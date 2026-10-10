/**
 * Verified schema of the SHARED Supabase project (kzeibmyavxmxjgxvpote).
 *
 * Every table, column and write envelope below was verified against the live
 * project with the publishable key — nothing here is assumed.
 *
 * Tables exposed to the dashboard's publishable key:
 *   public.entities (id, entity_type, ward, location, active)
 *   public.events   (id, entity_id, event_type, status, issue_type, audit_result,
 *                    note, photo_url, latitude, longitude, accuracy, source,
 *                    environment, worker_id, employee_number, created_at)
 *   public.workers  (readable, currently empty)
 *
 * Storage: bucket `event-photos` (public URLs referenced by events.photo_url).
 *
 * RLS as observed from the browser role:
 *   SELECT on entities/events  → allowed
 *   INSERT on events           → allowed for the dashboard and public-QR envelopes;
 *                                denied for the modelled seed envelope
 *   UPDATE / DELETE on events  → denied (PostgREST returns an empty set, no rows change)
 *   INSERT on entities         → denied — the modelled seed entities were written
 *                                through owner SQL (supabase/seed-ward142.sql)
 */

export const SHARED_PROJECT_REF = "kzeibmyavxmxjgxvpote";

export interface DbEntityRow {
  id: string;
  entity_type: string | null;
  ward: string | null;
  location: string | null;
  active: boolean | null;
}

export interface DbEventRow {
  id: string;
  entity_id: string | null;
  event_type: string | null;
  status: string | null;
  issue_type: string | null;
  audit_result: string | null;
  note: string | null;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  source: string | null;
  environment: string | null;
  worker_id: string | null;
  employee_number: string | null;
  created_at: string;
}

/**
 * (source, environment) envelopes accepted by the INSERT policy on public.events.
 * `public_qr_website` / `field_test` is the envelope Website 1 uses for citizen
 * reports; `website_2_dashboard` / `official_dashboard` is the dashboard envelope
 * (verified working). Anything else is rejected with 42501.
 */
export const WRITE_ENVELOPES = {
  /** Records created from this dashboard. */
  dashboard: { source: "website_2_dashboard", environment: "official_dashboard" },
  /** The public QR website envelope — used only when reproducing its flows. */
  publicQr: { source: "public_qr_website", environment: "field_test" },
} as const;

/** Columns that are writable when appending an event. */
export interface EventInsert {
  entity_id: string;
  event_type: string;
  status?: string | null;
  issue_type?: string | null;
  audit_result?: string | null;
  note?: string | null;
  photo_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  worker_id?: string | null;
  employee_number?: string | null;
  source: string;
  environment: string;
}

/* ------------------------------------------------------------------ *
 * Record provenance
 *
 * The Ward 142 modelled dataset — source `website_2_modelled`, environment
 * `modelled` — is the illustrative initial record set of the shared project
 * (seeded once through supabase/seed-ward142.sql). It is part of the live
 * record history and is labelled "illustrative" wherever it appears; the
 * dashboard reads it from the database like any other record.
 *
 * Rows written by integration tests (`integration_test` envelopes) or
 * explicitly marked "safe to delete" are held out of the live figures until
 * the test scope is switched on — nothing is deleted, nothing is hidden
 * silently.
 * ------------------------------------------------------------------ */

export const SEED_SOURCES = ["website_2_modelled"];
export const SEED_ENVIRONMENTS = ["modelled"];
export const TEST_ENVIRONMENTS = ["integration_test"];
export const TEST_SOURCES = ["integration_test"];
export const TEST_NOTE_MARKER = "safe to delete";

/** A record belonging to the recovered Ward 142 modelled dataset. */
export function isSeedRow(row: { source?: string | null; environment?: string | null }): boolean {
  return (
    SEED_ENVIRONMENTS.includes(row.environment ?? "") || SEED_SOURCES.includes(row.source ?? "")
  );
}

/** Test-only rows: integration-test envelopes or rows explicitly marked for deletion. */
export function isTestRow(row: {
  source?: string | null;
  environment?: string | null;
  note?: string | null;
}): boolean {
  return (
    TEST_ENVIRONMENTS.includes(row.environment ?? "") ||
    TEST_SOURCES.includes(row.source ?? "") ||
    (row.note ?? "").toLowerCase().includes(TEST_NOTE_MARKER)
  );
}

/** Only test rows are excluded from the live figures — the illustrative seed is included. */
export function isExcludedFromLive(row: {
  source?: string | null;
  environment?: string | null;
  note?: string | null;
}): boolean {
  return isTestRow(row);
}

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export const ASSET_ENTITY_TYPE = "Municipal Waste Bin";
export const BWG_ENTITY_TYPE = "Bulk Waste Generator";

/** Website 1's citizen-report issue vocabulary, plus the values found in the live table. */
export const REPORT_ISSUE_TYPES = [
  "Overflowing",
  "Not collected",
  "Waste not collected",
  "Damaged",
  "Mixed waste observed",
  "Improper dumping",
  "Other",
] as const;

/** Website 1's inspection vocabulary (public.events.audit_result). */
export const AUDIT_RESULTS = {
  ok: "Verified / OK",
  issueFound: "Issue found",
  needsAttention: "Needs attention",
} as const;

/** Resolution states the dashboard writes into public.events.status. */
export const EVENT_STATUS = {
  unverified: "Unverified",
  recorded: "Recorded",
  scheduled: "Scheduled",
  verified: "Verified",
  dismissed: "Dismissed",
} as const;

export function sourceLabel(source: string | null, environment: string | null): string {
  if (isSeedRow({ source, environment })) return "Ward 142 modelled dataset";
  switch (source) {
    case "public_qr_website":
      return "Public QR site";
    case "website_2_dashboard":
      return "Ward dashboard (MCD Official)";
    case "integration_test":
      return "Integration test";
    default:
      return source ?? "Unknown source";
  }
}
