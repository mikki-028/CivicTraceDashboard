#!/usr/bin/env node
/**
 * Ward 142 modelled dataset — idempotent seed tool.
 *
 * The modelled dataset (scripts/data/ward142-modelled.json) is the recovered
 * illustrative Ward 142 scenario. This tool makes it the initial set of
 * records in the SHARED Supabase project, alongside which all operational
 * records continue to accumulate. It never overwrites or deletes anything.
 *
 * Idempotency
 *   - Entities are inserted with `on conflict (id) do nothing`.
 *   - Events use the natural key (source='website_2_modelled', entity_id,
 *     event_type, created_at); a row that already exists is skipped. Running
 *     the tool any number of times inserts zero duplicates.
 *
 * Usage
 *   node scripts/seed-ward142.mjs                 # dry run (default) — report only
 *   node scripts/seed-ward142.mjs --apply         # insert missing rows via the REST API
 *   node scripts/seed-ward142.mjs --emit-sql      # write supabase/seed-ward142.sql
 *
 * The REST path uses the publishable key, so Row Level Security applies:
 *   - public.events INSERT is permitted for the (website_2_modelled, modelled)
 *     envelope if the project's policy allows it;
 *   - public.entities INSERT is currently denied for the publishable key on
 *     this project (42501). The emitted SQL file is the owner path for those
 *     rows: run supabase/seed-ward142.sql once in the Supabase SQL editor.
 *
 * Nothing in this file is imported by the application bundle.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const DATASET_PATH = join(HERE, "data", "ward142-modelled.json");
const SQL_PATH = join(APP_ROOT, "supabase", "seed-ward142.sql");

/* ------------------------------------------------------------------ *
 * Environment
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
    /* no .env — fall back to the process environment */
  }
  const pick = (...names) => names.map((n) => out[n] ?? process.env[n]).find(Boolean);
  const url = pick("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = pick("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (checked .env and the process environment).",
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

/* ------------------------------------------------------------------ *
 * Dataset → database rows
 * ------------------------------------------------------------------ */

/** Actor codes such as WKR-019 / MNT-011 / INS-004 are not repeated in notes. */
const ACTOR_CODE = /^[A-Z]{2,4}-\d{2,4}$/;

function noteFor(event) {
  const head = event.detail ? `${event.title} — ${event.detail}` : event.title;
  return ACTOR_CODE.test(event.actor) ? head : `${head} · recorded by ${event.actor}`;
}

function statusFor(dbEventType) {
  if (dbEventType === "citizen_report") return "Unverified";
  if (dbEventType === "collection") return "Recorded";
  return null;
}

function buildRows(dataset) {
  const entityById = new Map(dataset.entities.map((e) => [e.id, e]));

  const entities = dataset.entities.map((e) => ({
    id: e.id,
    entity_type: e.entityType,
    ward: e.ward,
    location: e.location,
  }));

  const events = dataset.events.map((v) => {
    const entity = entityById.get(v.entityId);
    if (!entity) throw new Error(`Event references unknown modelled entity ${v.entityId}`);
    const codedActor = ACTOR_CODE.test(v.actor);
    return {
      entity_id: v.entityId,
      event_type: v.dbEventType,
      status: statusFor(v.dbEventType),
      issue_type: v.issueType ?? null,
      note: noteFor(v),
      latitude: entity.latitude,
      longitude: entity.longitude,
      // Codes (WKR-/MNT-/INS-) live in employee_number; named actors appear in the note.
      employee_number: codedActor ? v.actor : null,
      worker_id: null,
      source: dataset.provenance.source,
      environment: dataset.provenance.environment,
      created_at: v.timestamp,
    };
  });

  return { entities, events };
}

/* ------------------------------------------------------------------ *
 * REST helpers
 * ------------------------------------------------------------------ */

function api(env, path, init = {}) {
  return fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function describeFailure(status, body) {
  if (body && typeof body === "object" && body.code === "42501") {
    return `blocked by row-level security (${body.code}): ${body.message}`;
  }
  return `HTTP ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`;
}

/* ------------------------------------------------------------------ *
 * Dry run / apply
 * ------------------------------------------------------------------ */

async function collectState(env) {
  const entityRes = await api(env, "entities?select=id&limit=1000");
  const entityRows = await readJson(entityRes);
  if (!entityRes.ok)
    throw new Error(`entities read failed — ${describeFailure(entityRes.status, entityRows)}`);

  const eventRes = await api(
    env,
    "events?select=entity_id,event_type,created_at&source=eq.website_2_modelled&limit=2000",
  );
  const eventRows = await readJson(eventRes);
  if (!eventRes.ok)
    throw new Error(`events read failed — ${describeFailure(eventRes.status, eventRows)}`);

  return {
    entityIds: new Set((entityRows ?? []).map((r) => r.id)),
    eventKeys: new Set(
      (eventRows ?? []).map(
        (r) => `${r.entity_id}|${r.event_type}|${new Date(r.created_at).toISOString()}`,
      ),
    ),
  };
}

function plan(rows, state) {
  const missingEntities = rows.entities.filter((e) => !state.entityIds.has(e.id));
  const missingEvents = rows.events.filter(
    (e) =>
      !state.eventKeys.has(
        `${e.entity_id}|${e.event_type}|${new Date(e.created_at).toISOString()}`,
      ),
  );
  return { missingEntities, missingEvents };
}

async function apply(rows, missing, env) {
  const result = {
    entitiesInserted: 0,
    entitiesBlocked: null,
    eventsInserted: 0,
    eventsBlocked: null,
    failures: [],
  };

  for (const entity of missing.missingEntities) {
    const res = await api(env, "entities?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(entity),
    });
    if (res.ok) {
      result.entitiesInserted += 1;
    } else {
      const body = await readJson(res);
      const message = describeFailure(res.status, body);
      if (body && typeof body === "object" && body.code === "42501")
        result.entitiesBlocked = message;
      else result.failures.push(`entity ${entity.id}: ${message}`);
    }
  }

  for (const event of missing.missingEvents) {
    const res = await api(env, "events", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(event),
    });
    if (res.ok) {
      result.eventsInserted += 1;
    } else {
      const body = await readJson(res);
      const message = describeFailure(res.status, body);
      if (body && typeof body === "object" && body.code === "42501") result.eventsBlocked = message;
      else result.failures.push(`event ${event.entity_id}/${event.event_type}: ${message}`);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * SQL emission (the owner path)
 * ------------------------------------------------------------------ */

const sqlLiteral = (value) => (value === null ? "null" : `'${String(value).replace(/'/g, "''")}'`);

function emitSql(dataset, rows) {
  const lines = [];
  lines.push(
    "-- CivicTrace — Ward 142 modelled seed (initial illustrative dataset).",
    "--",
    "-- Idempotent: safe to run any number of times. Inserts only what is missing,",
    "-- never updates or deletes operational records. Run once in the Supabase SQL",
    "-- editor (owner access bypasses RLS, which is why the browser role cannot",
    "-- insert public.entities rows directly).",
    "",
    "begin;",
    "",
    "-- 1. Modelled entities (on conflict do nothing).",
    "insert into public.entities (id, entity_type, ward, location) values",
    rows.entities
      .map(
        (e) =>
          `  (${sqlLiteral(e.id)}, ${sqlLiteral(e.entity_type)}, ${sqlLiteral(e.ward)}, ${sqlLiteral(e.location)})`,
      )
      .join(",\n"),
    "on conflict (id) do nothing;",
    "",
    "-- 2. Complete the modelled service point on entities that have none recorded.",
    "--    Guarded on location is null so a value set by an operator is never overwritten.",
    "update public.entities e set location = v.location",
    "from (values",
    rows.entities
      .filter((e) => e.location)
      .map((e) => `  (${sqlLiteral(e.id)}, ${sqlLiteral(e.location)})`)
      .join(",\n"),
    ") as v(id, location)",
    "where e.id = v.id and e.location is null;",
    "",
    "-- 3. Modelled events. The natural key (source, entity_id, event_type, created_at)",
    "--    makes the insert idempotent without touching existing rows.",
    "insert into public.events (entity_id, event_type, status, issue_type, note, latitude, longitude, employee_number, source, environment, created_at)",
    "select v.entity_id, v.event_type, v.status, v.issue_type, v.note, v.latitude, v.longitude, v.employee_number,",
    `       ${sqlLiteral(dataset.provenance.source)}, ${sqlLiteral(dataset.provenance.environment)}, v.created_at::timestamptz`,
    "from (values",
    rows.events
      .map(
        (e) =>
          `  (${sqlLiteral(e.entity_id)}, ${sqlLiteral(e.event_type)}, ${sqlLiteral(e.status)}, ${sqlLiteral(e.issue_type)}, ${sqlLiteral(e.note)}, ${e.latitude}, ${e.longitude}, ${sqlLiteral(e.employee_number)}, ${sqlLiteral(e.created_at)})`,
      )
      .join(",\n"),
    ") as v(entity_id, event_type, status, issue_type, note, latitude, longitude, employee_number, created_at)",
    "where not exists (",
    "  select 1 from public.events x",
    `  where x.source = ${sqlLiteral(dataset.provenance.source)}`,
    "    and x.entity_id = v.entity_id",
    "    and x.event_type = v.event_type",
    "    and x.created_at = v.created_at::timestamptz",
    ");",
    "",
    "commit;",
    "",
    "-- ------------------------------------------------------------------ --",
    "-- OPTIONAL (not required for the seed): entity provenance column.",
    "-- public.entities has no source column, so entity rows cannot carry the",
    "-- same provenance envelope as events. The smallest safe extension is an",
    "-- added column with an 'operational' default — existing rows and Website 1",
    "-- behaviour are unchanged, and the modelled ids can be marked illustrative:",
    "--",
    "--   alter table public.entities add column if not exists source text not null default 'operational';",
    "--   update public.entities set source = 'ward142_illustrative'",
    "--     where id in (-- the ten modelled ids --);",
    "--",
    "-- Uncomment only if you want the distinction stored on the entity row itself;",
    "-- the dashboard already labels modelled history through the events envelope.",
    "--",
    "-- OPTIONAL (not required for the seed): REST insert path for this seed tool.",
    "-- With the current policies the publishable key may NOT insert entities at all",
    "-- and may not write the modelled events envelope, so the SQL above is the",
    "-- seeding path. If you prefer `node scripts/seed-ward142.mjs --apply` to work",
    "-- from a machine with only the publishable key, add the matching policies:",
    "--",
    '--   create policy "Modelled seed writes entities" on public.entities for insert to anon',
    "--     with check (ward = 'Ward 142');",
    '--   create policy "Modelled seed writes events" on public.events for insert to anon',
    "--     with check (source = 'website_2_modelled' and environment = 'modelled');",
    "--",
    "-- Both stay append-only: event rows remain immutable, and no existing policy is",
    "-- weakened. This file does not create them — enable deliberately, not by accident.",
    "-- ------------------------------------------------------------------ --",
    "",
  );

  mkdirSync(dirname(SQL_PATH), { recursive: true });
  writeFileSync(SQL_PATH, lines.join("\n"), "utf8");
  return SQL_PATH;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const args = new Set(process.argv.slice(2));
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const rows = buildRows(dataset);

  if (args.has("--emit-sql")) {
    const path = emitSql(dataset, rows);
    console.log(`Wrote ${path}`);
    if (args.size === 1) return;
  }

  const env = loadEnv();
  console.log(`Shared project: ${env.url}`);
  console.log(
    `Dataset: ${rows.entities.length} modelled entities, ${rows.events.length} modelled events ` +
      `(${dataset.provenance.source}/${dataset.provenance.environment})`,
  );

  const state = await collectState(env);
  const missing = plan(rows, state);

  console.log(
    `Already present: ${rows.entities.length - missing.missingEntities.length} entities, ` +
      `${rows.events.length - missing.missingEvents.length} events`,
  );
  console.log(
    `Missing: ${missing.missingEntities.length} entities, ${missing.missingEvents.length} events`,
  );

  if (!args.has("--apply")) {
    if (missing.missingEntities.length || missing.missingEvents.length) {
      console.log("Dry run only. Re-run with --apply to insert the missing rows (RLS permitting),");
      console.log("or run supabase-setup/seed-ward142.sql in the Supabase SQL editor.");
    } else {
      console.log("Nothing to insert — the modelled dataset is already the initial record set.");
    }
    return;
  }

  const outcome = await apply(rows, missing, env);
  console.log(`Inserted: ${outcome.entitiesInserted} entities, ${outcome.eventsInserted} events`);
  if (outcome.entitiesBlocked) {
    console.log(`Entities not insertable with the publishable key — ${outcome.entitiesBlocked}`);
    console.log("Use supabase-setup/seed-ward142.sql (owner SQL editor) for those rows.");
  }
  if (outcome.eventsBlocked) {
    console.log(`Events not insertable with the publishable key — ${outcome.eventsBlocked}`);
    console.log("Use supabase-setup/seed-ward142.sql (owner SQL editor) for those rows.");
  }
  for (const failure of outcome.failures) console.log(`FAILED ${failure}`);
  if (outcome.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
