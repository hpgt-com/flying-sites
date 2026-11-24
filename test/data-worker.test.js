// Tester for datatjenesten (workers/data): varselet og Holfuy-stasjonene. Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, keepSites, pickSites, MAX_AGE_HOURS, run as forecastRun } from "../workers/data/src/sources/forecast.js";
import { buildStations, holfuyUrl, parseHolfuy } from "../workers/data/src/sources/holfuy.js";
import { due } from "../workers/data/src/schedule.js";
import { dayPath, daysToArchive, measurementsCsv, pruneBefore, stationsCsv } from "../workers/data/src/archive.js";
import { extraValues } from "../workers/data/src/measurements.js";

const NOW = Date.parse("2026-10-18T15:20:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const rows = (start, n = 3) => Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 3600000).toISOString().replace(".000", ""), 200, 5, 9, 0]);
const sites = ["a", "b", "c", "d"].map((id) => ({ id, lat: 68.8, lon: 16.5, altitude: 500 }));

test("velger startene som mangler i tilstanden først, deretter de som ble hentet for lengst siden", () => {
  const state = { sites: { a: { fetched: ago(5) }, b: { fetched: ago(25) }, c: { fetched: ago(15) } } };
  assert.deepEqual(pickSites(sites, state, 2).map((s) => s.id), ["d", "b"]);
  assert.deepEqual(pickSites(sites, state, 6).map((s) => s.id), ["d", "b", "c", "a"]);
});

test("varselkjøring: en start spørres ikke igjen før Expires, og en 304 beholder radene, regnet som hentet nå", async () => {
  let state = null;
  const snapshots = [];
  const store = { getState: async () => state, putState: async (k, v) => { state = v; }, putForecastHours: async () => {}, pruneForecastHours: async () => {},
    forecastHoursSince: async () => [], putSnapshot: async (k, v) => snapshots.push(JSON.parse(v)) };
  const body = { properties: { meta: { updated_at: "2026-10-18T14:00:00Z" }, timeseries: [{ time: "2026-10-18T15:00:00Z",
    data: { instant: { details: { wind_from_direction: 200, wind_speed: 5, wind_speed_of_gust: 9 } }, next_1_hours: { details: { precipitation_amount: 0 } } } }] } };
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push(init.headers["if-modified-since"] ?? null);
    return asked.length === 1
      ? new Response(JSON.stringify(body), { headers: { expires: "Sun, 18 Oct 2026 15:40:00 GMT", "last-modified": "Sun, 18 Oct 2026 14:05:00 GMT" } })
      : new Response(null, { status: 304, headers: { expires: "Sun, 18 Oct 2026 16:40:00 GMT" } });
  };
  try {
    const one = [{ id: "a", lat: 68.8, lon: 16.5, altitude: 500 }];
    await forecastRun(store, one, NOW);
    assert.deepEqual([state.sites.a.expires, state.sites.a.lastModified, state.sites.a.rows.length], ["2026-10-18T15:40:00.000Z", "2026-10-18T14:05:00.000Z", 1]);
    await forecastRun(store, one, NOW + 10 * 60000);
    assert.equal(asked.length, 1, "før Expires spørres ikke MET");
    assert.equal(state.sites.a.fetched, new Date(NOW + 10 * 60000).toISOString(), "men starten regnes som hentet nå");
    await forecastRun(store, one, NOW + 30 * 60000);
    assert.deepEqual(asked, [null, "Sun, 18 Oct 2026 14:05:00 GMT"], "etter Expires, med If-Modified-Since");
    assert.deepEqual([state.sites.a.rows.length, state.sites.a.updated, state.sites.a.expires], [1, "2026-10-18T14:00:00Z", "2026-10-18T16:40:00.000Z"], "en 304 beholder radene og tar den nye Expires");
    assert.equal(snapshots.at(-1).fetched, new Date(NOW + 30 * 60000).toISOString());
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("et sted som er fjernet fra stedsfilene, forsvinner fra tilstanden", () => {
  const state = { sites: { a: { fetched: ago(5) }, gone: { fetched: ago(5) } } };
  assert.deepEqual(Object.keys(keepSites(state, sites).sites), ["a"]);
  assert.deepEqual(keepSites(null, sites), { sites: {} });
});

test("varselet følger den nyeste starten, plasserer de andre etter tid, og er like gammelt som den eldste", () => {
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

test("starter eldre enn grensen utelates, og ingenting ferskt gir null", () => {
  const old = { fetched: ago(MAX_AGE_HOURS * 60 + 1), updated: null, rows: rows("2026-10-18T08:00:00Z") };
  assert.equal(buildForecast({ sites: { a: old } }, NOW), null);
  const f = buildForecast({ sites: { a: old, b: { fetched: ago(5), updated: null, rows: rows("2026-10-18T15:00:00Z") } } }, NOW);
  assert.deepEqual(Object.keys(f.sites), ["b"]);
});

test("varselet har den felles rammen: dataset, source, license og fetched", () => {
  const f = buildForecast({ sites: { a: { fetched: ago(5), updated: null, rows: rows("2026-10-18T15:00:00Z") } } }, NOW);
  assert.equal(f.dataset, "forecast");
  assert.equal(f.source, "MET Norge");
  assert.match(f.license, /MET/);
  assert.match(f.product, /Locationforecast/);
  assert.equal(f.fetched, ago(5));
});

test("Holfuy: én stasjon som objekt eller flere under measurements, tider i UTC, dårlige oppføringer droppet", () => {
  const one = { stationId: 101, stationName: "Heia", dateTime: "2026-10-18 15:10:00", location: { latitude: 68.8, longitude: 16.5, altitude: 420 },
    wind: { speed: 4.2, gust: 7.1, min: 2.0, unit: "m/s", direction: 230 }, temperature: 6.3 };
  assert.deepEqual(parseHolfuy(one), [{ source: "holfuy", station: 101, name: "Heia", lat: 68.8, lon: 16.5, altitude: 420, time: "2026-10-18T15:10:00.000Z",
    dir: 230, speed: 4.2, gust: 7.1, min: 2, temperature: 6.3, humidity: null, pressure: null, rain: null, extra: null }]);
  const several = parseHolfuy({ measurements: [one, { ...one, stationId: 102, wind: { speed: "3.5" } }, { stationId: 103 }, { dateTime: "2026-10-18 15:00:00" }] });
  assert.deepEqual(several.map((m) => [m.station, m.speed, m.dir]), [[101, 4.2, 230], [102, 3.5, null]]);
  assert.deepEqual(parseHolfuy(null), []);
  assert.deepEqual(parseHolfuy({ error: "wrong password" }), []);
});

test("Holfuy: fuktighet, trykk og nedbør når stasjonen har dem, og ukjente tall beholdes i extra", () => {
  const m = { stationId: 820, dateTime: "2026-10-18 15:10:00", wind: { speed: 3, direction: 200, unit: "m/s", max: 9 },
    temperature: 4, humidity: 81, pressure: "1012.4", rain: 0.2, battery: 3.9, snow: { depth: 12, note: "x" }, label: "text" };
  const [p] = parseHolfuy(m);
  assert.deepEqual([p.humidity, p.pressure, p.rain], [81, 1012.4, 0.2]);
  assert.deepEqual(p.extra, { "wind.max": 9, battery: 3.9, "snow.depth": 12 });
});

test("ukjente verdier: høyst 20, bare tall, enkle navn", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`v${i}`, i]));
  assert.equal(Object.keys(extraValues(many, new Set())).length, 20);
  assert.equal(extraValues({ "bad key!": 1, ok: "2", text: "abc" }, new Set()).ok, 2);
  assert.equal(extraValues({ "bad key!": 1 }, new Set()), null);
});

test("Holfuy: forespørselen ber om JSON, m/s, °C og UTC for alle stasjoner", () => {
  const url = holfuyUrl([101, 102], "secret");
  assert.equal(url.origin + url.pathname, "https://api.holfuy.com/live/");
  assert.equal(url.searchParams.get("s"), "101,102");
  assert.equal(url.searchParams.get("pw"), "secret");
  assert.equal(url.searchParams.get("su"), "m/s");
  assert.equal(url.searchParams.get("m"), "JSON");
  assert.ok(url.searchParams.has("utc"));
  assert.ok(url.searchParams.has("loc"), "ber om stasjonens posisjon");
});

test("Holfuy: ett element per konfigurert stasjon, i den rekkefølgen, med siste måling og historikken", () => {
  const m = (station, min, speed) => ({ station, time: ago(min), dir: 200, speed, gust: speed + 2, min: speed - 1, temperature: 5 });
  const data = buildStations([{ id: 102, site: "heia" }, { id: 101, name: "Modellflystripa" }, { id: 999 }],
    [m(101, 10, 3), m(101, 5, 4), { ...m(102, 7, 6), station: "102" }], { 101: { name: "MFK", lat: 68.7, lon: 16.4, altitude: 20 }, 102: { name: "Heia Holfuy" } }, NOW);
  assert.equal(data.dataset, "stations");
  assert.equal(data.source, "Holfuy");
  assert.equal(data.fetched, new Date(NOW).toISOString());
  assert.deepEqual(data.items.map((i) => [i.id, i.name, i.site]), [[102, "Heia Holfuy", "heia"], [101, "Modellflystripa", null], [999, "999", null]]);
  assert.equal(data.items[0].time, ago(7), "et stasjonsnummer lagret som tekst treffer fortsatt");
  assert.deepEqual(data.items[1].wind, { dir: 200, speed: 4, gust: 6, min: 3 });
  assert.equal(data.items[1].time, ago(5));
  assert.deepEqual(data.items[1].history.map((r) => r[2]), [3, 4]);
  assert.deepEqual(data.items[1].history[1], [ago(5), 200, 4, 6, 3, 5], "rader: tid, retning, fart, kast, min, temperatur");
  assert.equal(data.items[2].time, null);
  assert.equal(data.items[2].wind, null);
});

test("én tidsplan hvert minutt: stasjonene hvert minutt, varselet hvert femte", () => {
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((m) => due("stations", minute(m))), [true, true, true, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map((m) => due("forecast", minute(m))), [true, false, false, false, false, true, true]);
  // De tyngre kildene deler aldri et minutt (én kjøring har 10 ms CPU i alt).
  for (let m = 0; m < 60; m++) assert.ok(["forecast", "met", "windgram", "verify"].filter((n) => due(n, minute(m))).length <= 1, `minutt ${m}`);
  // En daglig kilde som gikk glipp av minuttet sitt, kjører i neste minutt når et intervall og et minutt har gått siden
  // den sist kjørte; de hyppige venter bare på sitt neste minutt.
  const at = (h) => new Date(minute(0) - h * 3600000).toISOString();
  assert.equal(due("backup", minute(1), at(23.9)), false, "under et døgn og et minutt siden sist: ikke ennå");
  assert.equal(due("backup", minute(1), at(24.5)), true, "over et døgn siden forrige kjøring: tatt igjen");
  assert.equal(due("ognDdb", minute(1), undefined), false, "aldri kjørt: venter på sitt minutt");
  assert.equal(due("grid", minute(1), at(4)), true);
  assert.equal(due("forecast", minute(1), at(24)), false, "varselet kjører uansett hvert femte minutt");
  // En daglig kilde som feilet sist, prøves igjen etter en time, ikke et døgn; varselnettene, som kjører med noen
  // timers mellomrom, likeså etter en time.
  assert.equal(due("ognDdb", minute(1), at(0.9), true), false, "feilet for under en time siden: ikke ennå");
  assert.equal(due("ognDdb", minute(1), at(1.1), true), true, "feilet for over en time siden: prøves igjen");
  assert.equal(due("ognDdb", minute(1), at(1.1), false), false, "lyktes for en time siden: venter på sitt minutt");
  assert.equal(due("grid", minute(1), at(1.1), true), true);
  assert.equal(due("forecast", minute(1), at(1.1), true), false, "varselet kjører uansett hvert femte minutt");
});

test("arkiv: hele UTC-døgn fra den eldste målingen eller etter det sist arkiverte, fram til i går, to om gangen", () => {
  const now = Date.parse("2026-10-18T03:10:00Z");
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-16", Date.parse("2026-10-18T00:10:00Z")), [], "i går venter noen timer på sene målinger");
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", null, now), ["2026-10-15", "2026-10-16"]);
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-16", now), ["2026-10-17"]);
  assert.deepEqual(daysToArchive("2026-10-15T13:00:00.000Z", "2026-10-17", now), []);
  assert.deepEqual(daysToArchive(null, null, now), []);
});

test("arkiv: ingenting slettes før det er arkivert, og aldri de siste 7 dagene", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(pruneBefore(now, 7, null), null);
  assert.equal(pruneBefore(now, 7, "2026-10-05"), "2026-10-06T00:00:00.000Z");
  assert.equal(pruneBefore(now, 7, "2026-10-17"), "2026-10-11T12:00:00.000Z");
});

test("arkiv: én tabell for alle stasjoner, stasjonen i hver rad, enheter i overskriften, tomme celler for det som mangler", () => {
  const header = "source,station,time_utc,direction_deg,speed_ms,gust_ms,min_ms,temperature_c,humidity_pct,pressure_hpa,rain_mm,extra_json\n";
  assert.equal(measurementsCsv([{ source: "holfuy", station: 490, time: "2026-10-17T10:00:00.000Z", dir: 230, speed: 4.2, gust: null, min: 2, temperature: 5.5, humidity: 80, pressure: null, rain: 0, extra: { battery: 3.9 } }]),
    header + 'holfuy,490,2026-10-17T10:00:00.000Z,230,4.2,,2,5.5,80,,0,"{""battery"":3.9}"\n');
  assert.equal(measurementsCsv([]), header);
  assert.equal(dayPath("holfuy", 490, "2026-10-17"), "holfuy/station=490/year=2026/2026-10-17.csv");
  assert.equal(stationsCsv([{ source: "holfuy", id: 490, name: 'HPGT "Heia", topp', model: null, site: "heia", lat: 68.8, lon: 16.5, altitude: 420 }]),
    'source,station,name,model,site,lat,lon,altitude_m\nholfuy,490,"HPGT ""Heia"", topp",,heia,68.8,16.5,420\n');
});

test("varselarkivet: timen som pågår, gruppert per sted, og past i datasettet", async () => {
  const { hourNow, groupPast } = await import("../workers/data/src/sources/forecast.js");
  const rows = [["2026-10-18T14:00:00Z", 200, 4, 7, 0], ["2026-10-18T15:00:00Z", 210, 5, 8, 0], ["2026-10-18T16:00:00Z", 220, 6, 9, 0]];
  assert.deepEqual(hourNow(rows, NOW), rows[1], "15.20 er i timen fra 15.00");
  assert.equal(hourNow(rows, Date.parse("2026-10-18T18:00:00Z")), null);
  const past = groupPast([
    { site: "b", time: "2026-10-18T15:00:00Z", dir: 1, speed: 2, gust: 3 },
    { site: "a", time: "2026-10-18T15:00:00Z", dir: 5, speed: 6, gust: 7 },
    { site: "a", time: "2026-10-18T14:00:00Z", dir: 4, speed: 5, gust: 6 },
  ]);
  assert.deepEqual(past, { a: [["2026-10-18T14:00:00Z", 4, 5, 6], ["2026-10-18T15:00:00Z", 5, 6, 7]], b: [["2026-10-18T15:00:00Z", 1, 2, 3]] });
  const state = { sites: { a: { fetched: ago(10), updated: null, rows: rows.map(([t, ...v]) => [t, ...v]) } } };
  assert.deepEqual(buildForecast(state, NOW, past).past, past);
  assert.equal(buildForecast(state, NOW, {}).past, undefined, "ikke noe past-felt når ingenting er lagret ennå");
});

// --- METs stasjoner (Frost) ---
const frostMod = await import("../workers/data/src/sources/frost.js");
const { mergeStations } = await import("../workers/data/src/merge.js");
const { archiveSource } = await import("../workers/data/src/archive.js");

test("Frost: området for stedene som polygon, og METs navn med store bokstaver", () => {
  assert.equal(frostMod.areaPolygon([{ lat: 68.8, lon: 16.5 }, { lat: 68.6, lon: 16.0 }], 0.1),
    "POLYGON((15.800 68.500, 16.700 68.500, 16.700 68.900, 15.800 68.900, 15.800 68.500))", "dobbel margin øst–vest");
  assert.equal(frostMod.stationName("EVENES LUFTHAVN"), "Evenes lufthavn");
});

test("Frost: kilder som stasjoner, bare landstasjoner med posisjon", () => {
  const stations = frostMod.parseSources({ data: [
    { id: "SN84970", name: "EVENES LUFTHAVN", masl: 26, geometry: { type: "Point", coordinates: [16.6767, 68.4913] } },
    { id: "SN99999", name: "NO POSITION" },
    { id: "XX1", name: "OTHER", geometry: { coordinates: [1, 2] } },
  ] });
  assert.deepEqual(stations, [{ id: "SN84970", name: "Evenes lufthavn", lat: 68.4913, lon: 16.6767, altitude: 26 }]);
});

test("Frost: observasjoner som målinger, siste tidspunkt med vind, andre elementer fra det tidspunktet", () => {
  const obs = (id, time, list) => ({ sourceId: id + ":0", referenceTime: time, observations: list.map(([e, v]) => ({ elementId: e, value: v })) });
  const m = frostMod.parseObservations({ data: [
    obs("SN84970", "2026-10-18T15:10:00.000Z", [["wind_speed", 5.1], ["wind_from_direction", 230], ["max(wind_speed_of_gust PT10M)", 8.4], ["air_temperature", 6.2]]),
    obs("SN84970", "2026-10-18T15:00:00.000Z", [["wind_speed", 4.0], ["sum(precipitation_amount PT1H)", 0.4]]),
    obs("SN87110", "2026-10-18T15:00:00.000Z", [["air_temperature", 5]]),
  ] });
  assert.equal(m.length, 1, "en stasjon uten vind utelates");
  assert.deepEqual(m[0], { source: "met", station: "SN84970", time: "2026-10-18T15:10:00.000Z", dir: 230, speed: 5.1, gust: 8.4, min: null,
    temperature: 6.2, humidity: null, pressure: null, rain: null, extra: null });
});

test("Frost: datasettet har bare stasjoner med målinger, sortert etter navn, med MET som kilde og lisens", () => {
  const stations = [{ id: "SN2", name: "Kvæfjord", lat: 68.7, lon: 16.2, altitude: 10 }, { id: "SN1", name: "Evenes", lat: 68.5, lon: 16.7, altitude: 26 }, { id: "SN3", name: "Stille", lat: 1, lon: 1 }];
  const rows = [{ station: "SN1", time: ago(10), dir: 200, speed: 4, gust: 7, temperature: 5 }, { station: "SN2", time: ago(5), dir: 210, speed: 3, gust: null, temperature: 4 }];
  const d = frostMod.buildStations(stations, rows, { SN2: "kilhusasen" }, NOW);
  assert.deepEqual(d.items.map((i) => i.id), ["SN1", "SN2"]);
  assert.equal(d.items[1].site, "kilhusasen");
  assert.equal(d.items[0].source, "MET Norge");
  assert.deepEqual(d.items[0].history[0], [ago(10), 200, 4, 7, null, 5]);
  assert.match(d.license, /MET/);
});

test("stasjonsdatasettet slår sammen Holfuys og METs, hver stasjon med sin kilde", () => {
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

test("arkivet skriver en kildes ferdige dager per stasjon og rydder bare det som er arkivert", async () => {
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
  assert.deepEqual(pruned, [["met", "2026-10-11T03:00:00.000Z"]], "bare det som er eldre enn 7 dager, og arkivert");
  await archiveSource(store, {}, "met", [], 7, Date.now());
});

test("Frost: stasjoner innen 50 km fra en start beholdes, fra Lofoten til Bardu", () => {
  const sites = [{ lat: 68.8, lon: 16.5 }];
  const kept = frostMod.nearSites([{ id: "SN1", lat: 68.85, lon: 16.6 }, { id: "SN2", lat: 68.4913, lon: 16.6767 }, { id: "SN3", lat: 69.06, lon: 18.54 }], sites);
  assert.deepEqual(kept.map((s) => s.id), ["SN1", "SN2"], "Evenes (omtrent 35 km) beholdes; Bardufoss (omtrent 85 km fra denne starten) gjør ikke det");
});

// --- Høydevind (Open-Meteo) ---
const windgramMod = await import("../workers/data/src/sources/windgram.js");

test("høydevind: hvert tiende minutt, bare ferske starter, like gammel som den eldste, og en start som feiler, beholder nettet sitt", async () => {
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([0, 7, 9, 17].map((m) => due("windgram", minute(m))), [false, true, false, true]);
  const picked = windgramMod.pickSites([{ id: "a" }, { id: "b" }, { id: "c" }], { sites: { a: { fetched: ago(5) }, b: { fetched: ago(40) } } });
  assert.deepEqual(picked.map((s) => s.id), ["c", "b"], "først den manglende, så den hentet lengst siden");
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
  assert.deepEqual(Object.keys(saved.state.sites), ["a"], "steder som ikke lenger er i listen, droppes");
  assert.equal(saved.state.sites.a.fetched, ago(10), "starten som feilet, beholder det forrige nettet sitt");
  assert.deepEqual(saved.windgram.sites.a, grid);
});

// --- Hvor godt varselet traff ---
const verifyMod = await import("../workers/data/src/sources/verify.js");
const { siteLinks } = await import("../workers/data/src/stations.js");

test("verifisering: timens målinger, parene for ferdige timer, og sammendraget", () => {
  const H = Date.parse("2026-10-18T14:00:00Z");
  const at = (min) => new Date(H + min * 60000).toISOString();
  const rows = [
    { source: "holfuy", station: "490", time: at(0), dir: 200, speed: 9, gust: 20 },
    { source: "holfuy", station: "490", time: at(20), dir: 200, speed: 4, gust: 6, temperature: 7.6, pressure: 1008 },
    { source: "holfuy", station: "490", time: at(40), dir: 220, speed: 6, gust: 9, temperature: 8, pressure: 1009 },
    { source: "met", station: "SN1", time: at(60), dir: 270, speed: 8, gust: 12 },
  ];
  const m = verifyMod.measuredHour(rows.filter((r) => r.source === "holfuy"), H);
  assert.equal(m.n, 2, "raden nøyaktig ved starten hører til timen før");
  assert.equal(m.speed, 5);
  assert.equal(m.gust, 9);
  assert.deepEqual([m.temp, m.pressure], [7.8, 1008.5], "timens gjennomsnittlige temperatur og trykk");
  const met = verifyMod.measuredHour(rows.filter((r) => r.source === "met"), H);
  assert.equal(met.speed, 8, "METs verdi ved slutten av timen");
  assert.deepEqual([met.temp, met.pressure], [null, null], "en stasjon uten dem");
  const links = [{ site: "heia", source: "holfuy", station: "490" }, { site: "saetertinden", source: "met", station: "SN1" }];
  const hours = [
    { site: "heia", time: at(0), dir: 210, speed: 4, gust: 7, temp: 6, pressure: 1006.5 },
    { site: "saetertinden", time: at(0), dir: 260, speed: 10, gust: 15 },
    { site: "heia", time: at(60), dir: 210, speed: 4, gust: 7 },
  ];
  const p = verifyMod.pairs(links, hours, rows, H - 3600000, H + 61 * 60000);
  assert.deepEqual(p.map((x) => [x.site, x.m_speed, x.f_speed]), [["heia", 5, 4], ["saetertinden", 8, 10]], "den uferdige timen utelates");
  assert.deepEqual([p[0].f_temp, p[0].m_temp, p[0].f_pressure, p[0].m_pressure], [6, 7.8, 1006.5, 1008.5]);
  assert.deepEqual([p[1].f_temp, p[1].m_temp], [null, null]);
  const sum = verifyMod.summarize([...Array(5)].map(() => p[0]).concat([p[1]]));
  assert.deepEqual([sum.tempHours, sum.tempBias, sum.tempMae], [5, 1.8, 1.8], "målt minus varslet, over timene som har begge");
  assert.deepEqual([sum.pressureHours, sum.pressureBias, sum.pressureMae], [5, 2, 2]);
  assert.deepEqual([verifyMod.summarize([p[1]]).tempHours, verifyMod.summarize([p[1]]).tempBias], [0, null]);
  assert.equal(sum.hours, 6);
  assert.equal(sum.bias, 0.5, "(5 × +1 − 2) / 6, målt minus varslet");
  assert.equal(sum.mae, 1.2);
  assert.equal(sum.dirHit, 1);
  assert.deepEqual(sum.sectors, { SW: { hours: 5, bias: 1 } }, "V har for få timer");
  assert.equal(verifyMod.summarize([]), null);
});

test("verifisering: stedene med egen stasjon eller en i nærheten, og kjøretiden", () => {
  assert.deepEqual(siteLinks(), [{ site: "heia", source: "holfuy", station: "490" }, { site: "hinnstein", source: "holfuy", station: "490" },
    { site: "saetertinden", source: "met", station: "SN87772" }]);
  const minute = (m) => Date.parse("2026-10-18T15:00:00Z") + m * 60000;
  assert.deepEqual([9, 39, 10].map((m) => due("verify", minute(m))), [true, true, false]);
});

// --- «Meld fra om endring» ---
const reportMod = await import("../workers/data/src/report.js");

test("rapport: kontrollerte felt, og saken med teksten i en kodeblokk", () => {
  const names = { heia: "Heia" };
  const ok = { site: "heia", kind: "access", message: "  Bommen ved P-plassen er låst.  ", name: "Kari", token: "t" };
  const r = reportMod.checkReport(ok, names);
  assert.equal(r.message, "Bommen ved P-plassen er låst.");
  assert.equal(reportMod.checkReport({ ...ok, site: "toString" }, names).error, "bad-request", "bare ekte steder");
  assert.equal(reportMod.checkReport({ ...ok, kind: "spam" }, names).error, "bad-request");
  assert.equal(reportMod.checkReport({ ...ok, message: "kort" }, names).error, "bad-length");
  assert.equal(reportMod.checkReport({ ...ok, message: "x".repeat(1001) }, names).error, "bad-length");
  assert.equal(reportMod.checkReport({ ...ok, token: "" }, names).error, "no-token");
  const issue = reportMod.issueFor({ ...r, message: "Se @noen og ~~~ ![x](http://a)" }, NOW);
  assert.equal(issue.title, "[Meld fra] Heia: Vei, parkering eller adkomst");
  assert.deepEqual(issue.labels, ["endringsforslag", "site-data"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "hazard" }, NOW).labels, ["endringsforslag", "site-data", "safety"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "other" }, NOW).labels, ["endringsforslag", "site-data"], "«Annet» på en stedsside gjelder stedet");
  assert.match(issue.body, /~~~text\nSe @noen og ~ ~ ~ !\[x\]\(http:\/\/a\)\n~~~/, "teksten holder seg inne i én kodeblokk");
});

// Lagerets «Meld fra»-metoder (store.js reportSalt, reserveReport, releaseReport) slik Durable Object kjører dem.
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

test("rapport: trenger begge hemmelighetene, Turnstile for vårt vertsnavn og JSON, innenfor grensene", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const store = reportStore();
  const req = (body, ip = "203.0.113.7", headers = {}) => new Request("https://data.test/v1/report", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
  });
  const body = { site: "heia", kind: "hazard", message: "Ny kraftlinje over landingen.", token: "t" };
  const names = { heia: "Heia" };
  assert.equal((await reportMod.handleReport(req(body), {}, store, names, NOW)).status, 503);
  assert.equal((await reportMod.handleReport(req(body), { TURNSTILE_SECRET: "s", GITHUB_ISSUES_TOKEN: "g" }, store, names, NOW)).status, 503, "et personlig token er ikke lenger nok: bare appen");
  const env = { TURNSTILE_SECRET: "s", REPORTS_APP_ID: "12345", REPORTS_APP_PRIVATE_KEY: pem };
  const calls = [];
  const realFetch = globalThis.fetch;
  let turnstile = true, hostname = "flysteder.hpgt.com", github = 201;
  let answer = { number: 171, html_url: "https://github.com/hpgt-com/flying-sites/issues/171" };
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("siteverify")) return Response.json({ success: turnstile, hostname });
    if (String(url).endsWith("/installation")) return Response.json({ id: 99 });
    if (String(url).endsWith("/access_tokens")) return Response.json({ token: "inst-token" }, { status: 201 });
    return Response.json(answer, { status: github });
  };
  try {
    const sent = await reportMod.handleReport(req(body), env, store, names, NOW);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { ok: true, issue: 171, url: "https://github.com/hpgt-com/flying-sites/issues/171" }, "sakens nummer og adresse til takken");
    answer = { number: 5, html_url: "https://evil.example/issues/5" };
    assert.deepEqual((await reportMod.handleReport(req(body), env, store, names, NOW)).body, { ok: true }, "bare en sak i repoet sendes videre");
    assert.ok(calls.some((u) => u.endsWith("/repos/hpgt-com/flying-sites/issues")));
    turnstile = false;
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 403);
    turnstile = true;
    hostname = "evil.example";
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 403, "et token løst på et annet nettsted avvises");
    hostname = "flysteder.hpgt.com";
    assert.equal((await reportMod.handleReport(req(body, "1.2.3.4", { "content-type": "text/plain" }), env, store, names, NOW)).status, 415);
    assert.equal((await reportMod.handleReport(req(JSON.stringify({ ...body, message: "x".repeat(reportMod.MAX_BODY) })), env, store, names, NOW)).status, 413);
    // To sendt så langt fra 203.0.113.7; adressen kan sende PER_IP_LIMIT i alt, så stoppes den, men ikke andre.
    for (let i = 2; i < reportMod.PER_IP_LIMIT; i++) assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 200);
    assert.equal((await reportMod.handleReport(req(body), env, store, names, NOW)).status, 429, "én adresse høyst PER_IP_LIMIT i døgnet");
    assert.equal((await reportMod.handleReport(req(body, "198.51.100.9"), env, store, names, NOW)).status, 200);
    // GitHub feiler: reservasjonen gis tilbake.
    github = 500;
    const before = store.counts["2026-10-18"].n;
    assert.equal((await reportMod.handleReport(req(body, "198.51.100.9"), env, store, names, NOW)).status, 502);
    assert.equal(store.counts["2026-10-18"].n, before);
    github = 201;
    store.counts["2026-10-18"].n = reportMod.DAILY_LIMIT;
    assert.equal((await reportMod.handleReport(req(body, "192.0.2.1"), env, store, names, NOW)).status, 429, "døgngrensen for alle");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rapport: med GitHub-appen får en signert JWT et installasjonstoken som lager saken", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const ghApp = await import("../workers/data/src/github-app.js");
  const jwt = await ghApp.appJwt(12345, pem, NOW);
  const [h, c, s] = jwt.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${h}.${c}`);
  assert.ok(verify.verify(publicKey, Buffer.from(s, "base64url")), "signert med appens nøkkel (PKCS#1 pakket som PKCS#8)");
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
    assert.deepEqual(tokenAsk, { repositories: ["flying-sites"], permissions: { issues: "write" } }, "tokenet bes om med bare dette repoet og Issues: write");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rapport: en generell rapport fra /meld-fra/ har ikke noe sted og har egne typer", () => {
  const names = { heia: "Heia" };
  const base = { message: "Det mangler et flysted på Senja.", token: "t" };
  const r = reportMod.checkReport({ ...base, site: "", kind: "newsite" }, names);
  assert.equal(r.error, undefined);
  assert.equal(reportMod.checkReport({ ...base, site: "", kind: "landing" }, names).error, "bad-request", "stedstyper trenger et sted");
  assert.equal(reportMod.checkReport({ ...base, site: "heia", kind: "newsite" }, names).error, "bad-request");
  const issue = reportMod.issueFor(r, NOW);
  assert.equal(issue.title, "[Meld fra] Generelt: Nytt flysted");
  assert.match(issue.body, /gjelder ikke ett bestemt flysted/);
  assert.deepEqual(issue.labels, ["endringsforslag", "site-data"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "bug" }, NOW).labels, ["bug"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "idea" }, NOW).labels, ["enhancement"]);
  assert.deepEqual(reportMod.issueFor({ ...r, kind: "other" }, NOW).labels, [], "et generelt «Annet» kan gjelde alt");
});

// --- Piloter i lufta (OGN) ---
const liveMod = await import("../workers/data/src/live.js");

test("live: OGNs svar som elementer, ukjente navn skjult, gamle og andre luftfartøy enn paraglidere utelatt, nyeste først", () => {
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
  assert.equal(items[1].name, null, "OGNs tilfeldige navn vises ikke");
  assert.equal(items[0].name, "Ola");
  assert.equal(items[1].speed, 10, "km/t til m/s");
  assert.equal(items[1].type, 7);
  assert.equal(items[1].time, new Date(NOW - 40000).toISOString());
  const b = liveMod.bounds([{ lat: 68, lon: 16 }, { lat: 69, lon: 17 }]);
  assert.deepEqual(b, { n: 69.5, s: 67.5, e: 18, w: 15 });
});

test("live: svar fra cachen når den er fersk, ellers spørres OGN, 503 når OGN feiler", async () => {
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
    assert.equal(calls, 1, "det andre svaret kom fra cachen");
    fail = true;
    assert.equal((await liveMod.handleLive(sites, NOW, null)).status, 503);
    const empty = new Map();
    const cache2 = { match: async (k) => empty.get(k.url)?.clone(), put: async (k, r) => { empty.set(k.url, r); } };
    calls = 0;
    assert.equal((await liveMod.handleLive(sites, NOW, cache2)).status, 503);
    assert.equal((await liveMod.handleLive(sites, NOW, cache2)).status, 503);
    assert.equal(calls, 1, "etter en feil er svaret 503 med en gang en stund, og OGN spørres ikke igjen");
    assert.equal(empty.get("https://data.hpgt.com/v1/live.json?failed").headers.get("cache-control"), `public, max-age=${liveMod.FAIL_SECONDS}`);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
});

test("live: sporet til hvert luftfartøy de siste minuttene, eldste først, den gamle delen droppet", async () => {
  const tracks = new Map();
  const at = (min) => new Date(NOW + min * 60000).toISOString();
  liveMod.mergeTrails(tracks, [{ id: "a", time: at(0), lat: 1, lon: 1, climb: 1.5 }], NOW, 600000);
  liveMod.mergeTrails(tracks, [{ id: "a", time: at(0), lat: 9, lon: 9, climb: 0 }], NOW, 600000);
  const t = liveMod.mergeTrails(tracks, [{ id: "a", time: at(5), lat: 2, lon: 2, climb: -2 }, { id: "b", time: at(5), lat: 3, lon: 3 }], NOW + 5 * 60000, 600000);
  assert.deepEqual(t, { a: [[1, 1, 1.5], [2, 2, -2]], b: [[3, 3, null]] }, "samme tidspunkt legges ikke til to ganger; stigningen beholdes med hvert punkt");
  const later = liveMod.mergeTrails(tracks, [{ id: "b", time: at(16), lat: 4, lon: 4, climb: 0.4 }], NOW + 16 * 60000, 600000);
  assert.deepEqual(later, { b: [[4, 4, 0.4]] }, "punktet fra 11 minutter siden droppes");
  assert.equal(tracks.has("a"), false, "et spor eldre enn ti minutter droppes");

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

test("turer: hver tur telles for stedet nærmest der den først ble sett, en ny etter landing, bare summer per sted", () => {
  const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }, { id: "elgen", lat: 68.89, lon: 16.28 }];
  const at = (s) => new Date(NOW - s * 1000).toISOString();
  const day = { day: "2026-10-18", pilots: {} };
  const seen = [
    { key: "a", lat: 68.801, lon: 16.501, alt: 600, speed: 8, climb: 1.5, time: at(10) },
    { key: "b", lat: 68.80, lon: 16.50, alt: 480, speed: 0, climb: 0, time: at(10) },
    { key: "c", lat: 69.5, lon: 18.0, alt: 900, speed: 9, climb: 0, time: at(10) },
    { key: "d", lat: 68.80, lon: 16.50, alt: 700, speed: 9, climb: 0, time: at(400) },
  ];
  assert.equal(flightsMod.observe(day, seen, sites, NOW, 2, { "a:now": 400 }), true);
  assert.deepEqual(Object.keys(day.pilots).sort(), ["a", "c"], "å stå på starten og gamle posisjoner er ikke flyging");
  assert.deepEqual(day.pilots.c.flights, {}, "først sett langt fra alle steder: telles for ingen");
  assert.equal(flightsMod.observe(day, [seen[0]], sites, NOW, 2), false, "samme posisjon telles ikke to ganger");
  flightsMod.observe(day, [{ ...seen[0], lat: 68.85, lon: 16.40, alt: 1400, time: at(0) }], sites, NOW, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "å fly videre nærmere et annet sted er samme tur");
  assert.equal(day.pilots.a.minutes.heia, 4);

  // Lander (to kjøringer i ro), går opp og flyr igjen: en tur til. Én kjøring sakte og flatt er ikke en landing.
  const ground = (s) => ({ key: "a", lat: 68.80, lon: 16.50, alt: 60, speed: 0, climb: 0, time: at(-s) });
  const air = (s) => ({ key: "a", lat: 68.801, lon: 16.501, alt: 600, speed: 8, climb: 1, time: at(-s) });
  flightsMod.observe(day, [ground(120)], sites, NOW + 120000, 2);
  flightsMod.observe(day, [air(240)], sites, NOW + 240000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "én kjøring på bakken er ikke en landing");
  flightsMod.observe(day, [ground(360)], sites, NOW + 360000, 2);
  flightsMod.observe(day, [ground(480)], sites, NOW + 480000, 2);
  flightsMod.observe(day, [air(1800)], sites, NOW + 1800000, 2, { "a:now": 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 2 }, "en ny tur etter landing");
  flightsMod.observe(day, [air(1800 + 20 * 60)], sites, NOW + (1800 + 20 * 60) * 1000, 2, { "a:now": 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 3 }, "ikke hørt på 20 minutter: en ny tur");

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
  assert.deepEqual(old.sites.heia.recent, {}, "bare de siste 31 dagene per dag");
  assert.equal(data.since, "2026-09-01");
  assert.equal(flightsMod.osloDay(Date.parse("2026-10-18T22:30:00Z")), "2026-10-19", "et norsk døgn");
});

test("turer: høyt over bakken flyr fortsatt, etter et opphold eller i ro i vinden", async () => {
  const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
  const at = (s) => new Date(NOW + s * 1000).toISOString();
  const air = (s, alt = 900) => ({ key: "a", lat: 68.80, lon: 16.50, alt, speed: 8, climb: 1, time: at(s) });
  const hover = (s) => ({ key: "a", lat: 68.80, lon: 16.50, alt: 900, speed: 0, climb: 0, time: at(s) });
  const day = { day: "2026-10-18", pilots: {} };
  flightsMod.observe(day, [air(0)], sites, NOW, 2);
  // Utenfor rekkevidde i 40 minutter, sist sett 900 m opp der bakken er 400 m: samme tur. Turen venter fortsatt, så
  // høyden der piloten er nå, spørres også.
  assert.deepEqual(flightsMod.needsGround(day, [air(2400)], NOW + 2400000), [["a", 68.80, 16.50], ["a:now", 68.80, 16.50]]);
  flightsMod.observe(day, [air(2400)], sites, NOW + 2400000, 2, { a: 400, "a:now": 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 1 }, "utenfor rekkevidde høyt oppe: samme tur");
  // I ro i vinden 500 m over bakken: ikke landet.
  flightsMod.observe(day, [hover(2520)], sites, NOW + 2520000, 2);
  assert.deepEqual(flightsMod.needsGround(day, [hover(2640)], NOW + 2640000), [["a", 68.80, 16.50]]);
  flightsMod.observe(day, [hover(2640)], sites, NOW + 2640000, 2, { a: 400 });
  assert.equal(day.pilots.a.flying, true, "å henge høyt oppe er ikke å lande");
  flightsMod.observe(day, [air(2760)], sites, NOW + 2760000, 2);
  assert.deepEqual(day.pilots.a.flights, { heia: 1 });
  // Sist sett 50 m over bakken, hørt igjen 30 minutter senere i lufta: landet og en ny tur.
  flightsMod.observe(day, [air(2880, 450)], sites, NOW + 2880000, 2);
  flightsMod.observe(day, [air(4680)], sites, NOW + 4680000, 2, { a: 400, "a:now": 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 2 }, "et opphold etter å ha vært lavt: en ny tur");
  // Uten bakkens høyde der piloten var, betyr et opphold landet, og etter MAX_GAP_MINUTES uansett høyde.
  flightsMod.observe(day, [air(4680 + 1200)], sites, NOW + (4680 + 1200) * 1000, 2, { "a:now": 400 });
  assert.deepEqual(day.pilots.a.flights, { heia: 3 });
  assert.deepEqual(flightsMod.needsGround(day, [air(5880 + 3 * 3600)], NOW + (5880 + 3 * 3600) * 1000), [], "etter to timer spørres ikke høyden");

  const realFetch = globalThis.fetch;
  let asked = null;
  globalThis.fetch = async (url) => { asked = String(url); return Response.json({ punkter: [{ z: 412.3 }, { z: null }] }); };
  try {
    assert.deepEqual(await flightsMod.groundAt([["a", 68.8, 16.5], ["b", 70, 30]]), { a: 412.3 }, "et punkt uten høyde utelates");
    assert.match(decodeURIComponent(asked), /punkter=\[\[16\.5,68\.8\],\[30,70\]\]/);
    globalThis.fetch = async () => new Response("", { status: 500 });
    const warn = console.warn; console.warn = () => {};
    assert.deepEqual(await flightsMod.groundAt([["a", 68.8, 16.5]]), {});
    console.warn = warn;
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("turer: en kjøring beholder bare døgnets nøkler, laget med et salt som kastes neste dag", async () => {
  const state = {}, days = new Map(), snaps = {};
  const store = {
    getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = structuredClone(v); },
    putFlightDays: async (rows) => { for (const r of rows) days.set(`${r.day}|${r.site}`, r); },
    flightDays: async () => [...days.values()], putSnapshot: async (d, b) => { snaps[d] = JSON.parse(b); },
    deleteFlightDay: async (day, site) => { days.delete(`${day}|${site}`); },
    putFlight: async (f) => { tracks.set(f.id, f); }, flightsSince: async (day) => [...tracks.values()].filter((f) => f.day >= day), pruneFlights: async () => {},
  };
  const tracks = new Map();
  const realFetch = globalThis.fetch;
  const ogn = '<markers><m a="68.801,16.501,P,Pilot,900,09:00:00,5,90,30,1.2,7,AVX970,DD1234,dd1234ab"/></markers>';
  globalThis.fetch = async (url) => (String(url).includes("geonorge") ? Response.json({ punkter: [{ z: 400 }] }) : new Response(ogn));
  try {
    const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
    await flightsMod.run(store, sites, NOW, 2);
    const today = state["flights-today"];
    assert.equal(Object.keys(today.pilots).length, 1);
    assert.ok(!JSON.stringify(today).includes("dd1234ab"), "enhetens id lagres ikke, bare en nøkkel");
    assert.equal(snaps.flights.sites.heia, undefined, "først sett: venter til den er kjent i lufta");
    assert.ok(state[flightsMod.CLEANUP.flag], "engangsryddingen kjørte og er registrert");
    await flightsMod.run(store, sites, NOW + 120000, 2);
    assert.equal(snaps.flights.sites.heia.flights, 1, "500 m over bakken: telt, med minuttene fra første kjøring");
    assert.equal(snaps.flights.sites.heia.pilots, 1);
    assert.equal(snaps.flights.sites.heia.minutes, 4);
    assert.equal(tracks.size, 0, "fortsatt i lufta: ikke skrevet ennå");
    globalThis.fetch = async () => new Response("<markers></markers>");
    await flightsMod.run(store, sites, NOW + 86400000, 2);
    assert.notEqual(state["flights-today"].salt, today.salt, "et nytt salt hver dag");
    assert.equal(tracks.size, 1, "dagen er over: den åpne turen skrives med den gamle dagens dato");
    const written = [...tracks.values()][0];
    assert.equal(written.day, today.day);
    assert.deepEqual([written.site, written.minutes, written.counted, written.points.length, written.max_alt], ["heia", 4, 1, 2, 900]);
    assert.ok(!JSON.stringify(written).includes("dd1234ab") && !("key" in written), "ingen enhets-id, ingen nøkkel i turen");
    assert.equal(snaps["flight-log"].flights.length, 1);
    assert.equal(snaps["flight-log"].flights[0].id, written.id);
    assert.equal(snaps.flights.sites.heia.days, 1, "den gamle dagens piloter er borte; en ny dag uten noen i lufta legger ikke til noe");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("turer: en bil med appen på er ikke en tur; en pilot lavt over bakken venter til den er i lufta", () => {
  const sites = [{ id: "haugfjellet", lat: 68.562, lon: 17.503 }];
  const at = (s) => new Date(NOW + s * 1000).toISOString();
  const day = { day: "2026-10-25", pilots: {} };
  // 90 km/t på E6: flyr ikke i det hele tatt.
  assert.equal(flightsMod.isFlying({ speed: 25, climb: 0 }), false);
  assert.equal(flightsMod.isFlying({ speed: 15, climb: 0 }), true);
  flightsMod.observe(day, [{ key: "car", lat: 68.56, lon: 17.50, alt: 60, speed: 25, climb: 0, time: at(0) }], sites, NOW, 2);
  assert.deepEqual(day.pilots, {}, "for fort: aldri en pilot");
  // 50 km/t gjennom Bjerkvik, 5 m over bakken, i fem kjøringer, så parkert: ingenting telles.
  for (let i = 0; i < 5; i++) {
    const item = { key: "car", lat: 68.56 + i * 0.005, lon: 17.50, alt: 65, speed: 14, climb: 0, time: at(120 * (i + 1)) };
    assert.deepEqual(flightsMod.needsGround(day, [item], NOW + 120000 * (i + 1)), i ? [["car:now", item.lat, item.lon]] : [], "høyden til en ventende pilot spørres");
    flightsMod.observe(day, [item], sites, NOW + 120000 * (i + 1), 2, { "car:now": 60 });
  }
  assert.ok(day.pilots.car.pending, "venter fortsatt: aldri 50 m over bakken");
  assert.deepEqual(day.pilots.car.flights, {});
  assert.deepEqual(flightsMod.dayRows(day), [], "ingenting telles mens den venter");
  for (let i = 6; i < 8; i++) flightsMod.observe(day, [{ key: "car", lat: 68.59, lon: 17.50, alt: 65, speed: 0, climb: 0, time: at(120 * i) }], sites, NOW + 120000 * i, 2, { car: 60 });
  assert.equal(day.pilots.car.flying, false);
  assert.equal(day.pilots.car.pending, null, "parkert: den ventende turen droppes");
  assert.deepEqual(flightsMod.dayRows(day), []);
  // En ekte pilot: lavt først (starten), så 200 m opp: telt med minuttene siden avgang.
  const pilot = (s, alt) => ({ key: "p", lat: 68.563, lon: 17.504, alt, speed: 9, climb: 1, time: at(s) });
  flightsMod.observe(day, [pilot(0, 540)], sites, NOW, 2);
  flightsMod.observe(day, [pilot(120, 560)], sites, NOW + 120000, 2, { "p:now": 523 });
  assert.deepEqual(day.pilots.p.flights, {}, "37 m over starten: ikke ennå");
  flightsMod.observe(day, [pilot(240, 730)], sites, NOW + 240000, 2, { "p:now": 523 });
  assert.deepEqual(day.pilots.p.flights, { haugfjellet: 1 });
  assert.equal(day.pilots.p.minutes.haugfjellet, 6, "minuttene mens den venter, teller");
  assert.equal(day.pilots.p.alt.haugfjellet, 730);
  // Uten svar fra Kartverket teller turen etter PENDING_RUNS kjøringer, som før.
  const q = (s) => ({ key: "q", lat: 68.563, lon: 17.504, alt: null, speed: 9, climb: 1, time: at(s) });
  for (let i = 0; i < flightsMod.PENDING_RUNS; i++) flightsMod.observe(day, [q(120 * i)], sites, NOW + 120000 * i, 2);
  assert.deepEqual(day.pilots.q.flights, { haugfjellet: 1 });
  assert.deepEqual(flightsMod.dayRows(day), [{ day: "2026-10-25", site: "haugfjellet", flights: 2, pilots: 2, minutes: 12, max_dist: 0.1, max_alt: 730 }]);
});

test("turer: hver tur beholder posisjonene; landing, opphold eller feiingen avslutter den, telt eller ikke", () => {
  const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
  const at = (s) => new Date(NOW + s * 1000).toISOString();
  const day = { day: "2026-10-18", pilots: {} };
  const air = (s, alt, speed) => ({ key: "a", lat: 68.80 + s / 100000, lon: 16.50, alt, speed: speed ?? 9, climb: 1, time: at(s) });
  flightsMod.observe(day, [air(0, 600)], sites, NOW, 2, { "a:now": 400 });
  flightsMod.observe(day, [air(120, 800, 14.2)], sites, NOW + 120000, 2);
  const t = day.pilots.a.track;
  assert.equal(t.points.length, 2);
  assert.deepEqual(t.points[1], [at(120), 68.8012, 16.5, 800, 14.2, 1]);
  assert.deepEqual([t.site, t.start, t.minutes, t.maxAlt, t.maxSpeed], ["heia", at(0), 4, 800, 14.2]);
  assert.equal(day.finished, undefined, "ingenting ferdig ennå");
  // Landet: turen er ferdig og telt.
  const ground = (s) => ({ key: "a", lat: 68.80, lon: 16.50, alt: 60, speed: 0, climb: 0, time: at(s) });
  flightsMod.observe(day, [ground(240)], sites, NOW + 240000, 2);
  flightsMod.observe(day, [ground(360)], sites, NOW + 360000, 2);
  assert.equal(day.finished.length, 1);
  const f = day.finished[0];
  assert.deepEqual([f.day, f.site, f.start, f.end, f.minutes, f.max_alt, f.max_dist, f.max_speed, f.counted, f.points.length], ["2026-10-18", "heia", at(0), at(120), 4, 800, 0.1, 14.2, 1, 2]);
  assert.match(f.id, /^[0-9a-f]{12}$/);
  assert.equal(day.pilots.a.track, null);
  // En gåtur med appen på: venter hele tiden, parkert etter tre kjøringer: beholdes ikke i det hele tatt.
  const walk = (s) => ({ key: "w", lat: 68.801, lon: 16.501, alt: 490, speed: 1.5, climb: 0.6, time: at(s) });
  for (let i = 0; i < 3; i++) flightsMod.observe(day, [walk(60 + 120 * i)], sites, NOW + 60000 + 120000 * i, 2, { "w:now": 480 });
  flightsMod.observe(day, [{ ...walk(420), speed: 0, climb: 0 }], sites, NOW + 420000, 2);
  flightsMod.observe(day, [{ ...walk(540), speed: 0, climb: 0 }], sites, NOW + 540000, 2);
  assert.equal(day.finished.length, 1, "aldri i lufta: beholdes ikke");
  assert.equal(day.pilots.w.track, null);
  assert.deepEqual(day.pilots.w.flights, {});
  // Ikke hørt på mer enn to timer: feiingen avslutter turen.
  flightsMod.observe(day, [{ ...air(600, 700), key: "s" }], sites, NOW + 600000, 2, { "s:now": 400 });
  assert.equal(flightsMod.sweep(day, NOW + 600000 + 60 * 60000), false, "en time: fortsatt i lufta");
  assert.equal(flightsMod.sweep(day, NOW + 600000 + 121 * 60000), true);
  assert.equal(day.finished.length, 2);
  assert.equal(day.pilots.s.flying, false);
  // Loggdatasettet, nyeste først, med posisjonene tolket.
  const log = flightsMod.buildFlightLog(day.finished.map((x) => ({ ...x, counted: x.counted, points: JSON.stringify(x.points) })), NOW);
  assert.equal(log.dataset, "flight-log");
  assert.deepEqual(log.flights.map((x) => x.id), [day.finished[1].id, day.finished[0].id]);
  assert.deepEqual([log.flights[1].counted, log.flights[1].maxAlt, log.flights[1].points[0][3]], [true, 800, 600]);
});

test("turer: engangsryddingen fjerner bilens dag på Haugfjellet fra lageret og fra dagen, én gang", async () => {
  const state = { "flights-today": { day: "2026-10-25", salt: "s", pilots: { x: { last: 0, flying: false, still: 0, pos: null, site: "haugfjellet", flights: { haugfjellet: 1 }, minutes: { haugfjellet: 18 }, dist: { haugfjellet: 27.4 }, alt: { haugfjellet: 179 }, pending: null } } } };
  const deleted = [], days = new Map([["2026-10-25|haugfjellet", { day: "2026-10-25", site: "haugfjellet", flights: 1, pilots: 1, minutes: 18, max_dist: 27.4, max_alt: 179 }]]);
  const store = {
    getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = structuredClone(v); },
    putFlightDays: async (rows) => { for (const r of rows) days.set(`${r.day}|${r.site}`, r); }, flightDays: async () => [...days.values()],
    putSnapshot: async () => {}, deleteFlightDay: async (day, site) => { deleted.push([day, site]); days.delete(`${day}|${site}`); },
    putFlight: async () => {}, flightsSince: async () => [], pruneFlights: async () => {},
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<markers></markers>");
  try {
    await flightsMod.run(store, [{ id: "haugfjellet", lat: 68.562, lon: 17.503 }], Date.parse("2026-10-25T13:00:00Z"), 2);
    assert.deepEqual(deleted, [["2026-10-25", "haugfjellet"]]);
    assert.deepEqual(state["flights-today"].pilots.x.flights, {}, "dagens tall for stedet er også borte");
    assert.equal(days.size, 0);
    await flightsMod.run(store, [{ id: "haugfjellet", lat: 68.562, lon: 17.503 }], Date.parse("2026-10-25T13:02:00Z"), 2);
    assert.equal(deleted.length, 1, "bare én gang");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("køen: et mislykket forsøk sender en start bakerst, så starter som stadig feiler, ikke tar hver kjøring", () => {
  const state = { sites: { a: { fetched: ago(60), tried: ago(1) }, b: { fetched: ago(25) }, c: { tried: ago(2) } } };
  assert.deepEqual(pickSites(sites, state, 2).map((s) => s.id), ["d", "b"]);
  assert.deepEqual(pickSites(sites, state, 4).map((s) => s.id), ["d", "b", "c", "a"]);
  assert.equal(windgramMod.pickSites(sites, state, 1)[0].id, "d");
});

test("MET: starter som feiler, merkes som forsøkt, og neste kjøring henter de andre", async () => {
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
    assert.equal(first.length, 6, "seks forsøkt");
    assert.ok(first.every((id) => state.sites[id].tried && !state.sites[id].fetched));
    await run(store, many, NOW + 5 * 60000);
    assert.ok(["s6", "s7"].every((id) => state.sites[id]?.tried), "de to som ikke er forsøkt ennå, kommer neste gang");
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

test("Holfuy: de ferske målingene publiseres selv når arkivet feiler", async () => {
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
    assert.ok(saved[holfuy.DATASET], "øyeblikksbildet skrives");
    assert.ok(warned.some((m) => /arkivet: R2 nede/.test(m)));
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

test("status: når hver kilde kjørte og lyktes, og hvilke datasett som er for gamle eller mangler starter", async () => {
  const health = await import("../workers/data/src/health.js");
  let runs = health.recordRuns(null, { forecast: null, stations: null }, NOW - 60000);
  runs = health.recordRuns(runs, { forecast: "MET svarte 500" }, NOW);
  assert.deepEqual(runs.forecast, { tried: new Date(NOW).toISOString(), ok: new Date(NOW - 60000).toISOString(), error: "MET svarte 500", errorAt: new Date(NOW).toISOString() });
  assert.equal(runs.stations.ok, new Date(NOW - 60000).toISOString());
  // Tidtatte kjøringer: den siste, et glidende snitt og den tregeste i dag, beholdt også ved feil.
  let timed = health.recordRuns(null, { forecast: { error: null, ms: 1000 } }, NOW);
  assert.deepEqual([timed.forecast.lastMs, timed.forecast.avgMs, timed.forecast.maxMs, timed.forecast.maxAt], [1000, 1000, 1000, new Date(NOW).toISOString()]);
  timed = health.recordRuns(timed, { forecast: { error: null, ms: 2000 } }, NOW + 60000);
  assert.deepEqual([timed.forecast.lastMs, timed.forecast.avgMs, timed.forecast.maxMs], [2000, 1200, 2000]);
  timed = health.recordRuns(timed, { forecast: { error: "MET svarte 500", ms: 20000 } }, NOW + 120000);
  assert.deepEqual([timed.forecast.lastMs, timed.forecast.maxMs, timed.forecast.error, timed.forecast.ok], [20000, 20000, "MET svarte 500", new Date(NOW + 60000).toISOString()]);
  timed = health.recordRuns(timed, { forecast: { error: null, ms: 500 } }, NOW + 86400000);
  assert.deepEqual([timed.forecast.maxMs, timed.forecast.maxAt], [500, new Date(NOW + 86400000).toISOString()], "den tregeste kjøringen starter på nytt med dagen");
  assert.equal(health.cleanError("fetch failed: https://api.holfuy.com/live/?s=101&pw=hemmelig&m=JSON"), "fetch failed: [adresse]", "aldri en nøkkel fra en adresse");
  const snapshots = {
    forecast: { updated: ago(10), body: JSON.stringify({ sites: { a: [], b: [] } }) },
    stations: { updated: ago(30), body: "{}" },
    windgram: { updated: ago(20), body: JSON.stringify({ sites: { a: {} } }) },
  };
  // Verifiseringen har kjørt (og feilet); varselnettene har aldri kjørt.
  const s = health.buildStatus({ runs: health.recordRuns(runs, { verify: "feil" }, NOW), snapshots, expected: { forecast: ["a", "b", "c"], windgram: ["a"] }, archive: { holfuy: "2026-10-17" }, now: NOW });
  assert.equal(s.ok, false);
  assert.deepEqual(s.datasets.forecast, { updated: ago(10), ageMinutes: 10, maxAgeMinutes: 60, ok: true, missing: ["c"] });
  assert.equal(s.datasets.stations.ok, false, "30 minutter uten målinger er for gammelt");
  assert.deepEqual(s.datasets.windgram.missing, []);
  assert.equal(s.datasets.verification.ok, false, "aldri skrevet, selv om kilden har kjørt");
  assert.deepEqual([s.datasets.grid.ok, s.datasets.grid.pending, s.datasets["grid-wide"].pending], [true, true, true], "en kilde som aldri har kjørt, venter og er ikke en alarm");
  const later = health.buildStatus({ runs: health.recordRuns(runs, { gridWide: "Open-Meteo svarte 502" }, NOW), snapshots: {}, expected: {}, archive: {}, now: NOW });
  assert.equal(later.datasets["grid-wide"].ok, false, "når den har kjørt, teller et manglende datasett");
  assert.equal(s.archive.holfuy, "2026-10-17");
  assert.equal(s.backup, null, "ikke noe arkiv: ingenting å melde om");
  const withBackup = (backup, restore) => health.buildStatus({ runs, snapshots, expected: {}, archive: {}, backup, restore, now: NOW }).backup;
  assert.deepEqual(withBackup({ day: "2026-10-17", rows: {} }), { day: "2026-10-17", daysAgo: 1, maxDays: 2, ok: true, restored: null });
  assert.deepEqual(withBackup({ day: "2026-10-15", rows: {} }), { day: "2026-10-15", daysAgo: 3, maxDays: 2, ok: false, restored: null }, "tre dager uten sikkerhetskopi er et problem");
  assert.deepEqual(withBackup(null), { day: null, daysAgo: null, maxDays: 2, ok: false, restored: null }, "arkivet satt opp, men aldri sikkerhetskopiert");
  // Et lager som leste inn siste sikkerhetskopi ved oppstart, sier det, med radene per tabell.
  const restore = { at: "2026-10-18T06:01:00.000Z", rows: { flight_days: 40, verify_hours: 900 } };
  assert.deepEqual(withBackup({ day: "2026-10-17", rows: {} }, restore).restored, restore);
  assert.equal(health.buildStatus({ runs, snapshots: { forecast: snapshots.forecast }, expected: {}, archive: {}, backup: { day: "2026-10-15" }, now: NOW }).ok, false, "en sen sikkerhetskopi gjør at statusen ikke er ok");
});

const aprsMod = await import("../workers/data/src/aprs.js");
// Linjer fra OGNs APRS-strøm ved NOW: en paraglider (detaljbyte 1E: type 7, FLARM-adresse) hørt to ganger, et seilfly
// (06), en som ikke skal spores etter flagget sitt (5E), en i stealth (9E, telles fortsatt, navngis aldri), og
// serverlinjer.
const APRS = [
  "# aprsc 2.1.14 18 Oct 2026 15:19:50 GMT GLIDERN1 1.2.3.4:14580",
  "FLRDDA5BA>OGFLR,qAS,Kvaefj:/151940h6847.40N/01622.00E'342/019/A=003200 !W00! id1EDDA5BA +100fpm",
  "FLRDDA5BA>OGFLR,qAS,Kvaefj:/151955h6847.41N/01622.03E'342/019/A=003281 !W52! id1EDDA5BA +197fpm -1.1rot 8.8dB",
  "FLRDD0001>OGFLR,qAS,Kvaefj:/151955h6848.00N/01620.00E'090/050/A=004000 !W00! id06DD0001 +300fpm",
  "FNT110002>OGNFNT,qAS,Kvaefj:/151955h6848.00N/01620.00E'090/015/A=004000 !W00! id5E110002 +300fpm",
  "FNT110003>OGNFNT,qAS,Kvaefj:/151950h6846.00N/01621.00E'000/000/A=002000 !W00! id9E110003 -400fpm",
  "OGN123456>OGNSDR,TCPIP*,qAC,GLIDERN1:/151955h6847.00N/01622.00EI v0.2.8",
];

test("aprs: posisjoner til paraglidere fra strømmen, i live.js sin form, uten de som ikke skal spores og andre luftfartøy", () => {
  const items = APRS.map((l) => aprsMod.parseAprsLine(l, NOW)).filter(Boolean);
  assert.equal(items.length, 3);
  assert.deepEqual(items[1], { id: "dda5ba", name: null, lat: 68.79025, lon: 16.3672, alt: 1000, track: 342, speed: 9.8, climb: 1, type: 7, time: "2026-10-18T15:19:55.000Z" });
  assert.equal(items[2].id, "110003", "stealth: telt, men aldri navngitt");
  assert.equal(items[2].name, null);
  assert.equal(items[2].track, null, "kurs 0 uten fart er ikke kjent");
  assert.equal(items[2].climb, -2);
  assert.equal(aprsMod.parseAprsLine(APRS[2], NOW, new Set(["DDA5BA"])), null, "«tracked: N» i OGNs enhetsdatabase");
  assert.equal(aprsMod.parseAprsLine(APRS[2], NOW + 11 * 60000), null, "eldre enn ti minutter");
  assert.equal(aprsMod.parseAprsLine(APRS[2].replace("151955h", "235958h"), Date.parse("2026-10-19T00:00:30Z"))?.time, "2026-10-18T23:59:58.000Z", "rett før midnatt UTC");
  assert.equal(aprsMod.aprsFilter([{ lat: 68, lon: 16 }, { lat: 69, lon: 17 }]), "a/69.50/15.00/67.50/18.00");
});

// En stand-in for Cloudflares connect: strømmen sender bitene (delt midt i en linje, som TCP kan gjøre) og holder seg
// så åpen.
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

test("aprs: innlogging med bare lesetilgang og områdefilter, hvert luftfartøys nyeste posisjon, tilkoblingen lukket etter tiden", async () => {
  const text = APRS.join("\r\n") + "\r\n";
  const fake = fakeAprs([text.slice(0, 150), text.slice(150, 400), text.slice(400)]);
  const items = await aprsMod.listenAprs([{ lat: 68.8, lon: 16.5 }], new Set(), { seconds: 0.05, now: NOW, connect: fake.connect });
  assert.equal(fake.sent[0], "aprs.glidernet.org:14580");
  assert.match(fake.sent[1], /^user HPGTFS pass -1 vers hpgt-flysteder 1\.0 filter a\/69\.30\/15\.50\/68\.30\/17\.50\r\n$/);
  assert.deepEqual(items.map((i) => [i.id, i.time.slice(11, 19)]), [["dda5ba", "15:19:55"], ["110003", "15:19:50"]]);
  assert.ok(fake.closed());
});

test("aprs: reserven når OGNs nettkart ikke svarer, bare med listen over enheter som ikke skal spores", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 521 });
  try {
    const sites = [{ lat: 68.8, lon: 16.5 }];
    const fake = fakeAprs([APRS.join("\n") + "\n"]);
    const store = { noTrack: async () => ["DDA5BA"] };
    const items = await liveMod.fetchLive(sites, NOW, { store, aprsSeconds: 0.05, connect: fake.connect });
    assert.equal(items.via, "aprs");
    assert.deepEqual(items.map((i) => i.id), ["110003"], "enheten databasen sier ikke skal spores, utelates");
    await assert.rejects(() => liveMod.fetchLive(sites, NOW), /OGN svarte 521/, "uten lager, ingen reserve");
    const noList = { noTrack: async () => { throw new Error("OGN-registeret svarte 503"); } };
    await assert.rejects(() => liveMod.fetchLive(sites, NOW, { store: noList, connect: fakeAprs([]).connect }), /OGN svarte 521; APRS: OGN-registeret svarte 503/,
      "uten listen gir reserven ingenting");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("aprs: enhetene som ikke skal spores, fra OGNs enhetsdatabase som CSV (eller JSON), et ødelagt svar avvises", async () => {
  const csv = "#DEVICE_TYPE,DEVICE_ID,AIRCRAFT_MODEL,REGISTRATION,CN,TRACKED,IDENTIFIED\n"
    + Array.from({ length: 1200 }, (_, i) => `'F','${i.toString(16).padStart(6, "0")}','${i === 5 ? "Ventus 2cxM, 18m" : i === 6 ? "L'Hirondelle" : "Unknown"}','D-${i}','','${i % 100 ? "Y" : "N"}','Y'`).join("\r\n") + "\r\n";
  const asked = [];
  const ids = await aprsMod.fetchNoTrack(async (url) => { asked.push(url); return new Response(csv); });
  assert.deepEqual(asked, [aprsMod.DDB_URL], "bare over HTTPS");
  assert.equal(ids.length, 12);
  assert.equal(ids[1], "000064");
  assert.deepEqual(aprsMod.parseDdb(csv).slice(5, 7), [{ id: "000005", tracked: "Y" }, { id: "000006", tracked: "Y" }], "et komma eller et anførselstegn i modellen spiller ingen rolle");
  const devices = Array.from({ length: 1200 }, (_, i) => ({ device_type: "F", device_id: i.toString(16).padStart(6, "0"), tracked: i % 100 ? "Y" : "N", identified: "Y" }));
  assert.equal((await aprsMod.fetchNoTrack(async () => Response.json({ devices }))).length, 12, "den gamle JSON-formen leses fortsatt");
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => Response.json({ devices: devices.slice(0, 10) })), /uventet svar/);
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => new Response("<html>down</html>")), /uventet svar/);
  await assert.rejects(() => aprsMod.fetchNoTrack(async () => new Response("", { status: 502 })), /svarte 502/);
});

test("turer: én gang etter endringen ryddes turene som ikke telles, og loggen lages på nytt, deretter bare når det skrives", async () => {
  const state = { "flight-log-built": { at: "2026-10-26T00:00:00.000Z" } }, pruned = [], snaps = {};
  const store = {
    getState: async (k) => state[k] ?? null, putState: async (k, v) => { state[k] = structuredClone(v); },
    putFlightDays: async () => {}, flightDays: async () => [], putSnapshot: async (d, b) => { snaps[d] = JSON.parse(b); },
    deleteFlightDay: async () => {}, putFlight: async () => {}, flightsSince: async () => [], pruneFlights: async (before) => { pruned.push(before); },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<markers></markers>");
  try {
    const sites = [{ id: "heia", lat: 68.80, lon: 16.50 }];
    await flightsMod.run(store, sites, Date.parse("2026-10-27T10:00:00Z"), 1);
    assert.deepEqual(pruned, ["2026-06-29"], "ryddet én gang, med aldersgrensen");
    assert.equal(state["flight-log-built"].version, 2);
    assert.equal(snaps["flight-log"].flights.length, 0);
    await flightsMod.run(store, sites, Date.parse("2026-10-27T10:01:00Z"), 1);
    assert.equal(pruned.length, 1, "ikke igjen");
  } finally {
    globalThis.fetch = realFetch;
  }
});
