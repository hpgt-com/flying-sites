// The data service's store and cache (workers/data/src): the cache in front of the datasets (cache.js), the nightly
// backup and its way back (backup.js), the rebuild of the tables as WITHOUT ROWID, and the measurements kept in memory.
// The stand-ins for Cloudflare are in test/helpers/data-service.mjs. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/cloudflare-loader.mjs", import.meta.url);
const { sqliteStorage, rpcStub, fakeR2, fakeCache } = await import("./helpers/data-service.mjs");
const worker = (await import("../workers/data/src/index.js")).default;
const { Store } = await import("../workers/data/src/store.js");
const { backupRows, backupBody, expiredDay } = await import("../workers/data/src/backup.js");
const { cacheKey } = await import("../workers/data/src/cache.js");

function service() {
  const s = sqliteStorage();
  const archive = fakeR2();
  const env = { ARCHIVE: archive };
  const store = new Store({ storage: s.storage }, env);
  const calls = {};
  env.STORE = { idFromName: (n) => n, get: () => rpcStub(store, calls) };
  return { ...s, env, store, calls, archive };
}

async function withCache(cache, fn) {
  const saved = globalThis.caches;
  globalThis.caches = { default: cache };
  try { return await fn(); } finally { globalThis.caches = saved; }
}

test("cache: a dataset is read from the store once a minute, whatever the query string; HEAD has no body", async () => {
  const svc = service();
  svc.store.putSnapshot("forecast", '{"dataset":"forecast"}');
  const cache = fakeCache();
  await withCache(cache, async () => {
    for (let i = 0; i < 50; i++) {
      const waits = [];
      const res = await worker.fetch(new Request(`https://data.test/v1/forecast.json?x=${i}`), svc.env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '{"dataset":"forecast"}');
      assert.match(res.headers.get("cache-control"), /max-age=60/);
    }
    const head = await worker.fetch(new Request("https://data.test/v1/forecast.json", { method: "HEAD" }), svc.env, {});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
  assert.equal(svc.calls.getSnapshot, 1, "one read of the store for 51 requests");
  assert.equal(cacheKey(new Request("https://data.test/v1/forecast.json?a=1")).url, "https://data.test/v1/forecast.json");
});

test("cache: «no data yet» and unknown paths are not cached", async () => {
  const svc = service();
  await withCache(fakeCache(), async () => {
    for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(new Request("https://data.test/v1/windgram.json"), svc.env, {})).status, 503);
    assert.equal((await worker.fetch(new Request("https://data.test/v1/nope.json"), svc.env, {})).status, 404);
  });
  assert.equal(svc.calls.getSnapshot, 2);
});

test("backup: each table to R2 by day and as latest, the file from 90 days before deleted", async () => {
  const svc = service();
  svc.store.putFlightDays([{ day: "2026-10-18", site: "heia", flights: 4, pilots: 3, minutes: 120, max_dist: 3.1, max_alt: 950 }]);
  svc.store.putVerifyHours([{ site: "heia", station: "490", time: "2026-10-19T10:00:00.000Z", f_dir: 230, f_speed: 5, f_gust: 9, m_dir: 225, m_speed: 4, m_gust: 7, n: 6 }]);
  svc.archive.files.set(`backup/flight_days/${expiredDay("2026-10-19")}.json`, "old");
  const out = await svc.store.backup("2026-10-19");
  assert.deepEqual(out.rows, { flight_days: 1, verify_hours: 1 });
  assert.deepEqual(out.restored, {});
  assert.equal(expiredDay("2026-10-19"), "2026-07-21");
  assert.ok(!svc.archive.files.has("backup/flight_days/2026-07-21.json"));
  for (const t of ["flight_days", "verify_hours"]) {
    assert.equal(svc.archive.files.get(`backup/${t}/2026-10-19.json`), svc.archive.files.get(`backup/${t}/latest.json`));
  }
  assert.deepEqual(backupRows(svc.archive.files.get("backup/flight_days/latest.json"), "flight_days"), [["2026-10-18", "heia", 4, 3, 120, 3.1, 950]]);
});

test("backup: a new, empty store reads the latest backup back in, keeping the rows it already has", async () => {
  const old = service();
  old.store.putFlightDays([
    { day: "2026-10-18", site: "heia", flights: 4, pilots: 3, minutes: 120, max_dist: 3.1, max_alt: 950 },
    { day: "2026-10-19", site: "heia", flights: 1, pilots: 1, minutes: 20, max_dist: 1, max_alt: 600 },
  ]);
  await old.store.backup("2026-10-19");
  const fresh = service();
  fresh.archive.files = old.archive.files;
  Object.assign(fresh.archive, { get: old.archive.get, put: old.archive.put, delete: old.archive.delete });
  // Written since the store was lost: newer than the backup's row for the same day, so it stays.
  fresh.store.putFlightDays([{ day: "2026-10-19", site: "heia", flights: 2, pilots: 2, minutes: 45, max_dist: 2, max_alt: 700 }]);
  const out = await fresh.store.backup("2026-10-20");
  assert.deepEqual(out.restored, { flight_days: 2, verify_hours: 0 });
  assert.deepEqual(fresh.store.flightDays().map((r) => [r.day, r.flights]), [["2026-10-18", 4], ["2026-10-19", 2]]);
  // Once it has made a backup it never reads one in again.
  const again = await fresh.store.backup("2026-10-21");
  assert.deepEqual(again.restored, {});
});

test("backup: a file for another table or with other columns is refused", () => {
  const body = backupBody("flight_days", [{ day: "2026-10-18", site: "heia", flights: 1, pilots: 1, minutes: 5 }], "2026-10-19");
  assert.throws(() => backupRows(body, "verify_hours"), /feil format/);
  assert.throws(() => backupRows(JSON.stringify({ ...JSON.parse(body), columns: ["day"] }), "flight_days"), /feil format/);
  assert.throws(() => backupRows(JSON.stringify({ ...JSON.parse(body), rows: [["x"]] }), "flight_days"), /feil rad/);
});

test("rebuild: the tables from before 20.10.2026 become WITHOUT ROWID, with only the measurements not yet archived", () => {
  const { db, storage } = sqliteStorage();
  db.exec("CREATE TABLE snapshots (dataset TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL)");
  db.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE TABLE measurements (source TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL, gust REAL, min REAL, temperature REAL, PRIMARY KEY (source, station, time))");
  db.exec("CREATE INDEX measurements_source_time ON measurements (source, time)");
  db.exec(`INSERT INTO state VALUES ('holfuy-archive', '{"through":"2026-10-18"}')`);
  db.exec(`INSERT INTO snapshots VALUES ('stations', '{}', '2026-10-19T12:00:00Z')`);
  for (const t of ["2026-10-17T12:00:00.000Z", "2026-10-18T23:59:00.000Z", "2026-10-19T00:00:00.000Z", "2026-10-19T12:00:00.000Z"]) {
    db.exec(`INSERT INTO measurements (source, station, time, dir, speed) VALUES ('holfuy', '490', '${t}', 200, 4)`);
    db.exec(`INSERT INTO measurements (source, station, time, dir, speed) VALUES ('met', 'SN1', '${t}', 210, 5)`);
  }
  const store = new Store({ storage }, {});
  for (const t of ["snapshots", "state", "measurements"]) {
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql, /WITHOUT ROWID/, t);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_old' OR name = 'measurements_source_time'").get().n, 0);
  assert.deepEqual(store.getState("holfuy-archive"), { through: "2026-10-18" });
  assert.equal(store.getSnapshot("stations"), "{}");
  // Holfuy is archived through the 18th, so only the 19th is kept; MET has no archive yet, so all of it is.
  assert.deepEqual(store.measurementsSince("holfuy", "").map((r) => r.time), ["2026-10-19T00:00:00.000Z", "2026-10-19T12:00:00.000Z"]);
  assert.equal(store.measurementsSince("met", "").length, 4);
  assert.equal(store.measurementsSince("holfuy", "")[0].dir, 200);
  // A second start changes nothing.
  new Store({ storage }, {});
  assert.equal(store.measurementsSince("met", "").length, 4);
});

test("the measurements kept in memory answer as SQLite does, also after new ones are stored", () => {
  const { storage } = sqliteStorage();
  const store = new Store({ storage }, {});
  const row = (station, min, speed = 4) => ({ source: "holfuy", station, time: new Date(Date.parse("2026-10-19T10:00:00Z") + min * 60000).toISOString(), dir: 200, speed, gust: 6, extra: min % 2 ? { x: min } : null });
  store.addMeasurements(Array.from({ length: 600 }, (_, i) => row(490, i)));
  const since = "2026-10-19T12:00:00.000Z";
  const first = store.measurementsSince("holfuy", since);
  store.addMeasurements([row(490, 600), row(820, 600), row(490, 599, 99)]);
  const cached = store.measurementsSince("holfuy", since);
  const cold = new Store({ storage }, {}).measurementsSince("holfuy", since);
  assert.deepEqual(cached, cold);
  assert.equal(cached.length, first.length + 2, "the repeated measurement is kept once, as first stored");
  assert.equal(cached.find((r) => r.station === "490" && r.time.endsWith("19:59:00.000Z")).speed, 4);
});
