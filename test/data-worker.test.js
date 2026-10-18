// Tests for the data service (workers/data): the forecast and the Holfuy stations. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, keepSites, pickSites, MAX_AGE_HOURS } from "../workers/data/src/sources/forecast.js";
import { buildStations, holfuyUrl, parseHolfuy } from "../workers/data/src/sources/holfuy.js";
import { due } from "../workers/data/src/schedule.js";

const NOW = Date.parse("2026-10-18T15:20:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const rows = (start, n = 3) => Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 3600000).toISOString().replace(".000", ""), 200, 5, 9, 0]);
const sites = ["a", "b", "c", "d"].map((id) => ({ id, lat: 68.8, lon: 16.5, altitude: 500 }));

test("picks the launches missing from the state first, then those fetched longest ago", () => {
  const state = { sites: { a: { fetched: ago(5) }, b: { fetched: ago(25) }, c: { fetched: ago(15) } } };
  assert.deepEqual(pickSites(sites, state, 2).map((s) => s.id), ["d", "b"]);
  assert.deepEqual(pickSites(sites, state, 6).map((s) => s.id), ["d", "b", "c", "a"]);
});

test("a site removed from the site files disappears from the state", () => {
  const state = { sites: { a: { fetched: ago(5) }, gone: { fetched: ago(5) } } };
  assert.deepEqual(Object.keys(keepSites(state, sites).sites), ["a"]);
  assert.deepEqual(keepSites(null, sites), { sites: {} });
});

test("the forecast follows the latest start, places the others by time, and is as old as its oldest launch", () => {
  const state = { sites: {
    a: { fetched: ago(30), updated: "2026-10-18T13:00:00Z", rows: rows("2026-10-18T14:00:00Z") },
    b: { fetched: ago(5), updated: "2026-10-18T14:00:00Z", rows: rows("2026-10-18T15:00:00Z") },
  } };
  const f = buildForecast(state, NOW);
  assert.deepEqual(f.times, ["2026-10-18T15:00:00Z", "2026-10-18T16:00:00Z", "2026-10-18T17:00:00Z"]);
  assert.deepEqual(f.sites.a, [[200, 5, 9, 0], [200, 5, 9, 0], null]);
  assert.equal(f.fetched, ago(30));
  assert.equal(f.updated, "2026-10-18T13:00:00Z");
  assert.equal(f.source, "MET Norge");
});

test("launches older than the limit are left out, and nothing fresh gives null", () => {
  const old = { fetched: ago(MAX_AGE_HOURS * 60 + 1), updated: null, rows: rows("2026-10-18T08:00:00Z") };
  assert.equal(buildForecast({ sites: { a: old } }, NOW), null);
  const f = buildForecast({ sites: { a: old, b: { fetched: ago(5), updated: null, rows: rows("2026-10-18T15:00:00Z") } } }, NOW);
  assert.deepEqual(Object.keys(f.sites), ["b"]);
});

test("the forecast carries the common frame: dataset, source, license and fetched", () => {
  const f = buildForecast({ sites: { a: { fetched: ago(5), updated: null, rows: rows("2026-10-18T15:00:00Z") } } }, NOW);
  assert.equal(f.dataset, "forecast");
  assert.equal(f.source, "MET Norge");
  assert.match(f.license, /MET/);
  assert.equal(f.fetched, ago(5));
});

test("Holfuy: one station as an object or several under measurements, times in UTC, bad entries skipped", () => {
  const one = { stationId: 101, stationName: "Heia", dateTime: "2026-10-18 15:10:00", location: { latitude: 68.8, longitude: 16.5, altitude: 420 },
    wind: { speed: 4.2, gust: 7.1, min: 2.0, unit: "m/s", direction: 230 }, temperature: 6.3 };
  assert.deepEqual(parseHolfuy(one), [{ station: 101, name: "Heia", lat: 68.8, lon: 16.5, altitude: 420, time: "2026-10-18T15:10:00.000Z",
    dir: 230, speed: 4.2, gust: 7.1, min: 2, temperature: 6.3 }]);
  const several = parseHolfuy({ measurements: [one, { ...one, stationId: 102, wind: { speed: "3.5" } }, { stationId: 103 }, { dateTime: "2026-10-18 15:00:00" }] });
  assert.deepEqual(several.map((m) => [m.station, m.speed, m.dir]), [[101, 4.2, 230], [102, 3.5, null]]);
  assert.deepEqual(parseHolfuy(null), []);
  assert.deepEqual(parseHolfuy({ error: "wrong password" }), []);
});

test("Holfuy: the request asks for JSON, m/s, °C and UTC for all stations", () => {
  const url = holfuyUrl([101, 102], "secret");
  assert.equal(url.origin + url.pathname, "https://api.holfuy.com/live/");
  assert.equal(url.searchParams.get("s"), "101,102");
  assert.equal(url.searchParams.get("pw"), "secret");
  assert.equal(url.searchParams.get("su"), "m/s");
  assert.equal(url.searchParams.get("m"), "JSON");
  assert.ok(url.searchParams.has("utc"));
});

test("Holfuy: one item per configured station, in that order, with the latest measurement and the history", () => {
  const m = (station, min, speed) => ({ station, time: ago(min), dir: 200, speed, gust: speed + 2, min: speed - 1, temperature: 5 });
  const data = buildStations([{ id: 102, site: "heia" }, { id: 101, name: "Modellflystripa" }, { id: 999 }],
    [m(101, 10, 3), m(101, 5, 4), m(102, 7, 6)], { 101: { name: "MFK", lat: 68.7, lon: 16.4, altitude: 20 }, 102: { name: "Heia Holfuy" } }, NOW);
  assert.equal(data.dataset, "stations");
  assert.equal(data.source, "Holfuy");
  assert.equal(data.fetched, new Date(NOW).toISOString());
  assert.deepEqual(data.items.map((i) => [i.id, i.name, i.site]), [[102, "Heia Holfuy", "heia"], [101, "Modellflystripa", null], [999, "999", null]]);
  assert.deepEqual(data.items[1].wind, { dir: 200, speed: 4, gust: 6, min: 3 });
  assert.equal(data.items[1].time, ago(5));
  assert.deepEqual(data.items[1].history.map((r) => r[2]), [3, 4]);
  assert.equal(data.items[2].time, null);
  assert.equal(data.items[2].wind, null);
});

test("one schedule every minute: the stations every minute, the forecast every fifth", () => {
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((m) => due("stations", minute(m))), [true, true, true, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map((m) => due("forecast", minute(m))), [true, false, false, false, false, true, true]);
});
