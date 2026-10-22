// The data service (workers/data) within the free plan: one day of the schedule, every source answering, against a
// store already as full as it gets (7 days of measurements, 30 days of forecast hours, a year of verification), counts
// the calls to the Durable Object and the rows read and written in it. Each must stay under BUDGET of the day's limit,
// so the rest is left for the pages. Also the cache in front of the datasets (cache.js) and the backup (backup.js).
// The stand-ins for Cloudflare and the sources are in test/helpers/data-service.mjs. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/cloudflare-loader.mjs", import.meta.url);
const { sqliteStorage, rpcStub, fakeR2, fakeCache, fakeFetch } = await import("./helpers/data-service.mjs");
const worker = (await import("../workers/data/src/index.js")).default;
const { Store } = await import("../workers/data/src/store.js");
const { siteLinks, HOLFUY_STATIONS } = await import("../workers/data/src/stations.js");
const SITES = (await import("../workers/data/src/sites.json")).default;

// The free plan's limits per day (Workers and Durable Objects), and the share of each one day of the schedule may use.
export const FREE = { doRequests: 100000, rowsRead: 5000000, rowsWritten: 100000 };
export const BUDGET = 0.3;

const DAY = 86400000;
const START = Date.parse("2026-10-19T00:00:00Z");

function service() {
  const { db, stats, storage } = sqliteStorage();
  const archive = fakeR2();
  const env = { ARCHIVE: archive, HOLFUY_KEY: "test", FROST_CLIENT_ID: "test" };
  const store = new Store({ storage }, env);
  const calls = {};
  env.STORE = { idFromName: (name) => name, get: () => rpcStub(store, calls) };
  return { db, stats, storage, archive, env, store, calls };
}

// The store as full as it gets: what each source keeps (7 days of measurements, deleted day by day as the window moves),
// up to START.
function seed(db) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  db.exec("BEGIN");
  const m = db.prepare("INSERT INTO measurements (source, station, time, dir, speed, gust, temperature) VALUES (?, ?, ?, 200, 4, 7, 5)");
  for (let t = START - 7 * DAY; t < START; t += 60000) for (const s of HOLFUY_STATIONS) m.run("holfuy", String(s.id), new Date(t).toISOString());
  for (let t = START - 7 * DAY; t < START; t += 600000) for (let i = 0; i < 30; i++) m.run("met", `SN${90000 + i}`, new Date(t).toISOString());
  const f = db.prepare("INSERT INTO forecast_hours (site, time, dir, speed, gust, rain, fetched) VALUES (?, ?, 230, 5, 9, 0, ?)");
  for (let t = START - 30 * DAY; t < START; t += 3600000) for (const s of SITES) f.run(s.id, new Date(t).toISOString(), new Date(t).toISOString());
  const v = db.prepare("INSERT INTO verify_hours (site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n) VALUES (?, ?, ?, 230, 5, 9, 225, 4, 7, 6)");
  for (let t = START - 365 * DAY; t < START; t += 3600000) for (const l of siteLinks()) v.run(l.site, l.station, new Date(t).toISOString());
  const d = db.prepare("INSERT INTO flight_days (day, site, flights, pilots, minutes, max_dist, max_alt) VALUES (?, ?, 3, 2, 90, 2.5, 900)");
  for (let t = START - 365 * DAY; t < START; t += DAY) for (const s of SITES.slice(0, 2)) d.run(day(t), s.id);
  // The archive has every day up to the one before yesterday, as after a normal night.
  const st = db.prepare("INSERT INTO state (key, value) VALUES (?, ?)");
  for (const k of ["holfuy-archive", "met-archive"]) st.run(k, JSON.stringify({ through: day(START - 2 * DAY) }));
  db.exec("COMMIT");
}

async function withGlobals(fetch, cache, fn) {
  const saved = { fetch: globalThis.fetch, caches: globalThis.caches, warn: console.warn };
  const warnings = [];
  globalThis.fetch = fetch;
  globalThis.caches = { default: cache };
  console.warn = (...a) => warnings.push(a.join(" "));
  try { return { out: await fn(), warnings }; } finally { globalThis.fetch = saved.fetch; globalThis.caches = saved.caches; console.warn = saved.warn; }
}

test("one day of the schedule stays well within the free plan, with every source succeeding", { timeout: 300000 }, async () => {
  const svc = service();
  seed(svc.db);
  Object.assign(svc.stats, { rowsRead: 0, rowsWritten: 0, statements: 0 });
  const clock = { now: START };
  const { fetch, requests } = fakeFetch(clock, SITES);
  const { warnings } = await withGlobals(fetch, fakeCache(), async () => {
    for (let min = 0; min < 1440; min++) {
      clock.now = START + min * 60000;
      const waits = [];
      await worker.scheduled({ scheduledTime: clock.now }, svc.env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    }
  });
  const doRequests = Object.values(svc.calls).reduce((a, b) => a + b, 0);
  const use = { doRequests, rowsRead: svc.stats.rowsRead, rowsWritten: svc.stats.rowsWritten };
  const report = Object.entries(use).map(([k, v]) => `${k} ${v} (${((v / FREE[k]) * 100).toFixed(1)} %)`).join(", ");
  console.log(`one day: ${report}; calls ${JSON.stringify(svc.calls)}; requests ${JSON.stringify(requests)}`);

  if (process.env.QUOTA_DETAIL) console.table(Object.fromEntries(Object.entries(svc.stats.byQuery).sort((a, b) => b[1].read + b[1].written * 50 - a[1].read - a[1].written * 50).slice(0, 15)));
  assert.deepEqual(warnings, [], "every source ran without a warning (the stand-ins answer as the sources do)");
  const health = svc.store.getState("health");
  for (const [name, run] of Object.entries(health)) assert.ok(run.ok && !run.error, `${name} succeeded`);
  for (const name of ["forecast", "stations", "met", "windgram", "verify", "flights", "backup", "grid", "gridWide", "ognDdb"]) assert.ok(health[name], `${name} ran`);
  for (const [k, v] of Object.entries(use)) assert.ok(v <= FREE[k] * BUDGET, `${k}: ${v} is over ${BUDGET * 100} % of ${FREE[k]}`);
});
