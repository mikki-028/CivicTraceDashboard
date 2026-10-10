/**
 * Live data access for the shared CivicTrace Supabase project.
 *
 * Reads:  public.entities + public.events (paginated, ordered newest-first)
 * Writes: append-only INSERTs on public.events (RLS denies UPDATE/DELETE)
 * Live:   Supabase Realtime `postgres_changes` when the publication allows it,
 *         otherwise the caller falls back to interval + focus refetching.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  AUDIT_RESULTS,
  EVENT_STATUS,
  WRITE_ENVELOPES,
  isSeedRow,
  isTestRow,
  sourceLabel,
  type DbEntityRow,
  type DbEventRow,
  type EventInsert,
} from "./schema";
import type {
  BwgEntity,
  AssetEntity,
  CivicEntity,
  CivicEvent,
  EventType,
  VerificationStatus,
} from "./types";

const PAGE_SIZE = 500;
const MAX_ROWS = 5000;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function selectAll<T>(table: "entities" | "events", orderBy: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface SharedData {
  entities: CivicEntity[];
  events: CivicEvent[];
  /** Included illustrative seed rows (transparency count). */
  seededRows: number;
  /** Integration-test rows held out of the live figures. */
  excludedTestRows: number;
  fetchedAt: string;
}

export async function fetchSharedData(
  options: { includeTestRows?: boolean } = {},
): Promise<SharedData> {
  const [entityRows, eventRows] = await Promise.all([
    selectAll<DbEntityRow>("entities", "id"),
    selectAll<DbEventRow>("events", "created_at"),
  ]);
  return mapSharedData(entityRows, eventRows, options.includeTestRows ?? false);
}

/* ------------------------------------------------------------------ *
 * Mapping: Supabase rows → dashboard domain model
 * ------------------------------------------------------------------ */

const EVENT_TYPE_MAP: Record<string, EventType> = {
  citizen_report: "report",
  collection: "collection",
  inspection: "inspection",
  repair: "maintenance",
  maintenance: "maintenance",
  replacement: "replacement",
  compliance: "compliance",
  verification: "verification",
  installation: "installation",
};

export function mapEventType(rawType: string | null): EventType {
  return EVENT_TYPE_MAP[rawType ?? ""] ?? "other";
}

/** "Residential Market, Ward 142" → "Residential Market" */
export function servicePointOf(location: string | null, ward: string | null): string {
  const value = (location ?? "").trim();
  if (!value) return "Service point not recorded";
  const parts = value.split(",").map((p) => p.trim());
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && ward && last.toLowerCase() === ward.toLowerCase()) {
    return parts.slice(0, -1).join(", ");
  }
  return value;
}

function eventTitle(type: EventType, rawType: string, row: DbEventRow): string {
  switch (type) {
    case "report":
      return `Citizen report — ${row.issue_type ?? "Issue"}`;
    case "collection":
      return "Collection recorded";
    case "inspection":
      return row.audit_result ? `Inspection — ${row.audit_result}` : "Inspection recorded";
    case "maintenance":
      return rawType === "maintenance" ? "Maintenance event recorded" : "Repair recorded";
    case "replacement":
      return "Replacement recorded";
    case "compliance":
      return row.note ? `Compliance — ${row.note}` : "Compliance event recorded";
    case "verification":
      return row.status ? `MCD verification — ${row.status}` : "MCD verification recorded";
    case "installation":
      return "Asset installed";
    default:
      return rawType.replace(/_/g, " ");
  }
}

function actorOf(row: DbEventRow, type: EventType): string {
  if (row.employee_number) return row.employee_number;
  if (row.worker_id) return `Worker ${row.worker_id.slice(0, 8)}`;
  if (type === "report") return "Citizen (QR)";
  return sourceLabel(row.source, row.environment);
}

/** A resolution is a verification/inspection record that settles an open report or flag. */
export function resolutionOutcome(row: DbEventRow): VerificationStatus | null {
  const status = (row.status ?? "").toLowerCase();
  const audit = row.audit_result ?? "";
  if (status === "dismissed") return "dismissed";
  if (audit === AUDIT_RESULTS.ok) return "dismissed";
  if (audit === AUDIT_RESULTS.issueFound || audit === AUDIT_RESULTS.needsAttention) {
    return "verified";
  }
  if (status === "verified") return "verified";
  return null;
}

function mapEvent(row: DbEventRow, entityById: Map<string, CivicEntity>): CivicEvent {
  const type = mapEventType(row.event_type);
  const entity = row.entity_id ? entityById.get(row.entity_id) : undefined;
  const detailParts = [
    row.note,
    row.audit_result && type !== "inspection" ? row.audit_result : null,
  ];
  const detail = detailParts.filter(Boolean).join(" · ");
  const location = entity ? `${entity.servicePoint}, ${entity.ward}` : undefined;

  const event: CivicEvent = {
    id: row.id,
    entityId: row.entity_id ?? "—",
    type,
    rawType: row.event_type ?? "unknown",
    timestamp: row.created_at,
    actor: actorOf(row, type),
    title: eventTitle(type, row.event_type ?? "", row),
    detail: detail || undefined,
    location,
    issueType: row.issue_type ?? undefined,
    hasPhoto: !!row.photo_url,
    photoUrl: row.photo_url,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    source: row.source,
    environment: row.environment,
    status: row.status,
    auditResult: row.audit_result,
    isSeeded: isSeedRow(row),
  };

  if (type === "report") {
    event.verification = "unverified";
  }
  if (type === "verification" || type === "inspection") {
    const outcome = resolutionOutcome(row);
    event.isResolution = outcome !== null || row.status === EVENT_STATUS.scheduled;
    if (outcome) event.resolution = outcome === "verified" ? "verified" : "dismissed";
    else if (row.status === EVENT_STATUS.scheduled) event.resolution = "scheduled";
  }
  return event;
}

/** Latest event that carries a stored GPS fix, per entity. */
function lastFixPerEntity(rows: DbEventRow[]): Map<string, DbEventRow> {
  const fixes = new Map<string, DbEventRow>();
  for (const row of rows) {
    if (!row.entity_id) continue;
    if (row.latitude == null || row.longitude == null) continue;
    const existing = fixes.get(row.entity_id);
    if (!existing || row.created_at > existing.created_at) fixes.set(row.entity_id, row);
  }
  return fixes;
}

export function mapSharedData(
  entityRows: DbEntityRow[],
  allEventRows: DbEventRow[],
  includeTestRows = false,
): SharedData {
  const liveEventRows = includeTestRows
    ? allEventRows
    : allEventRows.filter((row) => !isTestRow(row));
  const seededRows = liveEventRows.filter((row) => isSeedRow(row)).length;
  const excludedTestRows = allEventRows.filter((row) => isTestRow(row)).length;

  const fixes = lastFixPerEntity(liveEventRows);
  const eventsByEntity = new Map<string, DbEventRow[]>();
  for (const row of liveEventRows) {
    if (!row.entity_id) continue;
    const list = eventsByEntity.get(row.entity_id) ?? [];
    list.push(row);
    eventsByEntity.set(row.entity_id, list);
  }

  /* ---- entities ---- */
  const entities: CivicEntity[] = entityRows.map((row) => {
    const entityType = row.entity_type ?? "Unknown entity type";
    const isBwg = /bulk waste generator/i.test(entityType);
    const ward = row.ward ?? "Ward not recorded";
    const own = eventsByEntity.get(row.id) ?? [];
    const fix = fixes.get(row.id);

    const count = (t: EventType) => own.filter((e) => mapEventType(e.event_type) === t).length;
    const repairs = count("maintenance");
    const reports = own.filter((e) => mapEventType(e.event_type) === "report");
    /** Reports that point at physical damage rather than a missed pickup. */
    const damageReports = reports.filter((e) =>
      (e.issue_type ?? "").toLowerCase().includes("damaged"),
    );
    const base = {
      id: row.id,
      entityType,
      servicePoint: servicePointOf(row.location, row.ward),
      ward,
      active: row.active ?? true,
      lat: fix?.latitude ?? null,
      lng: fix?.longitude ?? null,
      coordinatesFrom: fix
        ? { eventId: fix.id, recordedAt: fix.created_at, accuracy: fix.accuracy ?? null }
        : null,
      installedOn: [...own]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .find((e) => mapEventType(e.event_type) === "installation")?.created_at,
      isSeeded: own.some((e) => isSeedRow(e)),
    };

    if (isBwg) {
      const inspections = own
        .filter((e) => mapEventType(e.event_type) === "inspection")
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const latestInspection = inspections[0];
      const cleanVerification = own.some(
        (e) =>
          (mapEventType(e.event_type) === "verification" ||
            mapEventType(e.event_type) === "inspection") &&
          e.audit_result === AUDIT_RESULTS.ok,
      );
      const bwg: BwgEntity = {
        ...base,
        kind: "bwg",
        registrationVerified: cleanVerification,
        segregationIssues: count("compliance"),
        inspectionIssue: latestInspection
          ? latestInspection.audit_result === AUDIT_RESULTS.issueFound ||
            latestInspection.audit_result === AUDIT_RESULTS.needsAttention
          : // No inspection on record: fall back to a citizen reporting mixed waste.
            reports.some((e) => (e.issue_type ?? "").toLowerCase().includes("mixed waste")),
      };
      return bwg;
    }

    const asset: AssetEntity = {
      ...base,
      kind: "asset",
      maintenanceRequired: repairs >= 2 || damageReports.length > 0,
      historicalSimilarIncidents: reports.filter((e) => e.issue_type === "Overflowing").length,
      lifetime: {
        collections: count("collection"),
        reports: reports.length,
        repairs: own.filter((e) => e.event_type === "repair").length,
        maintenance: own.filter((e) => e.event_type === "maintenance").length,
      },
    };
    return asset;
  });

  const entityById = new Map(entities.map((e) => [e.id, e]));

  /* ---- events ---- */
  const events = liveEventRows
    .map((row) => mapEvent(row, entityById))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  /* ---- report resolution: a later resolution record closes earlier reports ---- */
  const latestResolution = new Map<string, { at: string; outcome: VerificationStatus }>();
  for (const event of events) {
    if (event.type !== "verification" && event.type !== "inspection") continue;
    const outcome = resolutionOutcome({
      status: event.status ?? null,
      audit_result: event.auditResult ?? null,
    } as DbEventRow);
    if (!outcome) continue;
    const current = latestResolution.get(event.entityId);
    if (!current || event.timestamp > current.at) {
      latestResolution.set(event.entityId, { at: event.timestamp, outcome });
    }
  }
  for (const event of events) {
    if (event.type !== "report") continue;
    const resolution = latestResolution.get(event.entityId);
    if (resolution && resolution.at > event.timestamp) {
      event.verification = resolution.outcome;
    }
  }

  return { entities, events, seededRows, excludedTestRows, fetchedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ *
 * Writes (append-only)
 * ------------------------------------------------------------------ */

export interface WriteResult {
  ok: boolean;
  error?: string;
  event?: CivicEvent;
}

function describeError(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): string {
  if (error.code === "42501") {
    return "Blocked by the database row-level security policy for this record shape.";
  }
  return [error.message, error.details].filter(Boolean).join(" — ") || "Unknown database error";
}

/**
 * Append an event to the shared table. The row is only reported as written when
 * Supabase returns the persisted record.
 */
export async function appendEvent(
  payload: Omit<EventInsert, "source" | "environment"> & {
    envelope?: keyof typeof WRITE_ENVELOPES;
  },
): Promise<WriteResult> {
  const { envelope = "dashboard", ...fields } = payload;
  const { data, error } = await supabase
    .from("events")
    .insert({ ...fields, ...WRITE_ENVELOPES[envelope] })
    .select("*")
    .single();

  if (error) return { ok: false, error: describeError(error) };
  if (!data) return { ok: false, error: "The database did not return the stored record." };

  const row = data as DbEventRow;
  return {
    ok: true,
    event: mapEvent(row, new Map()),
  };
}

/* ------------------------------------------------------------------ *
 * Realtime (with graceful degradation)
 * ------------------------------------------------------------------ */

export type RealtimeStatus = "connecting" | "subscribed" | "unavailable";

export function subscribeToSharedChanges({
  onChange,
  onStatus,
}: {
  onChange: () => void;
  onStatus: (status: RealtimeStatus, detail?: string) => void;
}): () => void {
  onStatus("connecting");
  let delivered = false;
  let confirmationTimer: number | undefined;

  const markUnavailable = (detail: string) => {
    if (delivered) return;
    if (confirmationTimer !== undefined) window.clearTimeout(confirmationTimer);
    onStatus("unavailable", detail);
  };

  /** Only a change the server actually delivered proves the stream is live. */
  const onRealtimeChange = () => {
    delivered = true;
    if (confirmationTimer !== undefined) window.clearTimeout(confirmationTimer);
    onStatus("subscribed", "Receiving live INSERT/UPDATE/DELETE events from the shared tables.");
    onChange();
  };

  const channel = supabase
    .channel("civictrace-shared")
    // The server rejects postgres_changes for tables that are not part of the
    // realtime publication, and reports it as a system error on the channel.
    .on("system", {}, (payload: { status?: string; message?: string } | undefined) => {
      if (payload?.status === "error") {
        markUnavailable(
          payload.message ??
            "Realtime rejected the postgres_changes subscription for the shared tables — refetching on an interval instead.",
        );
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, onRealtimeChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "entities" }, onRealtimeChange)
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        // A join ack is not proof: give the server a moment to reject the
        // postgres_changes binding before the dashboard trusts the stream.
        if (confirmationTimer === undefined && !delivered) {
          confirmationTimer = window.setTimeout(() => {
            if (!delivered) {
              onStatus(
                "unavailable",
                "Realtime is not enabled for the shared tables (no change was ever delivered) — refetching on an interval instead.",
              );
            }
          }, 6000);
        }
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        markUnavailable(
          err?.message ??
            "Realtime is not enabled for the shared tables — refetching on an interval instead.",
        );
      }
    });

  return () => {
    if (confirmationTimer !== undefined) window.clearTimeout(confirmationTimer);
    void supabase.removeChannel(channel);
  };
}
