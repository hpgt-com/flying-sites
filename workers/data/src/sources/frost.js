// Measured weather from MET's own weather stations (Frost, frost.met.no), in the same stations dataset as Holfuy: the
// stations within the area of the flying sites are found by MET itself once a day, and their latest observations are
// fetched every ten minutes, stored and archived as Holfuy's are. The client ID is the secret FROST_CLIENT_ID in
// Cloudflare (free, frost.met.no/auth/requestCredentials.html); without it MET is skipped. Tested in
// test/data-worker.test.js.

import { archiveSource } from "../archive.js";
import { num } from "../measurements.js";

export const DATASET = "stations-met";
export const SOURCE = "MET Norge";
// MET's terms ask for credit; Frost's data is CC BY (frost.met.no/termsofuse.html).
export const LICENSE = "CC BY 4.0, MET Norge";
// The source's key in the store and the archive (measurements.js).
export const KEY = "met";
export const HISTORY_HOURS = 6;
export const KEEP_DAYS = 7;
// The stations in the area are looked up again after this long, so new and closed stations follow.
export const DISCOVER_HOURS = 24;
// The flying sites' area, widened by this much (degrees; more east–west, where a degree is shorter) for the lookup. Of the
// stations found, those within NEAR_KM of a launch are kept: the weather over the whole region, from Lofoten to Bardu,
// without the far corners of the box. The map thins them when zoomed out (src/assets/js/stations.js), so all can be kept.
export const MARGIN = 0.5;
export const NEAR_KM = 50;
const API = "https://frost.met.no";
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// What is asked for, and where it goes. Frost names the element; the gust is the highest in the last 10 minutes, the
// rain the sum over the last hour.
export const ELEMENTS = {
  wind_from_direction: "dir",
  wind_speed: "speed",
  "max(wind_speed_of_gust PT10M)": "gust",
  air_temperature: "temperature",
  relative_humidity: "humidity",
  air_pressure_at_sea_level: "pressure",
  "sum(precipitation_amount PT1H)": "rain",
};

// The area of the flying sites as a closed polygon in Frost's form, "POLYGON((lon lat, …))".
export function areaPolygon(sites, margin = MARGIN) {
  const lats = sites.map((s) => s.lat), lons = sites.map((s) => s.lon);
  const s = Math.min(...lats) - margin, n = Math.max(...lats) + margin, w = Math.min(...lons) - 2 * margin, e = Math.max(...lons) + 2 * margin;
  const p = (lon, lat) => `${lon.toFixed(3)} ${lat.toFixed(3)}`;
  return `POLYGON((${p(w, s)}, ${p(e, s)}, ${p(e, n)}, ${p(w, n)}, ${p(w, s)}))`;
}

// The stations within `km` of any launch.
export function nearSites(stations, sites, km = NEAR_KM) {
  const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));
  return stations.filter((s) => sites.some((site) => dist(s, site) <= km));
}

// «EVENES LUFTHAVN» → «Evenes lufthavn»: MET's names are in capitals.
export function stationName(name) {
  const s = String(name ?? "").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

// Frost's sources as stations: { id, name, lat, lon, altitude }, only land stations with a position.
export function parseSources(data) {
  return (Array.isArray(data?.data) ? data.data : []).flatMap((s) => {
    const c = s?.geometry?.coordinates;
    if (typeof s?.id !== "string" || !/^SN\d+$/.test(s.id) || !Array.isArray(c) || num(c[0]) === null || num(c[1]) === null) return [];
    return [{ id: s.id, name: stationName(s.name), lat: num(c[1]), lon: num(c[0]), altitude: num(s.masl) }];
  });
}

// Frost's observations as measurements, one per station and time, with the fields of measurements.js. Frost gives each
// element with its own time ("latest" can differ per element); the latest time with a wind speed is used, and the
// other elements from that same time. Stations without a wind speed are left out.
export function parseObservations(data) {
  const byStation = new Map();
  for (const d of Array.isArray(data?.data) ? data.data : []) {
    const station = typeof d?.sourceId === "string" ? d.sourceId.split(":")[0] : null;
    const time = Date.parse(d?.referenceTime);
    if (!station || !/^SN\d+$/.test(station) || !Number.isFinite(time)) continue;
    const times = byStation.get(station) ?? new Map();
    const values = times.get(time) ?? {};
    for (const o of Array.isArray(d.observations) ? d.observations : []) {
      const field = ELEMENTS[o?.elementId];
      if (field && num(o.value) !== null && values[field] === undefined) values[field] = num(o.value);
    }
    times.set(time, values);
    byStation.set(station, times);
  }
  const out = [];
  for (const [station, times] of byStation) {
    const withWind = [...times.entries()].filter(([, v]) => v.speed !== undefined).sort((a, b) => b[0] - a[0]);
    if (!withWind.length) continue;
    const [time, v] = withWind[0];
    out.push({
      source: KEY, station, time: new Date(time).toISOString(),
      dir: v.dir ?? null, speed: v.speed, gust: v.gust ?? null, min: null,
      temperature: v.temperature ?? null, humidity: v.humidity ?? null, pressure: v.pressure ?? null, rain: v.rain ?? null,
      extra: null,
    });
  }
  return out;
}

// The dataset: one item per station that has measured wind in the last hours, sorted by name, in the same form as
// Holfuy's (sources/holfuy.js). sites: { SN…: site id } for a station that belongs to a flying site (stations.js).
export function buildStations(stations, rows, sites = {}, now = Date.now()) {
  const items = stations.map((s) => {
    const own = rows.filter((r) => r.station === s.id).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const last = own[own.length - 1];
    return {
      id: s.id, name: s.name ?? s.id, model: null, site: sites[s.id] ?? null, source: SOURCE, url: null,
      lat: s.lat, lon: s.lon, altitude: s.altitude ?? null,
      time: last?.time ?? null,
      wind: last ? { dir: last.dir, speed: last.speed, gust: last.gust, min: null } : null,
      temperature: last?.temperature ?? null, humidity: last?.humidity ?? null, pressure: last?.pressure ?? null, rain: last?.rain ?? null,
      extra: null,
      history: own.map((r) => [r.time, r.dir, r.speed, r.gust, null, r.temperature]),
    };
  }).filter((i) => i.time).sort((a, b) => a.name.localeCompare(b.name, "nb"));
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), items };
}

async function frost(env, path, params) {
  const url = new URL(path, env.FROST_URL || API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { authorization: "Basic " + btoa(env.FROST_CLIENT_ID + ":"), "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  // 404 and 412: Frost has no data for the request (no station has these elements now), not an error.
  if (response.status === 404 || response.status === 412) return { data: [] };
  if (!response.ok) throw new Error(`Frost svarte ${response.status}`);
  return response.json();
}

// One run: looks up the stations in the area when DISCOVER_HOURS have passed, fetches their latest observations (in
// groups, so the address stays short), stores and archives them, and stores the dataset. Without the client ID nothing.
// exclude: MET numbers never to show (stations.js MET_EXCLUDE). When the area or the list changes, the stations are
// looked up again at once instead of after DISCOVER_HOURS.
export async function run(store, env, sites, siteOf = {}, now = Date.now(), exclude = []) {
  if (!env.FROST_CLIENT_ID || !sites.length) return;
  const area = `${areaPolygon(sites)} ${NEAR_KM} ${exclude.join(",")}`;
  let state = (await store.getState("met-stations")) ?? { found: null, stations: [] };
  if (!state.found || state.area !== area || now - Date.parse(state.found) > DISCOVER_HOURS * 3600000) {
    // Only the fields parseSources reads, so the answer for the whole region stays small to read.
    const data = await frost(env, "/sources/v0.jsonld", { types: "SensorSystem", geometry: areaPolygon(sites), validtime: "now", fields: "id,name,geometry,masl" });
    state = { found: new Date(now).toISOString(), area, stations: nearSites(parseSources(data), sites).filter((s) => !exclude.includes(s.id)) };
  }
  const measurements = [];
  for (let i = 0; i < state.stations.length; i += 25) {
    const ids = state.stations.slice(i, i + 25).map((s) => s.id).join(",");
    const data = await frost(env, "/observations/v0.jsonld", { sources: ids, referencetime: "latest", maxage: "PT2H", elements: Object.keys(ELEMENTS).join(",") });
    measurements.push(...parseObservations(data));
  }
  // Only the stations that measure wind are kept, so the next runs ask for fewer.
  const active = new Set(measurements.map((m) => m.station));
  if (measurements.length) state.stations = state.stations.filter((s) => active.has(s.id));
  await store.putState("met-stations", state);
  await store.addMeasurements(measurements);
  // The fresh measurements are published first; the archive comes after, and a failing archive (R2 down) only logs.
  const rows = await store.measurementsSince(KEY, new Date(now - HISTORY_HOURS * 3600000).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildStations(state.stations, rows, siteOf, now)));
  try {
    await archiveSource(store, env, KEY, state.stations.map((s) => ({ source: KEY, id: s.id, name: s.name, model: null, site: siteOf[s.id] ?? null, lat: s.lat, lon: s.lon, altitude: s.altitude })), KEEP_DAYS, now);
  } catch (err) {
    console.warn(`Frost: arkivet: ${err.message}`);
  }
}
