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
  // The heavier sources never share a minute (one invocation has 10 ms of CPU in all).
  for (let m = 0; m < 60; m++) assert.ok(["forecast", "met", "windgram", "verify"].filter((n) => due(n, minute(m))).length <= 1, `minute ${m}`);
});

test("archive: whole UTC days from the oldest measurement or after the last archived, up to yesterday, two at a time", () => {
  const now = Date.parse("2026-10-18T03:10:00Z");
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-16", Date.parse("2026-10-18T00:10:00Z")), [], "yesterday waits a few hours for late measurements");
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
    "POLYGON((15.800 68.500, 16.700 68.500, 16.700 68.900, 15.800 68.900, 15.800 68.500))", "twice the margin east–west");
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

test("Frost: stations within 50 km of a launch are kept, from Lofoten to Bardu", () => {
  const sites = [{ lat: 68.8, lon: 16.5 }];
  const kept = frostMod.nearSites([{ id: "SN1", lat: 68.85, lon: 16.6 }, { id: "SN2", lat: 68.4913, lon: 16.6767 }, { id: "SN3", lat: 69.06, lon: 18.54 }], sites);
  assert.deepEqual(kept.map((s) => s.id), ["SN1", "SN2"], "Evenes (about 35 km) is kept; Bardufoss (about 85 km from this launch) is not");
});

// --- Winds aloft (Open-Meteo) ---
const windgramMod = await import("../workers/data/src/sources/windgram.js");

test("windgram: every ten minutes, only fresh launches, as old as the oldest, and a failed launch keeps its grid", async () => {
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([0, 7, 9, 17].map((m) => due("windgram", minute(m))), [false, true, false, true]);
  const picked = windgramMod.pickSites([{ id: "a" }, { id: "b" }, { id: "c" }], { sites: { a: { fetched: ago(5) }, b: { fetched: ago(40) } } });
  assert.deepEqual(picked.map((s) => s.id), ["c", "b"], "the missing launch first, then the one fetched longest ago");
  const grid = { times: [1], heights: [250], cells: [[[200, 4]]], blh: [800], cloudBase: [900], cape: [0] };
  const state = { sites: { a: { fetched: ago(10), grid }, b: { fetched: ago(30), grid }, old: { fetched: ago(7 * 60), grid } } };
  const body = windgramMod.buildWindgram(state, NOW);
  assert.deepEqual(Object.keys(body.sites), ["a", "b"]);
  assert.equal(body.fetched, ago(30));
  assert.equal(body.dataset, "windgram");
  assert.equal(body.source, "Open-Meteo");
  assert.equal(windgramMod.buildWindgram({ sites: {} }, NOW), null);

  const saved = {};
  const store = { getState: async () => state, putState: async (k, v) => { saved.state = v; }, putSnapshot: async (k, v) => { saved[k] = JSON.parse(v); } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("nede"); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await windgramMod.run(store, [{ id: "a", lat: 68, lon: 16, altitude: 500 }], NOW, ["a"]);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
  assert.deepEqual(Object.keys(saved.state.sites), ["a"], "sites no longer in the list are dropped");
  assert.equal(saved.state.sites.a.fetched, ago(10), "the failed launch keeps its previous grid");
  assert.deepEqual(saved.windgram.sites.a, grid);
});

// --- How well the forecast hit ---
const verifyMod = await import("../workers/data/src/sources/verify.js");
const { siteLinks } = await import("../workers/data/src/stations.js");

test("verification: the hour's measurements, the pairs for finished hours, and the summary", () => {
  const H = Date.parse("2026-10-18T14:00:00Z");
  const at = (min) => new Date(H + min * 60000).toISOString();
  const rows = [
    { source: "holfuy", station: "490", time: at(0), dir: 200, speed: 9, gust: 20 },
    { source: "holfuy", station: "490", time: at(20), dir: 200, speed: 4, gust: 6 },
    { source: "holfuy", station: "490", time: at(40), dir: 220, speed: 6, gust: 9 },
    { source: "met", station: "SN1", time: at(60), dir: 270, speed: 8, gust: 12 },
  ];
  const m = verifyMod.measuredHour(rows.filter((r) => r.source === "holfuy"), H);
  assert.equal(m.n, 2, "the row exactly at the start belongs to the hour before");
  assert.equal(m.speed, 5);
  assert.equal(m.gust, 9);
  assert.equal(verifyMod.measuredHour(rows.filter((r) => r.source === "met"), H).speed, 8, "MET's value at the end of the hour");
  const links = [{ site: "heia", source: "holfuy", station: "490" }, { site: "saetertinden", source: "met", station: "SN1" }];
  const hours = [
    { site: "heia", time: at(0), dir: 210, speed: 4, gust: 7 },
    { site: "saetertinden", time: at(0), dir: 260, speed: 10, gust: 15 },
    { site: "heia", time: at(60), dir: 210, speed: 4, gust: 7 },
  ];
  const p = verifyMod.pairs(links, hours, rows, H - 3600000, H + 61 * 60000);
  assert.deepEqual(p.map((x) => [x.site, x.m_speed, x.f_speed]), [["heia", 5, 4], ["saetertinden", 8, 10]], "the unfinished hour is left out");
  const sum = verifyMod.summarize([...Array(5)].map(() => p[0]).concat([p[1]]));
  assert.equal(sum.hours, 6);
  assert.equal(sum.bias, 0.5, "(5 × +1 − 2) / 6, measured minus forecast");
  assert.equal(sum.mae, 1.2);
  assert.equal(sum.dirHit, 1);
  assert.deepEqual(sum.sectors, { SW: { hours: 5, bias: 1 } }, "W has too few hours");
  assert.equal(verifyMod.summarize([]), null);
});

test("verification: the sites with their own station or one nearby, and its run time", () => {
  assert.deepEqual(siteLinks(), [{ site: "heia", source: "holfuy", station: "490" }, { site: "hinnstein", source: "holfuy", station: "490" },
    { site: "saetertinden", source: "met", station: "SN87772" }]);
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([9, 39, 10].map((m) => due("verify", minute(m))), [true, true, false]);
});

// --- «Meld fra om endring» ---
const reportMod = await import("../workers/data/src/report.js");

test("report: checked fields, and the issue with the text in a code block", () => {
  const names = { heia: "Heia" };
  const ok = { site: "heia", kind: "access", message: "  Bommen ved P-plassen er låst.  ", name: "Kari", token: "t" };
  const r = reportMod.checkReport(ok, names);
  assert.equal(r.message, "Bommen ved P-plassen er låst.");
  assert.equal(reportMod.checkReport({ ...ok, site: "toString" }, names).error, "bad-request", "only real sites");
  assert.equal(reportMod.checkReport({ ...ok, kind: "spam" }, names).error, "bad-request");
  assert.equal(reportMod.checkReport({ ...ok, message: "kort" }, names).error, "bad-length");
  assert.equal(reportMod.checkReport({ ...ok, message: "x".repeat(1001) }, names).error, "bad-length");
  assert.equal(reportMod.checkReport({ ...ok, token: "" }, names).error, "no-token");
  const issue = reportMod.issueFor({ ...r, message: "Se @noen og ~~~ ![x](http://a)" }, NOW);
  assert.equal(issue.title, "[Meld fra] Heia: Vei, parkering eller adkomst");
  assert.deepEqual(issue.labels, ["endringsforslag", "site-data"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "hazard" }, NOW).labels, ["endringsforslag", "site-data", "safety"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "other" }, NOW).labels, ["endringsforslag", "site-data"], "«Annet» on a site page concerns the site");
  assert.match(issue.body, /~~~text\nSe @noen og ~ ~ ~ !\[x\]\(http:\/\/a\)\n~~~/, "the text stays inside one code block");
});

// The store's «Meld fra» methods (store.js reportSalt, reserveReport, releaseReport) as the Durable Object runs them.
function reportStore() {
  const counts = {};
  return {
    counts,
    reportSalt: async (day) => `salt-${day}`,
    reserveReport: async (day, who, dailyLimit, perIpLimit) => {
      const c = (counts[day] ??= { n: 0, ips: {} });
      if (c.n >= dailyLimit) return "limit";
      if (who && (c.ips[who] ?? 0) >= perIpLimit) return "ip-limit";
      c.n += 1;
      if (who) c.ips[who] = (c.ips[who] ?? 0) + 1;
      return "ok";
    },
    releaseReport: async (day, who) => { const c = counts[day]; c.n -= 1; if (who) c.ips[who] -= 1; },
  };
}

test("report: needs both secrets, Turnstile for our hostname, JSON, and stays within the limits", async () => {
  const store = reportStore();
  const req = (body, ip = "203.0.113.7", headers = {}) => new Request("https://data.test/v1/report", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
  });
  const body = { site: "heia", kind: "hazard", message: "Ny kraftlinje over landingen.", token: "t" };
  const names = { heia: "Heia" };
  assert.equal((await reportMod.handleReport(req(body), {}, store, names, NOW)).status, 503);
  const env = { TURNSTILE_SECRET: "s", GITHUB_ISSUES_TOKEN: "g" };
  const calls = [];
  const realFetch = globalThis.fetch;
  let turnstile = true, hostname = "flysteder.hpgt.com", github = 201;
  let answer = { number: 171, html_url: "https://github.com/hpgt-com/flying-sites/issues/171" };
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("siteverify")) return Response.json({ success: turnstile, hostname });
    return Response.json(answer, { status: github });
  };
  try {
    const sent = await reportMod.handleReport(req(body), env, store, names, NOW);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { ok: true, issue: 171, url: "https://github.com/hpgt-com/flying-sites/issues/171" }, "the issue's number and address for the thanks");
    answer = { number: 5, html_url: "https://evil.example/issues/5" };
    assert.deepEqual((await reportMod.handleReport(req(body), env, store, names, NOW)).body, { ok: true }, "only an issue in the repository is passed on");
    assert.ok(calls.some((u) => u.endsWith("/repos/hpgt-com/flying-sites/issues")));
    turnstile = false;
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 403);
    turnstile = true;
    hostname = "evil.example";
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 403, "a token solved on another site is refused");
    hostname = "flysteder.hpgt.com";
    assert.equal((await reportMod.handleReport(req(body, "1.2.3.4", { "content-type": "text/plain" }), env, store, names, NOW)).status, 415);
    assert.equal((await reportMod.handleReport(req(JSON.stringify({ ...body, message: "x".repeat(reportMod.MAX_BODY) })), env, store, names, NOW)).status, 413);
    // Two sent so far from 203.0.113.7; the address may send PER_IP_LIMIT in all, then it is stopped, others are not.
    for (let i = 2; i < reportMod.PER_IP_LIMIT; i++) assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 200);
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 429, "one address at most PER_IP_LIMIT a day");
    assert.equal((await reportMod.handleReport(req(body, "198.51.100.9"), env, store, names, NOW)).status, 200);
    // GitHub fails: the reservation is given back.
    github = 500;
    const before = store.counts["2026-10-18"].n;
    assert.equal((await reportMod.handleReport(req(body, "198.51.100.9"), env, store, names, NOW)).status, 502);
    assert.equal(store.counts["2026-10-18"].n, before);
    github = 201;
    store.counts["2026-10-18"].n = reportMod.DAILY_LIMIT;
    assert.equal((await reportMod.handleReport(req(body, "192.0.2.1"), env, store, names, NOW)).status, 429, "the daily limit for all");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("report: with the GitHub App, a signed JWT gets an installation token that makes the issue", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const ghApp = await import("../workers/data/src/github-app.js");
  const jwt = await ghApp.appJwt(12345, pem, NOW);
  const [h, c, s] = jwt.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${h}.${c}`);
  assert.ok(verify.verify(publicKey, Buffer.from(s, "base64url")), "signed with the app's key (PKCS#1 wrapped as PKCS#8)");
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url")), { iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: "12345" });

  const calls = [];
  const realFetch = globalThis.fetch;
  let tokenAsk = null;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([String(url), init.headers?.authorization ?? ""]);
    if (String(url).includes("siteverify")) return Response.json({ success: true, hostname: "flysteder.hpgt.com" });
    if (String(url).endsWith("/installation")) return Response.json({ id: 99 });
    if (String(url).endsWith("/app/installations/99/access_tokens")) { tokenAsk = JSON.parse(init.body); return Response.json({ token: "inst-token" }, { status: 201 }); }
    return new Response("{}", { status: 201 });
  };
  try {
    const store = reportStore();
    const req = new Request("https://data.test/v1/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: "heia", kind: "other", message: "Test av appen her.", token: "t" }) });
    const res = await reportMod.handleReport(req, { TURNSTILE_SECRET: "s", REPORTS_APP_ID: "12345", REPORTS_APP_PRIVATE_KEY: pem }, store, { heia: "Heia" }, NOW);
    assert.equal(res.status, 200);
    assert.deepEqual(calls.find(([u]) => u.endsWith("/repos/hpgt-com/flying-sites/issues")), ["https://api.github.com/repos/hpgt-com/flying-sites/issues", "Bearer inst-token"]);
    assert.deepEqual(tokenAsk, { repositories: ["flying-sites"], permissions: { issues: "write" } }, "the token is asked for with only this repository and Issues: write");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("report: a general report from /meld-fra/ has no site and its own kinds", () => {
  const names = { heia: "Heia" };
  const base = { message: "Det mangler et flysted på Senja.", token: "t" };
  const r = reportMod.checkReport({ ...base, site: "", kind: "newsite" }, names);
  assert.equal(r.error, undefined);
  assert.equal(reportMod.checkReport({ ...base, site: "", kind: "landing" }, names).error, "bad-request", "site kinds need a site");
  assert.equal(reportMod.checkReport({ ...base, site: "heia", kind: "newsite" }, names).error, "bad-request");
  const issue = reportMod.issueFor(r, NOW);
  assert.equal(issue.title, "[Meld fra] Generelt: Nytt flysted");
  assert.match(issue.body, /gjelder ikke ett bestemt flysted/);
  assert.deepEqual(issue.labels, ["endringsforslag", "site-data"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "bug" }, NOW).labels, ["bug"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "idea" }, NOW).labels, ["enhancement"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "other" }, NOW).labels, [], "a general «Annet» may be anything");
});

// --- Piloter i lufta (OGN) ---
const liveMod = await import("../workers/data/src/live.js");

test("live: OGN's answer as items, unknown names hidden, old ones and other aircraft than paragliders left out, newest first", () => {
  const xml = `<?xml version="1.0"?><markers>
<m a="68.625748,15.306080,_e6,c37e55e6,807,09:01:35,40,240,36,-1.4,7,AVX1058,0,c37e55e6"/>
<m a="69.483269,18.693029,FS,Ola,1613,09:09:04,10,216,40,4.9,7,AVX1004,4780BA,e42e25c5"/>
<m a="69.483269,18.693029,FS,Hang,1613,09:09:04,10,216,40,4.9,6,AVX1004,4780BA,d42e25c5"/>
<m a="69.483269,18.693029,FS,LN-WFS,3613,09:09:04,10,216,198,4.9,9,AVX1004,4780BA,f42e25c5"/>
<m a="68.8,16.5,X,Old,500,08:00:00,900,0,0,0,7,AVX970,0,aaaaaaaa"/>
<m a="68.8,16.5,X,Mast,500,08:00:00,5,0,0,0,15,AVX970,0,bbbbbbbb"/>
<m a="bad"/></markers>`;
  const items = liveMod.parseLive(xml, NOW);
  assert.deepEqual(items.map((i) => i.id), ["e42e25c5", "c37e55e6"]);
  assert.equal(items[1].name, null, "OGN's random name is not shown");
  assert.equal(items[0].name, "Ola");
  assert.equal(items[1].speed, 10, "km/h to m/s");
  assert.equal(items[1].type, 7);
  assert.equal(items[1].time, new Date(NOW - 40000).toISOString());
  const b = liveMod.bounds([{ lat: 68, lon: 16 }, { lat: 69, lon: 17 }]);
  assert.deepEqual(b, { n: 69.5, s: 67.5, e: 18, w: 15 });
});

test("live: answered from the cache when fresh, OGN asked otherwise, 503 when OGN fails", async () => {
  const store = new Map();
  const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, r); } };
  const realFetch = globalThis.fetch;
  let calls = 0, fail = false;
  globalThis.fetch = async () => { calls++; if (fail) throw new Error("nede"); return new Response('<markers><m a="68.8,16.5,P,Pilot,900,09:00:00,3,90,30,1.2,7,AVX970,DD1234,dd1234ab"/></markers>'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sites = [{ lat: 68.8, lon: 16.5 }];
    const first = await (await liveMod.handleLive(sites, NOW, cache)).json();
    assert.equal(first.items[0].name, "Pilot");
    await liveMod.handleLive(sites, NOW, cache);
    assert.equal(calls, 1, "the second answer came from the cache");
    fail = true;
    assert.equal((await liveMod.handleLive(sites, NOW, null)).status, 503);
    const empty = new Map();
    const cache2 = { match: async (k) => empty.get(k.url)?.clone(), put: async (k, r) => { empty.set(k.url, r); } };
    calls = 0;
    assert.equal((await liveMod.handleLive(sites, NOW, cache2)).status, 503);
    assert.equal((await liveMod.handleLive(sites, NOW, cache2)).status, 503);
    assert.equal(calls, 1, "after a failure the answer is 503 at once for a while, OGN is not asked again");
    assert.equal(empty.get("https://data.hpgt.workers.dev/v1/live.json?failed").headers.get("cache-control"), `public, max-age=${liveMod.FAIL_SECONDS}`);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
});

test("live: the track of each aircraft over the last minutes, oldest first, the old part dropped", async () => {
  const tracks = new Map();
  const at = (min) => new Date(NOW + min * 60000).toISOString();
  liveMod.mergeTrails(tracks, [{ id: "a", time: at(0), lat: 1, lon: 1, climb: 1.5 }], NOW, 600000);
  liveMod.mergeTrails(tracks, [{ id: "a", time: at(0), lat: 9, lon: 9, climb: 0 }], NOW, 600000);
  const t = liveMod.mergeTrails(tracks, [{ id: "a", time: at(5), lat: 2, lon: 2, climb: -2 }, { id: "b", time: at(5), lat: 3, lon: 3 }], NOW + 5 * 60000, 600000);
  assert.deepEqual(t, { a: [[1, 1, 1.5], [2, 2, -2]], b: [[3, 3, null]] }, "the same time is not added twice; the climb kept with each point");
  const later = liveMod.mergeTrails(tracks, [{ id: "b", time: at(16), lat: 4, lon: 4, climb: 0.4 }], NOW + 16 * 60000, 600000);
  assert.deepEqual(later, { b: [[4, 4, 0.4]] }, "the point from 11 minutes ago is dropped");
  assert.equal(tracks.has("a"), false, "a track older than ten minutes is dropped");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<markers><m a="68.8,16.5,P,Pilot,900,09:00:00,0,90,30,1.2,7,AVX970,DD1234,dd1234ab"/></markers>');
  try {
    const mem = new Map();
    const store = { mergeLive: async (p, now, keep) => liveMod.mergeTrails(mem, p, now, keep) };
    const res = await (await liveMod.handleLive([{ lat: 68.8, lon: 16.5 }], NOW, null, store)).json();
    assert.deepEqual(res.items[0].trail, [[68.8, 16.5, 1.2]]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- Flyaktivitet per sted (OGN) ---
const flightsMod = await import("../workers/data/src/sources/flights.js");

test("flights: each flight counted for the site nearest where first seen, a new one after landing, only sums per site", () => {
  const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }, { id: "elgen", lat: 68.89, lon: 16.28 }];
  const at = (s) => new Date(NOW - s * 1000).toISOString();
  const day = { day: "2026-10-18", pilots: {} };
  const seen = [
    { key: "a", lat: 68.801, lon: 16.501, alt: 600, speed: 8, climb: 1.5, time: at(10) },
    { key: "b", lat: 68.80, lon: 16.50, alt: 480, speed: 0, climb: 0, time: at(10) },
    { key: "c", lat: 69.5, lon: 18.0, alt: 900, speed: 9, climb: 0, time: at(10) },
    { key: "d", lat: 68.80, lon: 16.50, alt: 700, speed: 9, climb: 0, time: at(400) },
  ];
  assert.equal(flightsMod.observe(day, seen, sites, NOW, 2), true);
  assert.deepEqual(Object.keys(day.pilots).sort(), ["a", "c"], "standing at launch and old positions are not flying");
  assert.deepEqual(day.pilots.c.flights, {}, "first seen far from every site: counted for none");
  assert.equal(flightsMod.observe(day, [seen[0]], sites, NOW, 2), false, "the same position is not counted twice");
  flightsMod.observe(day, [{ ...seen[0], lat: 68.85, lon: 16.40, alt: 1400, time: at(0) }], sites, NOW, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "flying on nearer another site is the same flight");
  assert.equal(day.pilots.a.minutes.heia, 4);

  // Lands (two runs standing still), walks up and flies again: a second flight. One run slow and level is not a landing.
  const ground = (s) => ({ key: "a", lat: 68.80, lon: 16.50, alt: 60, speed: 0, climb: 0, time: at(-s) });
  const air = (s) => ({ key: "a", lat: 68.801, lon: 16.501, alt: 600, speed: 8, climb: 1, time: at(-s) });
  flightsMod.observe(day, [ground(120)], sites, NOW + 120000, 2);
  flightsMod.observe(day, [air(240)], sites, NOW + 240000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "one run on the ground is not a landing");
  flightsMod.observe(day, [ground(360)], sites, NOW + 360000, 2);
  flightsMod.observe(day, [ground(480)], sites, NOW + 480000, 2);
  flightsMod.observe(day, [air(1800)], sites, NOW + 1800000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 2 }, "a new flight after landing");
  flightsMod.observe(day, [air(1800 + 20 * 60)], sites, NOW + (1800 + 20 * 60) * 1000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 3 }, "not heard for 20 minutes: a new flight");

  const rows = flightsMod.dayRows(day);
  assert.deepEqual(rows, [{ day: "2026-10-18", site: "heia", flights: 3, pilots: 1, minutes: 10, max_dist: 6.9, max_alt: 1400 }]);

  const data = flightsMod.buildFlights([
    { day: "2026-09-30", site: "heia", flights: 5, pilots: 3, minutes: 90, max_dist: 2, max_alt: 900 },
    { day: "2026-10-18", site: "heia", flights: 3, pilots: 1, minutes: 10, max_dist: 7.5, max_alt: 1400 },
  ], "2026-09-01", NOW);
  assert.deepEqual(data.sites.heia, { flights: 8, days: 2, pilots: 4, minutes: 100, maxDist: 7.5, maxAlt: 1400, last: "2026-10-18",
    months: { "2026-09": { flights: 5, days: 1, pilots: 3, minutes: 90 }, "2026-10": { flights: 3, days: 1, pilots: 1, minutes: 10 } },
    recent: { "2026-09-30": { flights: 5, minutes: 90 }, "2026-10-18": { flights: 3, minutes: 10 } } });
  const old = flightsMod.buildFlights([{ day: "2026-08-01", site: "heia", flights: 1, pilots: 1, minutes: 2, max_dist: 0, max_alt: null }], "2026-08-01", NOW);
  assert.deepEqual(old.sites.heia.recent, {}, "only the last 31 days per day");
  assert.equal(data.since, "2026-09-01");
  assert.equal(flightsMod.osloDay(Date.parse("2026-10-18T22:30:00Z")), "2026-10-19", "a Norwegian day");
});

test("flights: high over the ground is still flying, after a gap or standing still in the wind", async () => {
  const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
  const at = (s) => new Date(NOW + s * 1000).toISOString();
  const air = (s, alt = 900) => ({ key: "a", lat: 68.80, lon: 16.50, alt, speed: 8, climb: 1, time: at(s) });
  const hover = (s) => ({ key: "a", lat: 68.80, lon: 16.50, alt: 900, speed: 0, climb: 0, time: at(s) });
  const day = { day: "2026-10-18", pilots: {} };
  flightsMod.observe(day, [air(0)], sites, NOW, 2);
  // Out of reach for 40 minutes, last seen 900 m up where the ground is 400 m: the same flight.
  assert.deepEqual(flightsMod.needsGround(day, [air(2400)], NOW + 2400000), [["a", 68.80, 16.50]]);
  flightsMod.observe(day, [air(2400)], sites, NOW + 2400000, 2, { a: 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "out of reach high up: the same flight");
  // Standing still in the wind 500 m over the ground: not landed.
  flightsMod.observe(day, [hover(2520)], sites, NOW + 2520000, 2);
  assert.deepEqual(flightsMod.needsGround(day, [hover(2640)], NOW + 2640000), [["a", 68.80, 16.50]]);
  flightsMod.observe(day, [hover(2640)], sites, NOW + 2640000, 2, { a: 400 });
  assert.equal(day.pilots.a.flying, true, "hovering high up is not landing");
  flightsMod.observe(day, [air(2760)], sites, NOW + 2760000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 });
  // Last seen 50 m over the ground, heard again 30 minutes later in the air: landed and a new flight.
  flightsMod.observe(day, [air(2880, 450)], sites, NOW + 2880000, 2);
  flightsMod.observe(day, [air(4680)], sites, NOW + 4680000, 2, { a: 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 2 }, "a gap after being low: a new flight");
  // Without the ground's height a gap means landed, and after MAX_GAP_MINUTES whatever the height.
  flightsMod.observe(day, [air(4680 + 1200)], sites, NOW + (4680 + 1200) * 1000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 3 });
  assert.deepEqual(flightsMod.needsGround(day, [air(5880 + 3 * 3600)], NOW + (5880 + 3 * 3600) * 1000), [], "after two hours the height is not asked");

  const realFetch = globalThis.fetch;
  let asked = null;
  globalThis.fetch = async (url) => { asked = String(url); return Response.json({ punkter: [{ z: 412.3 }, { z: null }] }); };
  try {
    assert.deepEqual(await flightsMod.groundAt([["a", 68.8, 16.5], ["b", 70, 30]]), { a: 412.3 }, "a point without a height is left out");
    assert.match(decodeURIComponent(asked), /punkter=\[\[16\.5,68\.8\],\[30,70\]\]/);
    globalThis.fetch = async () => new Response("", { status: 500 });
    const warn = console.warn; console.warn = () => {};
    assert.deepEqual(await flightsMod.groundAt([["a", 68.8, 16.5]]), {});
    console.warn = warn;
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("flights: a run keeps only the day's keys, made with a salt that is thrown away the next day", async () => {
  const state = {}, days = new Map(), snaps = {};
  const store = {
    getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = structuredClone(v); },
    putFlightDays: async (rows) => { for (const r of rows) days.set(`${r.day}|${r.site}`, r); },
    flightDays: async () => [...days.values()], putSnapshot: async (d, b) => { snaps[d] = JSON.parse(b); },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<markers><m a="68.801,16.501,P,Pilot,900,09:00:00,5,90,30,1.2,7,AVX970,DD1234,dd1234ab"/></markers>');
  try {
    const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
    await flightsMod.run(store, sites, NOW, 2);
    const today = state["flights-today"];
    assert.equal(Object.keys(today.pilots).length, 1);
    assert.ok(!JSON.stringify(today).includes("dd1234ab"), "the device id is not stored, only a key");
    assert.equal(snaps.flights.sites.heia.flights, 1);
    await flightsMod.run(store, sites, NOW + 120000, 2);
    assert.equal(snaps.flights.sites.heia.flights, 1, "still in the air: the same flight");
    assert.equal(snaps.flights.sites.heia.pilots, 1);
    assert.equal(snaps.flights.sites.heia.minutes, 4);
    globalThis.fetch = async () => new Response("<markers></markers>");
    await flightsMod.run(store, sites, NOW + 86400000, 2);
    assert.notEqual(state["flights-today"].salt, today.salt, "a new salt each day");
    assert.equal(snaps.flights.sites.heia.days, 1, "the old day's pilots are gone; a new day with nobody flying adds nothing");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the queue: a failed try sends a launch to the back, so launches that keep failing do not take every run", () => {
  const state = { sites: { a: { fetched: ago(60), tried: ago(1) }, b: { fetched: ago(25) }, c: { tried: ago(2) } } };
  assert.deepEqual(pickSites(sites, state, 2).map((s) => s.id), ["d", "b"]);
  assert.deepEqual(pickSites(sites, state, 4).map((s) => s.id), ["d", "b", "c", "a"]);
  assert.equal(windgramMod.pickSites(sites, state, 1)[0].id, "d");
});

test("MET: launches that fail are marked as tried, and the next run fetches the others", async () => {
  const { run } = await import("../workers/data/src/sources/forecast.js");
  const many = Array.from({ length: 8 }, (_, i) => ({ id: "s" + i, lat: 68 + i / 10, lon: 16, altitude: 500 }));
  let state = { sites: {} };
  const store = { getState: async () => structuredClone(state), putState: async (k, v) => { state = v; }, putSnapshot: async () => {},
    putForecastHours: async () => {}, forecastHoursSince: async () => [], pruneForecastHours: async () => {} };
  const realFetch = globalThis.fetch, asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response("down", { status: 500 }); };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await run(store, many, NOW);
    const first = Object.keys(state.sites);
    assert.equal(first.length, 6, "six tried");
    assert.ok(first.every((id) => state.sites[id].tried && !state.sites[id].fetched));
    await run(store, many, NOW + 5 * 60000);
    assert.ok(["s6", "s7"].every((id) => state.sites[id]?.tried), "the two not tried yet come next");
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

test("Holfuy: the fresh measurements are published even when the archive fails", async () => {
  const holfuy = await import("../workers/data/src/sources/holfuy.js");
  const one = { stationId: 101, stationName: "Heia", dateTime: "2026-10-18 15:10:00", location: { latitude: 68.8, longitude: 16.5, altitude: 420 },
    wind: { speed: 4.2, gust: 7.1, min: 2.0, unit: "m/s", direction: 230 }, temperature: 6.3 };
  const saved = {}, state = {};
  const store = {
    addMeasurements: async () => {}, getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = v; },
    measurementsSince: async () => [], putSnapshot: async (k, v) => { saved[k] = v; },
    oldestMeasurement: async () => "2026-10-10T10:00:00.000Z", measurementsBetween: async () => [], prune: async () => {},
  };
  const env = { HOLFUY_KEY: "k", ARCHIVE: { put: async () => { throw new Error("R2 nede"); } } };
  const realFetch = globalThis.fetch, realWarn = console.warn, warned = [];
  globalThis.fetch = async () => Response.json(one);
  console.warn = (m) => warned.push(m);
  try {
    await holfuy.run(store, env, [{ id: 101, site: "heia" }], NOW);
    assert.ok(saved[holfuy.DATASET], "the snapshot is written");
    assert.ok(warned.some((m) => /arkivet: R2 nede/.test(m)));
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

test("status: when each source ran and succeeded, and which datasets are too old or miss launches", async () => {
  const health = await import("../workers/data/src/health.js");
  let runs = health.recordRuns(null, { forecast: null, stations: null }, NOW - 60000);
  runs = health.recordRuns(runs, { forecast: "MET svarte 500" }, NOW);
  assert.deepEqual(runs.forecast, { tried: new Date(NOW).toISOString(), ok: new Date(NOW - 60000).toISOString(), error: "MET svarte 500", errorAt: new Date(NOW).toISOString() });
  assert.equal(runs.stations.ok, new Date(NOW - 60000).toISOString());
  assert.equal(health.cleanError("fetch failed: https://api.holfuy.com/live/?s=101&pw=hemmelig&m=JSON"), "fetch failed: [adresse]", "never a key from an address");
  const snapshots = {
    forecast: { updated: ago(10), body: JSON.stringify({ sites: { a: [], b: [] } }) },
    stations: { updated: ago(30), body: "{}" },
    windgram: { updated: ago(20), body: JSON.stringify({ sites: { a: {} } }) },
  };
  // The verification has run (and failed); the forecast grids have never run.
  const s = health.buildStatus({ runs: health.recordRuns(runs, { verify: "feil" }, NOW), snapshots, expected: { forecast: ["a", "b", "c"], windgram: ["a"] }, archive: { holfuy: "2026-10-17" }, now: NOW });
  assert.equal(s.ok, false);
  assert.deepEqual(s.datasets.forecast, { updated: ago(10), ageMinutes: 10, maxAgeMinutes: 60, ok: true, missing: ["c"] });
  assert.equal(s.datasets.stations.ok, false, "30 minutes without measurements is too old");
  assert.deepEqual(s.datasets.windgram.missing, []);
  assert.equal(s.datasets.verification.ok, false, "never written, though its source has run");
  assert.deepEqual([s.datasets.grid.ok, s.datasets.grid.pending, s.datasets["grid-wide"].pending], [true, true, true], "a source that has never run is pending, not an alarm");
  const later = health.buildStatus({ runs: health.recordRuns(runs, { gridWide: "Open-Meteo svarte 502" }, NOW), snapshots: {}, expected: {}, archive: {}, now: NOW });
  assert.equal(later.datasets["grid-wide"].ok, false, "once it has run, a missing dataset counts");
  assert.equal(s.archive.holfuy, "2026-10-17");
  assert.equal(s.backup, null, "no archive: nothing to report on");
  const withBackup = (backup) => health.buildStatus({ runs, snapshots, expected: {}, archive: {}, backup, now: NOW }).backup;
  assert.deepEqual(withBackup({ day: "2026-10-17", rows: {} }), { day: "2026-10-17", daysAgo: 1, maxDays: 2, ok: true });
  assert.deepEqual(withBackup({ day: "2026-10-15", rows: {} }), { day: "2026-10-15", daysAgo: 3, maxDays: 2, ok: false }, "three days without a backup is a problem");
  assert.deepEqual(withBackup(null), { day: null, daysAgo: null, maxDays: 2, ok: false }, "the archive set up but never backed up");
  assert.equal(health.buildStatus({ runs, snapshots: { forecast: snapshots.forecast }, expected: {}, archive: {}, backup: { day: "2026-10-15" }, now: NOW }).ok, false, "a late backup makes the status not ok");
});

const aprsMod = await import("../workers/data/src/aprs.js");
// Lines from OGN's APRS stream at NOW: a paraglider (detail byte 1E: type 7, FLARM address) heard twice, a glider (06),
// one that must not be tracked by its flag (5E), one in stealth (9E, still counted, never named), and server lines.
const APRS = [
  "# aprsc 2.1.14 18 Oct 2026 15:19:50 GMT GLIDERN1 1.2.3.4:14580",
  "FLRDDA5BA>OGFLR,qAS,Kvaefj:/151940h6847.40N/01622.00E'342/019/A=003200 !W00! id1EDDA5BA +100fpm",
  "FLRDDA5BA>OGFLR,qAS,Kvaefj:/151955h6847.41N/01622.03E'342/019/A=003281 !W52! id1EDDA5BA +197fpm -1.1rot 8.8dB",
  "FLRDD0001>OGFLR,qAS,Kvaefj:/151955h6848.00N/01620.00E'090/050/A=004000 !W00! id06DD0001 +300fpm",
  "FNT110002>OGNFNT,qAS,Kvaefj:/151955h6848.00N/01620.00E'090/015/A=004000 !W00! id5E110002 +300fpm",
  "FNT110003>OGNFNT,qAS,Kvaefj:/151950h6846.00N/01621.00E'000/000/A=002000 !W00! id9E110003 -400fpm",
  "OGN123456>OGNSDR,TCPIP*,qAC,GLIDERN1:/151955h6847.00N/01622.00EI v0.2.8",
];

test("aprs: positions of paragliders from the stream, in live.js's shape, no-tracking and other aircraft left out", () => {
  const items = APRS.map((l) => aprsMod.parseAprsLine(l, NOW)).filter(Boolean);
  assert.equal(items.length, 3);
  assert.deepEqual(items[1], { id: "dda5ba", name: null, lat: 68.79025, lon: 16.3672, alt: 1000, track: 342, speed: 9.8, climb: 1, type: 7, time: "2026-10-18T15:19:55.000Z" });
  assert.equal(items[2].id, "110003", "stealth: counted, but never named");
  assert.equal(items[2].name, null);
  assert.equal(items[2].track, null, "course 0 with no speed is not known");
  assert.equal(items[2].climb, -2);
  assert.equal(aprsMod.parseAprsLine(APRS[2], NOW, new Set(["DDA5BA"])), null, "«tracked: N» in OGN's device database");
  assert.equal(aprsMod.parseAprsLine(APRS[2], NOW + 11 * 60000), null, "older than ten minutes");
  assert.equal(aprsMod.parseAprsLine(APRS[2].replace("151955h", "235958h"), Date.parse("2026-10-19T00:00:30Z"))?.time, "2026-10-18T23:59:58.000Z", "just before midnight UTC");
  assert.equal(aprsMod.aprsFilter([{ lat: 68, lon: 16 }, { lat: 69, lon: 17 }]), "a/69.50/15.00/67.50/18.00");
});

// A stand-in for Cloudflare's connect: the stream sends the chunks (split mid-line, as TCP may) and then stays open.
function fakeAprs(chunks) {
  const sent = [];
  let closed = false;
  const connect = ({ hostname, port }) => {
    sent.push(`${hostname}:${port}`);
    let i = 0;
    return {
      writable: new WritableStream({ write(chunk) { sent.push(new TextDecoder().decode(chunk)); } }),
      readable: new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++])); else return new Promise(() => {}); } }),
      close: async () => { closed = true; },
    };
  };
  return { connect, sent, closed: () => closed };
}

test("aprs: a read-only login with the area filter, each aircraft's newest position, the connection closed after the time", async () => {
  const text = APRS.join("\r\n") + "\r\n";
  const fake = fakeAprs([text.slice(0, 150), text.slice(150, 400), text.slice(400)]);
  const items = await aprsMod.listenAprs([{ lat: 68.8, lon: 16.5 }], new Set(), { seconds: 0.05, now: NOW, connect: fake.connect });
  assert.equal(fake.sent[0], "aprs.glidernet.org:14580");
  assert.match(fake.sent[1], /^user HPGTFS pass -1 vers hpgt-flysteder 1\.0 filter a\/69\.30\/15\.50\/68\.30\/17\.50\r\n$/);
  assert.deepEqual(items.map((i) => [i.id, i.time.slice(11, 19)]), [["dda5ba", "15:19:55"], ["110003", "15:19:50"]]);
  assert.ok(fake.closed());
});

test("aprs: the reserve when OGN's web map does not answer, only with the list of devices that must not be tracked", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 521 });
  try {
    const sites = [{ lat: 68.8, lon: 16.5 }];
    const fake = fakeAprs([APRS.join("\n") + "\n"]);
    const store = { noTrack: async () => ["DDA5BA"] };
    const items = await liveMod.fetchLive(sites, NOW, { store, aprsSeconds: 0.05, connect: fake.connect });
    assert.equal(items.via, "aprs");
    assert.deepEqual(items.map((i) => i.id), ["110003"], "the device the database says must not be tracked is left out");
    await assert.rejects(() => liveMod.fetchLive(sites, NOW), /OGN svarte 521/, "without a store, no reserve");
    const noList = { noTrack: async () => { throw new Error("OGN-registeret svarte 503"); } };
    await assert.rejects(() => liveMod.fetchLive(sites, NOW, { store: noList, connect: fakeAprs([]).connect }), /OGN svarte 521; APRS: OGN-registeret svarte 503/,
      "without the list the reserve gives nothing");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("aprs: the devices that must not be tracked, from OGN's device database as CSV (or JSON), a broken answer refused", async () => {
  const csv = "#DEVICE_TYPE,DEVICE_ID,AIRCRAFT_MODEL,REGISTRATION,CN,TRACKED,IDENTIFIED\n"
    + Array.from({ length: 1200 }, (_, i) => `'F','${i.toString(16).padStart(6, "0")}','${i === 5 ? "Ventus 2cxM, 18m" : i === 6 ? "L'Hirondelle" : "Unknown"}','D-${i}','','${i % 100 ? "Y" : "N"}','Y'`).join("\r\n") + "\r\n";
  const asked = [];
  const ids = await aprsMod.fetchNoTrack(async (url) => { asked.push(url); return new Response(csv); });
  assert.deepEqual(asked, [aprsMod.DDB_URL], "over HTTPS only");
  assert.equal(ids.length, 12);
  assert.equal(ids[1], "000064");
  assert.deepEqual(aprsMod.parseDdb(csv).slice(5, 7), [{ id: "000005", tracked: "Y" }, { id: "000006", tracked: "Y" }], "a comma or a quote in the model does not matter");
  const devices = Array.from({ length: 1200 }, (_, i) => ({ device_type: "F", device_id: i.toString(16).padStart(6, "0"), tracked: i % 100 ? "Y" : "N", identified: "Y" }));
  assert.equal((await aprsMod.fetchNoTrack(async () => Response.json({ devices }))).length, 12, "the old JSON form is still read");
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => Response.json({ devices: devices.slice(0, 10) })), /uventet svar/);
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => new Response("<html>down</html>")), /uventet svar/);
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => new Response("", { status: 502 })), /svarte 502/);
});
