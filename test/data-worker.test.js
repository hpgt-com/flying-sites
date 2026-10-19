// Tests for the data service (workers/data): the forecast and the Holfuy stations. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, keepSites, pickSites, MAX_AGE_HOURS } from "../workers/data/src/sources/forecast.js";
import { buildStations, holfuyUrl, parseHolfuy } from "../workers/data/src/sources/holfuy.js";
import { due } from "../workers/data/src/schedule.js";
import { dayPath, daysToArchive, measurementsCsv, pruneBefore, stationsCsv } from "../workers/data/src/archive.js";
import { extraValues } from "../workers/data/src/measurements.js";

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
  assert.match(f.product, /Locationforecast/);
  assert.equal(f.fetched, ago(5));
});

test("Holfuy: one station as an object or several under measurements, times in UTC, bad entries skipped", () => {
  const one = { stationId: 101, stationName: "Heia", dateTime: "2026-10-18 15:10:00", location: { latitude: 68.8, longitude: 16.5, altitude: 420 },
    wind: { speed: 4.2, gust: 7.1, min: 2.0, unit: "m/s", direction: 230 }, temperature: 6.3 };
  assert.deepEqual(parseHolfuy(one), [{ source: "holfuy", station: 101, name: "Heia", lat: 68.8, lon: 16.5, altitude: 420, time: "2026-10-18T15:10:00.000Z",
    dir: 230, speed: 4.2, gust: 7.1, min: 2, temperature: 6.3, humidity: null, pressure: null, rain: null, extra: null }]);
  const several = parseHolfuy({ measurements: [one, { ...one, stationId: 102, wind: { speed: "3.5" } }, { stationId: 103 }, { dateTime: "2026-10-18 15:00:00" }] });
  assert.deepEqual(several.map((m) => [m.station, m.speed, m.dir]), [[101, 4.2, 230], [102, 3.5, null]]);
  assert.deepEqual(parseHolfuy(null), []);
  assert.deepEqual(parseHolfuy({ error: "wrong password" }), []);
});

test("Holfuy: humidity, pressure and rain when the station has them, and unknown numbers kept in extra", () => {
  const m = { stationId: 820, dateTime: "2026-10-18 15:10:00", wind: { speed: 3, direction: 200, unit: "m/s", max: 9 },
    temperature: 4, humidity: 81, pressure: "1012.4", rain: 0.2, battery: 3.9, snow: { depth: 12, note: "x" }, label: "text" };
  const [p] = parseHolfuy(m);
  assert.deepEqual([p.humidity, p.pressure, p.rain], [81, 1012.4, 0.2]);
  assert.deepEqual(p.extra, { "wind.max": 9, battery: 3.9, "snow.depth": 12 });
});

test("unknown values: at most 20, only numbers, plain names", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`v${i}`, i]));
  assert.equal(Object.keys(extraValues(many, new Set())).length, 20);
  assert.equal(extraValues({ "bad key!": 1, ok: "2", text: "abc" }, new Set()).ok, 2);
  assert.equal(extraValues({ "bad key!": 1 }, new Set()), null);
});

test("Holfuy: the request asks for JSON, m/s, °C and UTC for all stations", () => {
  const url = holfuyUrl([101, 102], "secret");
  assert.equal(url.origin + url.pathname, "https://api.holfuy.com/live/");
  assert.equal(url.searchParams.get("s"), "101,102");
  assert.equal(url.searchParams.get("pw"), "secret");
  assert.equal(url.searchParams.get("su"), "m/s");
  assert.equal(url.searchParams.get("m"), "JSON");
  assert.ok(url.searchParams.has("utc"));
  assert.ok(url.searchParams.has("loc"), "asks for the station's position");
});

test("Holfuy: one item per configured station, in that order, with the latest measurement and the history", () => {
  const m = (station, min, speed) => ({ station, time: ago(min), dir: 200, speed, gust: speed + 2, min: speed - 1, temperature: 5 });
  const data = buildStations([{ id: 102, site: "heia" }, { id: 101, name: "Modellflystripa" }, { id: 999 }],
    [m(101, 10, 3), m(101, 5, 4), { ...m(102, 7, 6), station: "102" }], { 101: { name: "MFK", lat: 68.7, lon: 16.4, altitude: 20 }, 102: { name: "Heia Holfuy" } }, NOW);
  assert.equal(data.dataset, "stations");
  assert.equal(data.source, "Holfuy");
  assert.equal(data.fetched, new Date(NOW).toISOString());
  assert.deepEqual(data.items.map((i) => [i.id, i.name, i.site]), [[102, "Heia Holfuy", "heia"], [101, "Modellflystripa", null], [999, "999", null]]);
  assert.equal(data.items[0].time, ago(7), "a station number stored as text still matches");
  assert.deepEqual(data.items[1].wind, { dir: 200, speed: 4, gust: 6, min: 3 });
  assert.equal(data.items[1].time, ago(5));
  assert.deepEqual(data.items[1].history.map((r) => r[2]), [3, 4]);
  assert.deepEqual(data.items[1].history[1], [ago(5), 200, 4, 6, 3, 5], "rows: time, dir, speed, gust, min, temperature");
  assert.equal(data.items[2].time, null);
  assert.equal(data.items[2].wind, null);
});

test("one schedule every minute: the stations every minute, the forecast every fifth", () => {
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((m) => due("stations", minute(m))), [true, true, true, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map((m) => due("forecast", minute(m))), [true, false, false, false, false, true, true]);
});

test("archive: whole UTC days from the oldest measurement or after the last archived, up to yesterday, two at a time", () => {
  const now = Date.parse("2026-10-18T00:10:00Z");
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", null, now), ["2026-10-15", "2026-10-16"]);
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-16", now), ["2026-10-17"]);
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-17", now), []);
  assert.deepEqual(daysToArchive(null, null, now), []);
});

test("archive: nothing is deleted before it is archived, and never the last 7 days", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(pruneBefore(now, 7, null), null);
  assert.equal(pruneBefore(now, 7, "2026-10-05"), "2026-10-06T00:00:00.000Z");
  assert.equal(pruneBefore(now, 7, "2026-10-17"), "2026-10-11T12:00:00.000Z");
});

test("archive: one table for all stations, the station in every row, units in the header, empty cells for missing", () => {
  const header = "source,station,time_utc,direction_deg,speed_ms,gust_ms,min_ms,temperature_c,humidity_pct,pressure_hpa,rain_mm,extra_json\n";
  assert.equal(measurementsCsv([{ source: "holfuy", station: 490, time: "2026-10-17T10:00:00.000Z", dir: 230, speed: 4.2, gust: null, min: 2, temperature: 5.5, humidity: 80, pressure: null, rain: 0, extra: { battery: 3.9 } }]),
    header + 'holfuy,490,2026-10-17T10:00:00.000Z,230,4.2,,2,5.5,80,,0,"{""battery"":3.9}"\n');
  assert.equal(measurementsCsv([]), header);
  assert.equal(dayPath("holfuy", 490, "2026-10-17"), "holfuy/station=490/year=2026/2026-10-17.csv");
  assert.equal(stationsCsv([{ source: "holfuy", id: 490, name: 'HPGT "Heia", topp', model: null, site: "heia", lat: 68.8, lon: 16.5, altitude: 420 }]),
    'source,station,name,model,site,lat,lon,altitude_m\nholfuy,490,"HPGT ""Heia"", topp",,heia,68.8,16.5,420\n');
});

test("the forecast archive: the hour going on, grouped by site, and past in the dataset", async () => {
  const { hourNow, groupPast } = await import("../workers/data/src/sources/forecast.js");
  const rows = [["2026-10-18T14:00:00Z", 200, 4, 7, 0], ["2026-10-18T15:00:00Z", 210, 5, 8, 0], ["2026-10-18T16:00:00Z", 220, 6, 9, 0]];
  assert.deepEqual(hourNow(rows, NOW), rows[1], "15.20 is in the hour from 15.00");
  assert.equal(hourNow(rows, Date.parse("2026-10-18T18:00:00Z")), null);
  const past = groupPast([
    { site: "b", time: "2026-10-18T15:00:00Z", dir: 1, speed: 2, gust: 3 },
    { site: "a", time: "2026-10-18T15:00:00Z", dir: 5, speed: 6, gust: 7 },
    { site: "a", time: "2026-10-18T14:00:00Z", dir: 4, speed: 5, gust: 6 },
  ]);
  assert.deepEqual(past, { a: [["2026-10-18T14:00:00Z", 4, 5, 6], ["2026-10-18T15:00:00Z", 5, 6, 7]], b: [["2026-10-18T15:00:00Z", 1, 2, 3]] });
  const state = { sites: { a: { fetched: ago(10), updated: null, rows: rows.map(([t, ...v]) => [t, ...v]) } } };
  assert.deepEqual(buildForecast(state, NOW, past).past, past);
  assert.equal(buildForecast(state, NOW, {}).past, undefined, "no past field when there is nothing stored yet");
});

// --- MET's stations (Frost) ---
const frostMod = await import("../workers/data/src/sources/frost.js");
const { mergeStations } = await import("../workers/data/src/merge.js");
const { archiveSource } = await import("../workers/data/src/archive.js");

test("Frost: the area of the sites as a polygon, and MET's capital names", () => {
  assert.equal(frostMod.areaPolygon([{ lat: 68.8, lon: 16.5 }, { lat: 68.6, lon: 16.0 }], 0.1),
    "POLYGON((15.900 68.500, 16.600 68.500, 16.600 68.900, 15.900 68.900, 15.900 68.500))");
  assert.equal(frostMod.stationName("EVENES LUFTHAVN"), "Evenes lufthavn");
});

test("Frost: sources as stations, only land stations with a position", () => {
  const stations = frostMod.parseSources({ data: [
    { id: "SN84970", name: "EVENES LUFTHAVN", masl: 26, geometry: { type: "Point", coordinates: [16.6767, 68.4913] } },
    { id: "SN99999", name: "NO POSITION" },
    { id: "XX1", name: "OTHER", geometry: { coordinates: [1, 2] } },
  ] });
  assert.deepEqual(stations, [{ id: "SN84970", name: "Evenes lufthavn", lat: 68.4913, lon: 16.6767, altitude: 26 }]);
});

test("Frost: observations as measurements, the latest time with wind, other elements from that time", () => {
  const obs = (id, time, list) => ({ sourceId: id + ":0", referenceTime: time, observations: list.map(([e, v]) => ({ elementId: e, value: v })) });
  const m = frostMod.parseObservations({ data: [
    obs("SN84970", "2026-10-18T15:10:00.000Z", [["wind_speed", 5.1], ["wind_from_direction", 230], ["max(wind_speed_of_gust PT10M)", 8.4], ["air_temperature", 6.2]]),
    obs("SN84970", "2026-10-18T15:00:00.000Z", [["wind_speed", 4.0], ["sum(precipitation_amount PT1H)", 0.4]]),
    obs("SN87110", "2026-10-18T15:00:00.000Z", [["air_temperature", 5]]),
  ] });
  assert.equal(m.length, 1, "a station without wind is left out");
  assert.deepEqual(m[0], { source: "met", station: "SN84970", time: "2026-10-18T15:10:00.000Z", dir: 230, speed: 5.1, gust: 8.4, min: null,
    temperature: 6.2, humidity: null, pressure: null, rain: null, extra: null });
});

test("Frost: the dataset has only stations with measurements, sorted by name, with MET as source and licence", () => {
  const stations = [{ id: "SN2", name: "Kvæfjord", lat: 68.7, lon: 16.2, altitude: 10 }, { id: "SN1", name: "Evenes", lat: 68.5, lon: 16.7, altitude: 26 }, { id: "SN3", name: "Stille", lat: 1, lon: 1 }];
  const rows = [{ station: "SN1", time: ago(10), dir: 200, speed: 4, gust: 7, temperature: 5 }, { station: "SN2", time: ago(5), dir: 210, speed: 3, gust: null, temperature: 4 }];
  const d = frostMod.buildStations(stations, rows, { SN2: "kilhusasen" }, NOW);
  assert.deepEqual(d.items.map((i) => i.id), ["SN1", "SN2"]);
  assert.equal(d.items[1].site, "kilhusasen");
  assert.equal(d.items[0].source, "MET Norge");
  assert.deepEqual(d.items[0].history[0], [ago(10), 200, 4, 7, null, 5]);
  assert.match(d.license, /MET/);
});

test("the stations dataset joins Holfuy's and MET's, each station with its source", () => {
  const h = JSON.stringify({ dataset: "stations", source: "Holfuy", fetched: ago(1), items: [{ id: 490, name: "HPGT Heia" }] });
  const m = JSON.stringify({ dataset: "stations-met", source: "MET Norge", license: "CC BY 4.0, MET Norge", fetched: ago(3), items: [{ id: "SN1", name: "Evenes" }] });
  const d = JSON.parse(mergeStations(h, m));
  assert.equal(d.dataset, "stations");
  assert.equal(d.source, "Holfuy, MET Norge");
  assert.equal(d.fetched, ago(1));
  assert.deepEqual(d.items.map((i) => [i.id, i.source]), [[490, "Holfuy"], ["SN1", "MET Norge"]]);
  assert.equal(d.license, "CC BY 4.0, MET Norge");
  assert.equal(JSON.parse(mergeStations(h, null)).items.length, 1);
  assert.equal(mergeStations(null, null), null);
});

test("the archive writes a source's finished days per station and prunes only what is archived", async () => {
  const files = {}, state = {}, pruned = [];
  const day = (d, h) => `2026-10-${d}T${h}:00:00.000Z`;
  const rows = [{ source: "met", station: "SN1", time: day(16, "10") }, { source: "met", station: "SN2", time: day(16, "11") }, { source: "met", station: "SN1", time: day(17, "10") }];
  const store = {
    getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = v; },
    oldestMeasurement: async () => rows[0].time,
    measurementsBetween: async (src, from, to) => rows.filter((r) => r.time >= from && r.time <= to),
    prune: async (src, before) => pruned.push([src, before]),
  };
  const env = { ARCHIVE: { put: async (path, body) => { files[path] = body; } } };
  await archiveSource(store, env, "met", [{ source: "met", id: "SN1", name: "Evenes" }], 7, Date.parse("2026-10-18T03:00:00Z"));
  assert.deepEqual(Object.keys(files).sort(), ["met/station=SN1/year=2026/2026-10-16.csv", "met/station=SN1/year=2026/2026-10-17.csv", "met/station=SN2/year=2026/2026-10-16.csv", "met/stations.csv"]);
  assert.equal(state["met-archive"].through, "2026-10-17");
  assert.deepEqual(pruned, [["met", "2026-10-11T03:00:00.000Z"]], "only what is older than 7 days, and archived");
  await archiveSource(store, {}, "met", [], 7, Date.now());
});

test("Frost: only stations within 15 km of a launch are kept", () => {
  const sites = [{ lat: 68.8, lon: 16.5 }];
  const kept = frostMod.nearSites([{ id: "SN1", lat: 68.85, lon: 16.6 }, { id: "SN2", lat: 68.4913, lon: 16.6767 }], sites);
  assert.deepEqual(kept.map((s) => s.id), ["SN1"], "Evenes is about 35 km from this launch");
});
