#!/usr/bin/env node
/**
 * Ward 142 enriched illustrative dataset — deterministic generator.
 *
 * Produces a richer, interconnected dataset for the EXISTING shared Supabase
 * project: collection histories, citizen reports, inspections, compliance
 * records, repairs, verifications and the event patterns that raise the
 * dashboard's rule-based attention flags — all on existing Ward 142 entities,
 * with coordinates inside the modelled Ward 142 demonstration area.
 *
 *   node scripts/generate-ward142-enriched.mjs            # regenerate JSON + SQL (deterministic)
 *   node scripts/generate-ward142-enriched.mjs --verify   # DB counts, idempotency, flag simulation
 *   node scripts/generate-ward142-enriched.mjs --apply    # insert the REST-permitted subset (reports)
 *
 * Provenance: every generated event carries the established illustrative
 * envelope (source `website_2_modelled`, environment `modelled`), which the
 * dashboard labels ILLUSTRATIVE.
 *
 * Insertion paths (verified against the live project's RLS):
 *   - `--apply` can insert citizen reports (the modelled envelope permits that
 *     shape for the publishable key). Everything else is emitted as an
 *     idempotent owner migration: supabase/seed-ward142-enriched.sql.
 *
 * Idempotency: every generated entity update / event carries a deterministic
 * UUID or key, so the SQL and the REST path can both run repeatedly with no
 * duplicates and no effect on existing rows.
 *
 * Nothing here is imported by the application bundle.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const JSON_PATH = join(HERE, "data", "ward142-enriched.json");
const SQL_PATH = join(APP_ROOT, "supabase", "seed-ward142-enriched.sql");

const PROVENANCE = { source: "website_2_modelled", environment: "modelled" };
const IS_APPLY = process.argv.includes("--apply");
const IS_VERIFY = process.argv.includes("--verify") || IS_APPLY;

/* ------------------------------------------------------------------ *
 * Deterministic helpers
 * ------------------------------------------------------------------ */

/** Mulberry32 — small, fast, deterministic PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UUID_NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 DNS namespace
function uuidv5(name) {
  const ns = Buffer.from(UUID_NS.replace(/-/g, ""), "hex");
  const h = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const rand = rng(20261010);

/* ------------------------------------------------------------------ *
 * Ward 142 geography (recovered modelled service points)
 * ------------------------------------------------------------------ */

const SERVICE_POINTS = [
  { name: "Residential Market", lat: 28.6421, lng: 77.2183 },
  { name: "Main Road", lat: 28.6448, lng: 77.2231 },
  { name: "Sector 4 Lane", lat: 28.6392, lng: 77.2256 },
  { name: "Community Park Gate", lat: 28.6465, lng: 77.2148 },
  { name: "Market Backlane", lat: 28.6401, lng: 77.2196 },
];

/** Deterministic offset inside the modelled Ward 142 demonstration area. */
function pointFor(servicePoint, index) {
  const r = rng(1000 + index);
  const jitterLat = (r() - 0.5) * 0.0022;
  const jitterLng = (r() - 0.5) * 0.0026;
  return {
    latitude: Number((servicePoint.lat + jitterLat).toFixed(5)),
    longitude: Number((servicePoint.lng + jitterLng).toFixed(5)),
  };
}

const servicePointFor = (index) => SERVICE_POINTS[index % SERVICE_POINTS.length];

/* ------------------------------------------------------------------ *
 * Dataset design
 * ------------------------------------------------------------------ */

/** Entities that receive new history (existing ids only — no new entities). */
const QUIET_BINS = Array.from({ length: 26 }, (_, i) => `BIN-${String(i + 1).padStart(4, "0")}`);
const ENRICHED_BWG_IDS = Array.from(
  { length: 8 },
  (_, i) => `BWG-${String(i + 1).padStart(4, "0")}`,
);
const MODELLED_BINS = ["BIN-0037", "BIN-0041", "BIN-0052", "BIN-0064", "BIN-0078", "BIN-0081"];

const ROUTES = ["Route 03", "Route 07", "Route 11"];
const VEHICLES = ["DL-01-AB-2042", "DL-01-CE-1180", "DL-02-FG-3355"];
const workers = Array.from({ length: 9 }, (_, i) => `WKR-${String(i + 8).padStart(3, "0")}`);
const repairCrews = ["MNT-004", "MNT-006", "MNT-011", "MNT-015"];
const inspectors = ["INS-002", "INS-004", "INS-007"];

const pick = (list, r) => list[Math.floor(r() * list.length) % list.length];
const hoursMinutes = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const events = [];
let seq = 0;
function addEvent(event) {
  seq += 1;
  const id = uuidv5(
    `civictrace:ward142-enriched:v1:${seq}:${event.entityId}:${event.dayOffset}:${event.time}`,
  );
  events.push({ id, ...event, provenance: PROVENANCE });
}

/* ---------- 1. Collection histories (existing assets + BWGs) ---------- */

/**
 * Explicit, deterministic collection sets per entity. Volumes are deliberately
 * moderate: the dataset targets ~150 live operational events in total.
 */
function collectionRun(entityId, index, dayOffsets) {
  const sp = servicePointFor(index);
  const point = pointFor(sp, index);
  const r = rng(5000 + index);
  for (const d of dayOffsets) {
    addEvent({
      entityId,
      eventType: "collection",
      status: "Recorded",
      note: `${pick(ROUTES, r)} · Vehicle ${pick(VEHICLES, r)}`,
      employeeNumber: pick(workers, r),
      latitude: point.latitude,
      longitude: point.longitude,
      dayOffset: d,
      time: hoursMinutes(6 + Math.floor(r() * 4), Math.floor(r() * 4) * 15),
    });
  }
}

QUIET_BINS.forEach((id, i) => {
  // Two recent pickups on the first ten bins; one on the rest — a realistic mix.
  collectionRun(id, i, i < 10 ? [-31, -9] : [i % 2 === 0 ? -26 : -24]);
});

ENRICHED_BWG_IDS.forEach((id, i) => collectionRun(id, 100 + i, [-19 - (i % 3) * 3]));
MODELLED_BINS.forEach((id, i) => collectionRun(id, 200 + i, [-12]));

/* ---------- 2. Installations (assets that previously had no history) ---------- */

[0, 2, 4, 7, 11, 15].forEach((binIndex) => {
  const id = QUIET_BINS[binIndex];
  const sp = servicePointFor(binIndex);
  const point = pointFor(sp, binIndex);
  addEvent({
    entityId: id,
    eventType: "installation",
    note: `Asset commissioned at ${sp.name} service point`,
    actorNote: "MCD Works Division",
    latitude: point.latitude,
    longitude: point.longitude,
    dayOffset: -120 - binIndex * 7,
    time: "09:00",
  });
});

/* ---------- 3. Flag-triggering patterns (all anchored to "today") ---------- */
/* R1 (repeated post-collection overflow): collection today + overflow reports after it. */
/* R2 (collection overdue): a "not collected" report today with no collection today.     */
/* R3 (high-maintenance asset): 3+ repair / maintenance events.                          */
/* R4 (repeated compliance concern): 2+ compliance events + inspection issue / reports.  */

function pointOf(id, index) {
  const sp = servicePointFor(index);
  return { sp, ...pointFor(sp, index) };
}

// R1-a — BIN-0002: morning collection, then two overflow reports.
const p1 = pointOf("BIN-0002", 1);
addEvent({
  entityId: "BIN-0002",
  eventType: "collection",
  status: "Recorded",
  note: "Route 07 · Vehicle DL-01-AB-2042",
  employeeNumber: "WKR-019",
  latitude: p1.latitude,
  longitude: p1.longitude,
  dayOffset: 0,
  time: "08:05",
});
addEvent({
  entityId: "BIN-0002",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Overflowing",
  note: "Bin already full again after the morning pickup.",
  latitude: p1.latitude,
  longitude: p1.longitude,
  dayOffset: 0,
  time: "09:12",
  dateCritical: true,
});
addEvent({
  entityId: "BIN-0002",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Overflowing",
  note: "Waste spilling onto the footpath.",
  latitude: p1.latitude,
  longitude: p1.longitude,
  dayOffset: 0,
  time: "09:41",
  dateCritical: true,
});

// R1-b — BIN-0003: shorter route cycle, three overflow reports.
const p2 = pointOf("BIN-0003", 2);
addEvent({
  entityId: "BIN-0003",
  eventType: "collection",
  status: "Recorded",
  note: "Route 03 · Vehicle DL-01-CE-1180",
  employeeNumber: "WKR-012",
  latitude: p2.latitude,
  longitude: p2.longitude,
  dayOffset: 0,
  time: "07:55",
});
for (const [t, note] of [
  ["09:05", "Same corner overflowing again today."],
  ["09:26", "Second complaint for this point this week."],
]) {
  addEvent({
    entityId: "BIN-0003",
    eventType: "citizen_report",
    status: "Unverified",
    issueType: "Overflowing",
    note,
    latitude: p2.latitude,
    longitude: p2.longitude,
    dayOffset: 0,
    time: t,
    dateCritical: true,
  });
}

// R2-a — BIN-0004: no collection today, "not collected" report today.
const p3 = pointOf("BIN-0004", 3);
addEvent({
  entityId: "BIN-0004",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Not collected",
  note: "Bin not emptied since the weekend.",
  latitude: p3.latitude,
  longitude: p3.longitude,
  dayOffset: 0,
  time: "10:05",
  dateCritical: true,
});

// R2-b — BIN-0005: same signal, already escalated with a scheduled field check.
const p4 = pointOf("BIN-0005", 4);
addEvent({
  entityId: "BIN-0005",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Waste not collected",
  note: "Two days without pickup at this point.",
  latitude: p4.latitude,
  longitude: p4.longitude,
  dayOffset: 0,
  time: "10:22",
  dateCritical: true,
});
addEvent({
  entityId: "BIN-0005",
  eventType: "verification",
  status: "Scheduled",
  note: "Collection overdue — field check scheduled by MCD official",
  dayOffset: 0,
  time: "11:00",
});

// R3 — high-maintenance assets (repeated repairs).
const p5 = pointOf("BIN-0008", 7);
for (const [d, crew, detail] of [
  [-38, "MNT-004", "Lid hinge replacement after repeated damage"],
  [-24, "MNT-006", "Body panel dent repair"],
  [-12, "MNT-011", "Wheel assembly replaced"],
  [-3, "MNT-015", "Third repair this quarter — bin structure weakened"],
]) {
  addEvent({
    entityId: "BIN-0008",
    eventType: "repair",
    note: detail,
    employeeNumber: crew,
    latitude: p5.latitude,
    longitude: p5.longitude,
    dayOffset: d,
    time: "11:30",
  });
}
const p6 = pointOf("BIN-0009", 8);
for (const [d, crew, detail] of [
  [-30, "MNT-006", "Base plate repair"],
  [-15, "MNT-011", "Lid arm straightened after damage"],
  [-5, "MNT-004", "Latch and pedal assembly replaced"],
]) {
  addEvent({
    entityId: "BIN-0009",
    eventType: "repair",
    note: detail,
    employeeNumber: crew,
    latitude: p6.latitude,
    longitude: p6.longitude,
    dayOffset: d,
    time: "12:10",
  });
}

// R4 priority — BWG-0002: recurring segregation issues + citizen reports + inspection issue.
const b1 = pointOf("BWG-0002", 1);
for (const [d, detail] of [
  [-9, "Wet and dry streams mixed at handover"],
  [-3, "Second segregation instance recorded this month"],
]) {
  addEvent({
    entityId: "BWG-0002",
    eventType: "compliance",
    note: detail,
    actorNote: "MCD Inspection Cell",
    latitude: b1.latitude,
    longitude: b1.longitude,
    dayOffset: d,
    time: "12:40",
  });
}
addEvent({
  entityId: "BWG-0002",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Mixed waste observed",
  note: "Commercial waste handed over unsegregated.",
  latitude: b1.latitude,
  longitude: b1.longitude,
  dayOffset: -1,
  time: "10:00",
});
addEvent({
  entityId: "BWG-0002",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Mixed waste observed",
  note: "Mixed streams being loaded into the collection vehicle.",
  latitude: b1.latitude,
  longitude: b1.longitude,
  dayOffset: 0,
  time: "10:30",
});
addEvent({
  entityId: "BWG-0002",
  eventType: "inspection",
  auditResult: "Issue found",
  note: "4-stream requirement not met at time of inspection",
  employeeNumber: "INS-004",
  latitude: b1.latitude,
  longitude: b1.longitude,
  dayOffset: 0,
  time: "11:15",
});

// R4 attention — BWG-0003: compliance record without citizen reports.
const b2 = pointOf("BWG-0003", 2);
for (const [d, detail] of [
  [-11, "Segregation not maintained at handover"],
  [-4, "Repeat observation during route audit"],
]) {
  addEvent({
    entityId: "BWG-0003",
    eventType: "compliance",
    note: detail,
    actorNote: "MCD Inspection Cell",
    latitude: b2.latitude,
    longitude: b2.longitude,
    dayOffset: d,
    time: "12:15",
  });
}
addEvent({
  entityId: "BWG-0003",
  eventType: "inspection",
  auditResult: "Needs attention",
  note: "Storage area requires re-segregation before next pickup",
  employeeNumber: "INS-007",
  latitude: b2.latitude,
  longitude: b2.longitude,
  dayOffset: -2,
  time: "11:05",
});

// R4 → verification bucket — BWG-0004: signal raised, field check already scheduled.
const b3 = pointOf("BWG-0004", 3);
for (const [d, detail] of [
  [-13, "Mixed waste observed at collection bay"],
  [-5, "Segregation bins not in use at time of visit"],
]) {
  addEvent({
    entityId: "BWG-0004",
    eventType: "compliance",
    note: detail,
    actorNote: "MCD Inspection Cell",
    latitude: b3.latitude,
    longitude: b3.longitude,
    dayOffset: d,
    time: "13:05",
  });
}
addEvent({
  entityId: "BWG-0004",
  eventType: "inspection",
  auditResult: "Issue found",
  note: "Segregation infra present but unused",
  employeeNumber: "INS-002",
  latitude: b3.latitude,
  longitude: b3.longitude,
  dayOffset: -3,
  time: "10:45",
});
addEvent({
  entityId: "BWG-0004",
  eventType: "verification",
  status: "Scheduled",
  note: "Repeated compliance concern — MCD verification scheduled",
  dayOffset: 0,
  time: "12:00",
});

// R4 → resolved — BWG-0005: earlier concern closed by a recorded verification.
const b4 = pointOf("BWG-0005", 4);
for (const [d, detail] of [
  [-16, "Segregation issue recorded during route audit"],
  [-7, "Second instance before corrective action"],
]) {
  addEvent({
    entityId: "BWG-0005",
    eventType: "compliance",
    note: detail,
    actorNote: "MCD Inspection Cell",
    latitude: b4.latitude,
    longitude: b4.longitude,
    dayOffset: d,
    time: "12:30",
  });
}
addEvent({
  entityId: "BWG-0005",
  eventType: "inspection",
  auditResult: "Issue found",
  note: "Wet/dry streams mixed at handover",
  employeeNumber: "INS-004",
  latitude: b4.latitude,
  longitude: b4.longitude,
  dayOffset: -6,
  time: "11:20",
});
addEvent({
  entityId: "BWG-0005",
  eventType: "verification",
  status: "Verified",
  auditResult: "Issue found",
  note: "Repeated compliance concern — non-compliance verified, corrective notice issued",
});

// R4 priority variant — BWG-0006: heavier report volume.
const b5 = pointOf("BWG-0006", 5);
for (const [d, detail] of [
  [-10, "Unsegregated handover observed"],
  [-2, "Segregation breaches recorded at two pickups"],
]) {
  addEvent({
    entityId: "BWG-0006",
    eventType: "compliance",
    note: detail,
    actorNote: "MCD Inspection Cell",
    latitude: b5.latitude,
    longitude: b5.longitude,
    dayOffset: d,
    time: "13:20",
  });
}
addEvent({
  entityId: "BWG-0006",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Mixed waste observed",
  note: "Waste being mixed in the loading area.",
  latitude: b5.latitude,
  longitude: b5.longitude,
  dayOffset: -2,
  time: "10:10",
});
addEvent({
  entityId: "BWG-0006",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Mixed waste observed",
  note: "Segregation stream not maintained this morning.",
  latitude: b5.latitude,
  longitude: b5.longitude,
  dayOffset: -1,
  time: "09:45",
});
addEvent({
  entityId: "BWG-0006",
  eventType: "inspection",
  auditResult: "Issue found",
  note: "Third compliance observation this month",
  employeeNumber: "INS-007",
  latitude: b5.latitude,
  longitude: b5.longitude,
  dayOffset: -1,
  time: "11:40",
});

/* ---------- 4. Resolved and open reports outside the flag patterns ---------- */

const p7 = pointOf("BIN-0006", 5);
addEvent({
  entityId: "BIN-0006",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Damaged",
  note: "Lid broken — waste exposed.",
  latitude: p7.latitude,
  longitude: p7.longitude,
  dayOffset: -3,
  time: "10:15",
});
addEvent({
  entityId: "BIN-0006",
  eventType: "verification",
  status: "Verified",
  auditResult: "Issue found",
  note: "Damage confirmed — repair request raised",
  dayOffset: -2,
  time: "12:00",
});

const p8 = pointOf("BIN-0007", 6);
addEvent({
  entityId: "BIN-0007",
  eventType: "citizen_report",
  status: "Unverified",
  issueType: "Improper dumping",
  note: "Construction debris dumped beside the bin.",
  latitude: p8.latitude,
  longitude: p8.longitude,
  dayOffset: -6,
  time: "08:40",
});

/* ---------- 5. Clean inspections / verifications for variety ---------- */

ENRICHED_BWG_IDS.slice(0, 2).forEach((id, i) => {
  const b = pointOf(id, 120 + i);
  addEvent({
    entityId: id,
    eventType: "inspection",
    auditResult: "Verified / OK",
    note: "Streams separated; records available",
    employeeNumber: inspectors[i % inspectors.length],
    latitude: b.latitude,
    longitude: b.longitude,
    dayOffset: -5 - i * 2,
    time: "10:30",
  });
});
addEvent({
  entityId: "BWG-0001",
  eventType: "verification",
  status: "Verified",
  auditResult: "Verified / OK",
  note: "Registration and handler details confirmed",
  dayOffset: -4,
  time: "10:00",
});

/* ---------- 6. One asset replacement for continuity realism ---------- */

const p9 = pointOf("BIN-0010", 9);
addEvent({
  entityId: "BIN-0010",
  eventType: "replacement",
  note: "Service point continuity — replacement asset recorded after repeated damage",
  actorNote: "MCD Works Division",
  latitude: p9.latitude,
  longitude: p9.longitude,
  dayOffset: -20,
  time: "09:30",
});

/* ------------------------------------------------------------------ *
 * Event → SQL/JSON row mapping
 * ------------------------------------------------------------------ */

/** Named actors are stated in the note; worker codes live in employee_number. */
function noteFor(event) {
  return event.actorNote ? `${event.note} — recorded by ${event.actorNote}` : event.note;
}

function rowOf(event) {
  return {
    id: event.id,
    entity_id: event.entityId,
    event_type: event.eventType,
    status: event.status ?? null,
    issue_type: event.issueType ?? null,
    audit_result: event.auditResult ?? null,
    note: noteFor(event),
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    employee_number: event.employeeNumber ?? null,
    worker_id: null,
    source: PROVENANCE.source,
    environment: PROVENANCE.environment,
    day_offset: event.dayOffset ?? 0,
    local_time: event.time ?? "09:00",
    date_critical: event.dateCritical ?? false,
  };
}

const rows = events.map(rowOf);

/**
 * Every bootstrap entity gets a service point (guarded: only when location is
 * null, so operator-set values are never overwritten). The modelled entities
 * already carry a location.
 */
const BOOTSTRAP_BINS = Array.from(
  { length: 38 },
  (_, i) => `BIN-${String(i + 1).padStart(4, "0")}`,
);
const BOOTSTRAP_BWGS = Array.from(
  { length: 17 },
  (_, i) => `BWG-${String(i + 1).padStart(4, "0")}`,
);
const entitiesToLocate = [
  ...BOOTSTRAP_BINS.map((id, i) => ({ id, index: i })),
  ...BOOTSTRAP_BWGS.map((id, i) => ({ id, index: i })),
].map((e) => ({
  id: e.id,
  location: `${servicePointFor(e.index).name}, Ward 142`,
  latitude: pointFor(servicePointFor(e.index), e.index).latitude,
  longitude: pointFor(servicePointFor(e.index), e.index).longitude,
}));

const stats = {};
for (const r of rows) stats[r.event_type] = (stats[r.event_type] ?? 0) + 1;

const dataset = {
  title: "Ward 142 enriched illustrative dataset (v1)",
  generatedFrom: "scripts/generate-ward142-enriched.mjs",
  provenance: PROVENANCE,
  geography:
    "All coordinates are deterministic offsets inside the modelled Ward 142 demonstration area (service points recovered from the original seed). No device, IP or personal location is used.",
  timeAnchor:
    "Event timestamps are relative to the day the owner SQL is executed (Asia/Kolkata). Supabase timestamptz values are stored in UTC.",
  targets: {
    assets: "40–60 (43 exist)",
    bwgs: "15–20 (21 exist)",
    events: "100–150",
    reports: "20–30",
    flags: "8–15",
  },
  newEventCount: rows.length,
  newByType: stats,
  restInsertableEventTypes: ["citizen_report"],
  entitiesToLocate,
  events: rows,
};

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

function writeJson() {
  mkdirSync(dirname(JSON_PATH), { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  return JSON_PATH;
}

const sqlLiteral = (v) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
/** Timestamp expression anchored to the IST day the migration is executed. */
const tsExpr = (dayOffset, time) =>
  `((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '${dayOffset} days ${time}') at time zone 'Asia/Kolkata')`;

function writeSql() {
  const L = [];
  L.push(
    "-- CivicTrace — Ward 142 enriched illustrative dataset (v1).",
    "--",
    "-- Idempotent: every row carries a deterministic UUID; re-running inserts nothing",
    "-- and touches no existing record. Run once in the Supabase SQL editor — the",
    "-- publishable key may not insert these event shapes and may not update entities.",
    "--",
    "-- Timestamps are anchored to the day this migration runs (Asia/Kolkata), so the",
    "-- rule-based attention flags are current whenever it is executed.",
    "",
    "begin;",
    "",
    "-- 1. Complete the modelled service point on entities that have none recorded.",
    "--    Guarded on `location is null`: operator-set values are never overwritten.",
    "update public.entities e set location = v.location",
    "from (values",
    entitiesToLocate.map((e) => `  (${sqlLiteral(e.id)}, ${sqlLiteral(e.location)})`).join(",\n"),
    ") as v(id, location)",
    "where e.id = v.id and e.location is null;",
    "",
    "-- 2. Events (idempotent on the deterministic primary key).",
    "insert into public.events (id, entity_id, event_type, status, issue_type, audit_result, note, latitude, longitude, employee_number, source, environment, created_at) values",
    rows
      .map(
        (r) =>
          `  (${sqlLiteral(r.id)}, ${sqlLiteral(r.entity_id)}, ${sqlLiteral(r.event_type)}, ${sqlLiteral(r.status)}, ${sqlLiteral(r.issue_type)}, ${sqlLiteral(r.audit_result)}, ${sqlLiteral(r.note)}, ${r.latitude}, ${r.longitude}, ${sqlLiteral(r.employee_number)}, ${sqlLiteral(r.source)}, ${sqlLiteral(r.environment)}, ${tsExpr(r.day_offset, r.local_time)})`,
      )
      .join(",\n"),
    "on conflict (id) do nothing;",
    "",
    "commit;",
    "",
    "-- Verification (read-only):",
    "--   select event_type, count(*) from public.events",
    "--     where source = 'website_2_modelled' group by 1 order by 2 desc;",
    "",
  );
  mkdirSync(dirname(SQL_PATH), { recursive: true });
  writeFileSync(SQL_PATH, L.join("\n"), "utf8");
  return SQL_PATH;
}

/* ------------------------------------------------------------------ *
 * Flag simulation — mirrors src/lib/civic/rules.ts thresholds
 * ------------------------------------------------------------------ */

function simulate(rows0, entityTypeOf) {
  const byEntity = new Map();
  for (const r of rows0) {
    const list = byEntity.get(r.entity_id) ?? [];
    list.push(r);
    byEntity.set(r.entity_id, list);
  }
  const todayUTC = new Date();
  const isToday = (iso) => {
    const d = new Date(iso);
    return (
      d.getDate() === todayUTC.getDate() &&
      d.getMonth() === todayUTC.getMonth() &&
      d.getFullYear() === todayUTC.getFullYear()
    );
  };
  const flags = [];
  for (const [entityId, list] of byEntity) {
    const isBwg = !/^BIN/.test(entityId) || /generator/i.test(entityTypeOf(entityId) ?? "");
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const collections = sorted.filter((e) => e.event_type === "collection");
    const reports = sorted.filter((e) => e.event_type === "citizen_report");
    if (!isBwg) {
      const lastToday = collections.filter((e) => isToday(e.created_at)).at(-1);
      if (lastToday) {
        const after = reports.filter(
          (e) =>
            isToday(e.created_at) &&
            e.created_at > lastToday.created_at &&
            /overflowing|not collected/i.test(e.issue_type ?? ""),
        );
        const historical = reports.filter((e) => e.issue_type === "Overflowing").length;
        if (after.length >= 2 && historical >= 1) {
          flags.push({
            entityId,
            rule: "R1",
            severity:
              after.some((e) => e.photo_url) && after.length >= 3 ? "priority" : "attention",
            detectedAt: after.at(-1).created_at,
          });
        }
      }
      const notCollectedToday = reports
        .filter((e) => isToday(e.created_at) && /not collected/i.test(e.issue_type ?? ""))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (!lastToday && notCollectedToday.length > 0)
        flags.push({
          entityId,
          rule: "R2",
          severity: "attention",
          detectedAt: notCollectedToday[0].created_at,
        });
      const repairs = sorted.filter(
        (e) => e.event_type === "repair" || e.event_type === "maintenance",
      );
      if (repairs.length >= 3)
        flags.push({
          entityId,
          rule: "R3",
          severity: "maintenance",
          detectedAt: repairs.at(-1).created_at,
        });
    } else {
      const segregation = sorted.filter((e) => e.event_type === "compliance").length;
      const inspections = sorted.filter((e) => e.event_type === "inspection");
      const latest = inspections.at(-1);
      const inspectionIssue = latest
        ? /issue found|needs attention/i.test(latest.audit_result ?? "")
        : reports.some((e) => /mixed waste/i.test(e.issue_type ?? ""));
      const triggers =
        (segregation >= 2 ? 1 : 0) + (inspectionIssue ? 1 : 0) + (reports.length >= 2 ? 1 : 0);
      if (triggers >= 2)
        flags.push({
          entityId,
          rule: "R4",
          severity: triggers >= 3 ? "priority" : "attention",
          detectedAt: sorted.at(-1)?.created_at ?? "",
        });
    }
  }
  // Resolutions suppress a flag raised at or before the resolution.
  const resolved = new Map();
  for (const r of rows0) {
    if (r.event_type === "verification" && /^(Verified|Dismissed)$/i.test(r.status ?? "")) {
      const cur = resolved.get(r.entity_id);
      if (!cur || r.created_at > cur) resolved.set(r.entity_id, r.created_at);
    }
  }
  return flags.filter((f) => {
    const settled = resolved.get(f.entityId);
    return !(settled && settled >= f.detectedAt);
  });
}

/* ------------------------------------------------------------------ *
 * REST helpers
 * ------------------------------------------------------------------ */

function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(APP_ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through to process env */
  }
  const url = out.SUPABASE_URL ?? process.env.SUPABASE_URL ?? out.VITE_SUPABASE_URL;
  const key =
    out.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    out.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

async function fetchAll(env, path) {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function insertEvents(env, payloads) {
  const inserted = [];
  const failures = [];
  for (const payload of payloads) {
    const res = await fetch(`${env.url}/rest/v1/events?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: env.key,
        Authorization: `Bearer ${env.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) inserted.push(payload.id);
    else failures.push({ id: payload.id, status: res.status, body: await res.text() });
  }
  return { inserted, failures };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const jsonPath = writeJson();
  const sqlPath = writeSql();
  console.log(`Dataset : ${jsonPath}`);
  console.log(`SQL     : ${sqlPath}`);
  console.log(`Generated ${rows.length} events — ${JSON.stringify(stats)}`);
  console.log(`Entities to locate: ${entitiesToLocate.length}`);

  if (!IS_VERIFY) return;

  const env = loadEnv();
  const [entityRows, eventRows] = await Promise.all([
    fetchAll(env, "entities?select=id,entity_type,location&limit=1000"),
    fetchAll(env, "events?select=*&limit=2000"),
  ]);
  const entityTypeOf = (id) => entityRows.find((e) => e.id === id)?.entity_type;
  const isTest = (r) =>
    r.source === "integration_test" ||
    r.environment === "integration_test" ||
    (r.note ?? "").toLowerCase().includes("safe to delete");
  const existingIds = new Set(eventRows.map((r) => r.id));
  const generatedIds = rows.map((r) => r.id);

  if (IS_APPLY) {
    const payloads = rows
      // Only reports whose meaning does not depend on the day they carry: the
      // R1/R2 flag patterns must be dated by the SQL at execution time.
      .filter((r) => r.event_type === "citizen_report" && !r.date_critical)
      .map((r) => ({
        id: r.id,
        entity_id: r.entity_id,
        event_type: r.event_type,
        status: r.status,
        issue_type: r.issue_type,
        note: r.note,
        latitude: r.latitude,
        longitude: r.longitude,
        source: r.source,
        environment: r.environment,
        created_at: materialise(r),
      }));
    const missing = payloads.filter((p) => !existingIds.has(p.id));
    console.log(
      `\n--apply: ${missing.length} REST-insertable reports missing (citizen_report only).`,
    );
    if (!missing.length) {
      console.log("Nothing to insert — already present.");
    } else {
      const { inserted, failures } = await insertEvents(env, missing);
      console.log(`Inserted ${inserted.length} reports.`);
      for (const f of failures.slice(0, 5))
        console.log(`FAILED ${f.id} → HTTP ${f.status} ${f.body.slice(0, 160)}`);
    }
    const after = await fetchAll(env, "events?select=*&limit=2000");
    const live = after.filter((r) => !isTest(r));
    const counts = {};
    for (const r of live) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
    console.log("Live counts by type:", JSON.stringify(counts));
  }

  // Re-read after any apply so the figure reflects the current database state.
  const finalRows = IS_APPLY ? await fetchAll(env, "events?select=id&limit=2000") : eventRows;
  const finalIds = new Set(finalRows.map((r) => r.id));
  const alreadyThere = generatedIds.filter((id) => finalIds.has(id)).length;
  console.log(
    `\nIdempotency: ${alreadyThere}/${generatedIds.length} generated events already in the database.`,
  );

  const simulated = simulate(
    [
      ...eventRows.filter((r) => !isTest(r)),
      ...rows.map((r) => ({ ...r, created_at: materialise(r) })),
    ],
    entityTypeOf,
  );
  const bySeverity = {};
  for (const f of simulated) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  console.log(
    `Simulated flags after the owner SQL runs: ${simulated.length} (${JSON.stringify(bySeverity)})`,
  );
  console.log(`  ${simulated.map((f) => `${f.entityId}:${f.rule}:${f.severity}`).join("  ")}`);
  console.log(`Entities not yet located: ${entityRows.filter((e) => !e.location).length}`);
}

/** ISO timestamp for a generated row anchored on the current IST calendar day. */
function materialise(row) {
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000); // UTC fields = IST wall clock
  const [hh, mm] = row.local_time.split(":").map(Number);
  const utcMs =
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() + (row.day_offset ?? 0),
      hh,
      mm,
      0,
      0,
    ) -
    5.5 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
