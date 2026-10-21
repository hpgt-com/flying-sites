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
      assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
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
  db.exec("CREATE TABLE forecast_hours (site TEXT NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL, gust REAL, rain REAL, fetched TEXT NOT NULL, PRIMARY KEY (site, time))");
  db.exec("CREATE INDEX forecast_hours_time ON forecast_hours (time)");
  for (const site of ["heia", "elgen"]) db.exec(`INSERT INTO forecast_hours VALUES ('${site}', '2026-10-01T10:00:00Z', 230, 5, 9, 0, '2026-10-01T10:05:00Z')`);
  db.exec(`INSERT INTO state VALUES ('holfuy-archive', '{"through":"2026-10-18"}')`);
  db.exec(`INSERT INTO snapshots VALUES ('stations', '{}', '2026-10-19T12:00:00Z')`);
  for (const t of ["2026-10-17T12:00:00.000Z", "2026-10-18T23:59:00.000Z", "2026-10-19T00:00:00.000Z", "2026-10-19T12:00:00.000Z"]) {
    db.exec(`INSERT INTO measurements (source, station, time, dir, speed) VALUES ('holfuy', '490', '${t}', 200, 4)`);
    db.exec(`INSERT INTO measurements (source, station, time, dir, speed) VALUES ('met', 'SN1', '${t}', 210, 5)`);
  }
  const store = new Store({ storage }, {});
  for (const t of ["snapshots", "state", "measurements", "forecast_hours"]) {
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql, /WITHOUT ROWID/, t);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_old' OR name IN ('measurements_source_time', 'forecast_hours_time')").get().n, 0);
  assert.deepEqual(store.forecastHoursSince("2026-10-01").map((r) => [r.site, r.speed]), [["elgen", 5], ["heia", 5]], "all the forecast hours are kept");
  store.putForecastHours([{ site: "heia", time: "2026-10-01T10:00:00Z", dir: 200, speed: 7, gust: 11, rain: 0, fetched: "2026-10-01T10:30:00Z" }]);
  assert.equal(store.forecastHoursSince("2026-10-01").find((r) => r.site === "heia").speed, 7, "the latest fetch for the hour wins");
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

test("after a publish: done when the stations have succeeded after it, an error before that is reported but not final", async () => {
  const { smokeVerdict } = await import("../scripts/data-smoke.mjs");
  const since = "2026-10-20T06:00:10Z";
  assert.equal(smokeVerdict(null, since).done, false);
  assert.equal(smokeVerdict({ sources: { stations: { ok: "2026-10-20T06:00:00.000Z" } } }, since).done, false, "a run from before the publish does not count");
  const cut = smokeVerdict({ sources: { stations: { ok: "2026-10-20T05:59:00.000Z", error: "Network connection lost.", errorAt: "2026-10-20T06:01:00.000Z" } } }, since);
  assert.deepEqual([cut.done, cut.errors], [false, ["stations: Network connection lost."]]);
  const ok = smokeVerdict({ sources: { stations: { ok: "2026-10-20T06:02:00.000Z", error: "x", errorAt: "2026-10-20T06:01:00.000Z" } } }, since);
  assert.deepEqual([ok.done, ok.ok], [true, true]);
});

test("grid: the close grid around the sites and the wide one over its box, on whole steps from the south", async () => {
  const { gridPoints, GRIDS, VARS } = await import("../workers/data/src/sources/grid.js");
  const g = gridPoints(GRIDS.grid, [{ lat: 68.76, lon: 16.51 }, { lat: 68.9, lon: 16.28 }, { lat: Number.NaN, lon: 1 }]);
  assert.deepEqual([g.lat0, g.lon0], [68.4, 15.25]);
  assert.equal(g.points.length, g.rows * g.cols);
  assert.deepEqual(g.points[0], [68.4, 15.25]);
  assert.deepEqual(g.points[1], [68.4, 15.5]);
  assert.deepEqual(g.points[g.cols], [68.5, 15.25]);
  assert.deepEqual(g.points.at(-1), [69.3, 17.5], "the margin is never cut");
  const w = gridPoints(GRIDS["grid-wide"]);
  assert.deepEqual([w.lat0, w.lon0, w.dLat, w.dLon], [66.6, 11.5, 0.2, 0.5]);
  assert.ok(w.points.at(-1)[1] >= 21.5, "east into Sweden");
  // Open-Meteo's free use: at most 600 points a minute (each grid is fetched in its own minute), 10 000 a day.
  const sites = (await import("../workers/data/src/sites.json")).default;
  const close = gridPoints(GRIDS.grid, sites).points.length;
  assert.ok(VARS.length <= 10, "a point counts once");
  assert.ok(close < 600 && w.points.length < 600, `${close} and ${w.points.length} points`);
  assert.ok(close * 8 + w.points.length * 4 < 7000, "with the winds aloft, well under 10 000 a day");
});

test("grid: the request asks for all the variables for the points, in m/s and Unix time", async () => {
  const { gridUrl, VARS } = await import("../workers/data/src/sources/grid.js");
  const u = new URL(gridUrl([[68.4, 15.25], [68.5, 15.5]]));
  assert.equal(u.searchParams.get("latitude"), "68.4,68.5");
  assert.equal(u.searchParams.get("longitude"), "15.25,15.5");
  assert.equal(u.searchParams.get("hourly").split(",").length, VARS.length);
  assert.equal(u.searchParams.get("wind_speed_unit"), "ms");
  assert.equal(u.searchParams.get("timeformat"), "unixtime");
});

test("grid: the dataset keeps the day hours from now, rounds the values, and refuses a wrong answer", async () => {
  const { buildGrid, VARS, FIRST_HOUR, LAST_HOUR } = await import("../workers/data/src/sources/grid.js");
  const day = Date.parse("2026-10-21T00:00:00Z"), now = Date.parse("2026-10-21T10:20:00Z");
  const time = Array.from({ length: 48 }, (_, i) => (day + i * 3600000) / 1000);
  const answer = (elev) => ({ elevation: elev, hourly: Object.fromEntries([["time", time], ...VARS.map(([n]) => [n, time.map(() => 3.456)])]) });
  const grid = { dLat: 0.1, dLon: 0.25, lat0: 68.4, lon0: 15.25, rows: 1, cols: 2, points: [[68.4, 15.25], [68.4, 15.5]] };
  const d = buildGrid("grid", grid, [answer(-3), answer(412.6)], now);
  assert.equal(d.dataset, "grid");
  assert.deepEqual([d.dLat, d.dLon], [0.1, 0.25]);
  assert.deepEqual(d.elev, [0, 413]);
  const hours = d.times.map((t) => new Date(t * 1000).getUTCHours());
  assert.equal(new Date(d.times[0] * 1000).toISOString(), "2026-10-21T10:00:00.000Z", "from the hour going on");
  assert.ok(hours.every((h) => h >= FIRST_HOUR && h <= LAST_HOUR));
  assert.equal(d.times.length, (LAST_HOUR - 10 + 1) + (LAST_HOUR - FIRST_HOUR + 1));
  assert.equal(d.values.T[1][0], 3.5);
  assert.equal(d.values.wd[0][0], 3);
  assert.equal(d.values.T.length, 2);
  assert.throws(() => buildGrid("grid", grid, [answer(0)], now), /1 svar for 2 punkter/);
  const other = answer(0); other.hourly.time = time.map((t) => t + 3600);
  assert.throws(() => buildGrid("grid", grid, [answer(0), other], now), /ulike timer/);
});

test("grid: the store fetches it in batches and serves it as /v1/grid.json; a failure keeps the previous", async () => {
  const { PER_REQUEST } = await import("../workers/data/src/sources/grid.js");
  const svc = service();
  const clock = { now: Date.parse("2026-10-21T09:21:00Z") };
  const { fakeFetch } = await import("./helpers/data-service.mjs");
  const { fetch } = fakeFetch(clock, []);
  let requests = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (u, o) => { requests++; return fetch(u, o); };
  try {
    // Lofoten to Bardu: more points than one request takes.
    const sites = [{ lat: 68.2, lon: 13.6 }, { lat: 69.0, lon: 18.0 }];
    const out = await svc.store.refreshGrid("grid", sites, clock.now);
    assert.ok(out.points > PER_REQUEST && out.hours > 0);
    assert.equal(requests, Math.ceil(out.points / PER_REQUEST));
    const body = JSON.parse(svc.store.getSnapshot("grid"));
    assert.equal(body.elev.length, out.points);
    assert.equal(body.values.blh[0].length, body.times.length);
    globalThis.fetch = async () => new Response("down", { status: 502 });
    await assert.rejects(() => svc.store.refreshGrid("grid", sites, clock.now + 3 * 3600000), /502/);
    await assert.rejects(() => svc.store.refreshGrid("other", sites, clock.now), /ukjent rutenett/);
    globalThis.fetch = async (u, o) => fetch(u, o);
    await svc.store.refreshGrid("grid-wide", [], clock.now);
    assert.equal(JSON.parse(svc.store.getSnapshot("grid-wide")).dLat, 0.2);
    assert.equal(JSON.parse(svc.store.getSnapshot("grid")).fetched, body.fetched, "the previous grid is kept");
    const res = await withCache(fakeCache(), () => worker.fetch(new Request("https://data.test/v1/grid.json"), svc.env, {}));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dataset, "grid");
  } finally {
    globalThis.fetch = saved;
  }
});

test("APRS reserve: the list of devices that must not be tracked is kept a day, the kept one used when OGN's database is down", async () => {
  const svc = service();
  const saved = globalThis.fetch;
  const devices = Array.from({ length: 1500 }, (_, i) => ({ device_id: `AB${String(i).padStart(4, "0")}`, tracked: i === 7 ? "N" : "Y" }));
  let asked = 0;
  try {
    globalThis.fetch = async () => { throw new Error("nede"); };
    await assert.rejects(() => svc.store.noTrack(1000), /nede/, "no list at all: the reserve gives nothing");
    globalThis.fetch = async () => { asked++; return Response.json({ devices }); };
    assert.deepEqual(await svc.store.noTrack(1000), ["AB0007"]);
    await svc.store.noTrack(1000 + 23 * 3600000);
    assert.equal(asked, 1, "within a day the kept list is used");
    globalThis.fetch = async () => new Response("", { status: 503 });
    assert.deepEqual(await svc.store.noTrack(1000 + 30 * 3600000), ["AB0007"], "the database down: the kept list, however old");
    await assert.rejects(() => svc.store.refreshNoTrack(1000 + 30 * 3600000), /503/, "the daily run reports the failure");
  } finally {
    globalThis.fetch = saved;
  }
});
