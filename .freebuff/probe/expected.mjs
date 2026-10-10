// Expected dashboard figures, computed from the shared project with the same
// provenance logic the dashboard uses (src/lib/civic/schema.ts).
const K = "sb_publishable_i2Ptz6IejRvjInnuU1vMOQ_scn-CTtU";
const U = "https://kzeibmyavxmxjgxvpote.supabase.co";
const H = { apikey: K, Authorization: `Bearer ${K}` };

const isSeed = (r) => r.source === "website_2_modelled" || r.environment === "modelled";
const isTest = (r) =>
  r.source === "integration_test" ||
  r.environment === "integration_test" ||
  (r.note ?? "").toLowerCase().includes("safe to delete");

const entities = await (await fetch(`${U}/rest/v1/entities?select=*&limit=1000`, { headers: H })).json();
const events = await (await fetch(`${U}/rest/v1/events?select=*&limit=2000`, { headers: H })).json();

const live = events.filter((r) => !isTest(r));
const ward = "Ward 142";
const wEntities = entities.filter((e) => e.ward === ward);
const ids = new Set(wEntities.map((e) => e.id));
const wEvents = live.filter((e) => ids.has(e.entity_id));

const count = (t) => wEvents.filter((e) => e.event_type === t).length;
const fixes = new Set();
for (const r of wEvents) if (r.latitude != null && r.longitude != null && r.entity_id) fixes.add(r.entity_id);

console.log(
  JSON.stringify(
    {
      ward,
      assets: wEntities.filter((e) => /bin/i.test(e.entity_type ?? "")).length,
      bwgs: wEntities.filter((e) => /bulk waste generator/i.test(e.entity_type ?? "")).length,
      collections: count("collection"),
      citizenReports: count("citizen_report"),
      inspections: count("inspection"),
      liveEventsTotal: wEvents.length,
      seededRows: wEvents.filter(isSeed).length,
      excludedTestRows: events.filter(isTest).length,
      entitiesWithFix: fixes.size,
      entityIdsWithFix: [...fixes].sort(),
    },
    null,
    1,
  ),
);
