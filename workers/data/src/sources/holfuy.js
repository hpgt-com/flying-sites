// Measured wind from Holfuy's weather stations (dataset «stations»). Every run (every minute) fetches the latest
// measurement for all stations in stations.js in one request, stores it, and builds the dataset with the last
// HISTORY_HOURS of measurements per station. The API key is the secret HOLFUY_KEY in Cloudflare. Tested in
// test/data-worker.test.js.
//
// The store keeps KEEP_DAYS of measurements. Older days are written to the archive (archive.js, R2) once a day is over,
// one CSV per station per day (holfuy/station=<id>/year=<year>/<date>.csv) and the stations in holfuy/stations.csv, and
// deleted from the store only after that.

import { dayPath, daysToArchive, measurementsCsv, pruneBefore, stationsCsv } from "../archive.js";
import { extraValues, num } from "../measurements.js";

export const DATASET = "stations";
export const SOURCE = "Holfuy";
// The source's key in the store and the archive (measurements.js).
export const KEY = "holfuy";
export const HISTORY_HOURS = 6;
// Measurements older than this are deleted from the store once they are in the archive, so the store stays small.
export const KEEP_DAYS = 7;
const API_URL = "https://api.holfuy.com/live/";
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// The request for the latest measurement of several stations: JSON, °C, m/s, times in UTC and the station's position
// (loc), so the stations can be shown on the maps. The key is in the address,
// so the address is never logged.
export function holfuyUrl(ids, key, base = API_URL) {
  const url = new URL(base);
  url.searchParams.set("s", ids.join(","));
  url.searchParams.set("pw", key);
  url.searchParams.set("m", "JSON");
  url.searchParams.set("tu", "C");
  url.searchParams.set("su", "m/s");
  url.searchParams.set("utc", "");
  url.searchParams.set("loc", "");
  return url;
}

// Holfuy's names for what has its own field, or is not a measurement (units, the station's position and name).
const KNOWN = new Set(["stationId", "stationName", "dateTime", "location.latitude", "location.longitude", "location.altitude",
  "wind.direction", "wind.speed", "wind.gust", "wind.min", "wind.unit", "temperature", "humidity", "pressure", "rain"]);

// Holfuy answers with an object for one station and { measurements: [...] } for several. Each measurement becomes
// { source, station, name, lat, lon, altitude, time } and the fields in measurements.js (wind, temperature, humidity, pressure,
// rain), with null for what the station does not measure, and other numbers in extra. Measurements without a station
// number or a valid time are skipped.
export function parseHolfuy(data) {
  const list = Array.isArray(data?.measurements) ? data.measurements : data && typeof data === "object" ? [data] : [];
  return list.flatMap((m) => {
    const station = num(m?.stationId);
    const time = typeof m?.dateTime === "string" ? Date.parse(m.dateTime.trim().replace(" ", "T") + "Z") : NaN;
    if (station === null || !Number.isFinite(time)) return [];
    const loc = m.location ?? {};
    const wind = m.wind ?? {};
    return [{
      source: KEY,
      station,
      name: typeof m.stationName === "string" ? m.stationName.slice(0, 80) : null,
      lat: num(loc.latitude), lon: num(loc.longitude), altitude: num(loc.altitude),
      time: new Date(time).toISOString(),
      dir: num(wind.direction), speed: num(wind.speed), gust: num(wind.gust), min: num(wind.min),
      temperature: num(m.temperature), humidity: num(m.humidity), pressure: num(m.pressure), rain: num(m.rain),
      extra: extraValues(m, KNOWN),
    }];
  });
}

// The dataset: one item per station in stations.js, in that order, with the latest measurement and the history as rows
// [time, dir, speed, gust, min, temperature]. meta: name and position per station from Holfuy's answers. A station without measurements
// has time null.
export function buildStations(stations, rows, meta, now = Date.now()) {
  const items = stations.map((s) => {
    const own = rows.filter((r) => String(r.station) === String(s.id)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const last = own[own.length - 1];
    const m = meta[s.id] ?? {};
    return {
      id: s.id,
      name: s.name ?? m.name ?? String(s.id),
      model: s.model ?? null,
      site: s.site ?? null,
      lat: m.lat ?? null, lon: m.lon ?? null, altitude: m.altitude ?? null,
      time: last?.time ?? null,
      wind: last ? { dir: last.dir, speed: last.speed, gust: last.gust, min: last.min } : null,
      temperature: last?.temperature ?? null,
      humidity: last?.humidity ?? null,
      pressure: last?.pressure ?? null,
      rain: last?.rain ?? null,
      extra: last?.extra ?? null,
      history: own.map((r) => [r.time, r.dir, r.speed, r.gust, r.min, r.temperature]),
    };
  });
  return { dataset: DATASET, source: SOURCE, fetched: new Date(now).toISOString(), items };
}

// One run. Does nothing without stations or without the key. A failed request leaves the previous dataset as it is.
export async function run(store, env, stations, now = Date.now()) {
  if (!stations.length || !env.HOLFUY_KEY) return;
  const response = await fetch(holfuyUrl(stations.map((s) => s.id), env.HOLFUY_KEY, env.HOLFUY_URL || API_URL), {
    headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Holfuy svarte ${response.status}`);
  const measurements = parseHolfuy(await response.json());
  const wanted = new Set(stations.map((s) => s.id));
  const own = measurements.filter((m) => wanted.has(m.station));
  await store.addMeasurements(own);
  const meta = (await store.getState("holfuy-meta")) ?? {};
  for (const m of own) meta[m.station] = { name: m.name, lat: m.lat, lon: m.lon, altitude: m.altitude };
  await store.putState("holfuy-meta", meta);
  await archive(store, env, stations, now);
  const rows = await store.measurementsSince(KEY, new Date(now - HISTORY_HOURS * 3600000).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildStations(stations, rows, meta, now)));
}

// Writes the finished days not yet in the archive (at most two per run), then deletes from the store what is both in the
// archive and older than KEEP_DAYS. Without R2 (env.ARCHIVE) nothing is written or deleted.
async function archive(store, env, stations, now) {
  if (!env.ARCHIVE) return;
  const state = (await store.getState("holfuy-archive")) ?? { through: null };
  const days = daysToArchive(await store.oldestMeasurement(KEY), state.through, now);
  if (days.length) {
    const meta = (await store.getState("holfuy-meta")) ?? {};
    const list = stations.map((s) => ({ source: KEY, id: s.id, name: s.name ?? meta[s.id]?.name ?? null, model: s.model ?? null, site: s.site ?? null, lat: meta[s.id]?.lat ?? null, lon: meta[s.id]?.lon ?? null, altitude: meta[s.id]?.altitude ?? null }));
    await env.ARCHIVE.put(`${KEY}/stations.csv`, stationsCsv(list), { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
  }
  for (const day of days) {
    const rows = await store.measurementsBetween(KEY, day + "T00:00:00.000Z", day + "T23:59:59.999Z");
    for (const s of stations) {
      const own = rows.filter((r) => String(r.station) === String(s.id));
      if (own.length) {
        await env.ARCHIVE.put(dayPath(KEY, s.id, day), measurementsCsv(own), { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
      }
    }
    state.through = day;
    await store.putState("holfuy-archive", state);
  }
  const before = pruneBefore(now, KEEP_DAYS, state.through);
  if (before) await store.prune(KEY, before);
}
