// Measured wind from Holfuy's weather stations (dataset «stations»). Every run (every minute) fetches the latest
// measurement for all stations in stations.js in one request, stores it, and builds the dataset with the last
// HISTORY_HOURS of measurements per station. The API key is the secret HOLFUY_KEY in Cloudflare. Tested in
// test/data-worker.test.js.

export const DATASET = "stations";
export const SOURCE = "Holfuy";
export const LICENSE = "Holfuy, med tillatelse";
export const HISTORY_HOURS = 6;
// Measurements older than this are deleted, so the store stays small.
export const KEEP_DAYS = 7;
const API_URL = "https://api.holfuy.com/live/";
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// The request for the latest measurement of several stations: JSON, °C, m/s and times in UTC. The key is in the address,
// so the address is never logged.
export function holfuyUrl(ids, key, base = API_URL) {
  const url = new URL(base);
  url.searchParams.set("s", ids.join(","));
  url.searchParams.set("pw", key);
  url.searchParams.set("m", "JSON");
  url.searchParams.set("tu", "C");
  url.searchParams.set("su", "m/s");
  url.searchParams.set("utc", "");
  return url;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

// Holfuy answers with an object for one station and { measurements: [...] } for several. Each measurement becomes
// { station, name, lat, lon, altitude, time, dir, speed, gust, min, temperature }, with null for what is missing.
// Measurements without a station number or a valid time are skipped.
export function parseHolfuy(data) {
  const list = Array.isArray(data?.measurements) ? data.measurements : data && typeof data === "object" ? [data] : [];
  return list.flatMap((m) => {
    const station = num(m?.stationId);
    const time = typeof m?.dateTime === "string" ? Date.parse(m.dateTime.trim().replace(" ", "T") + "Z") : NaN;
    if (station === null || !Number.isFinite(time)) return [];
    const loc = m.location ?? {};
    const wind = m.wind ?? {};
    return [{
      station,
      name: typeof m.stationName === "string" ? m.stationName.slice(0, 80) : null,
      lat: num(loc.latitude), lon: num(loc.longitude), altitude: num(loc.altitude),
      time: new Date(time).toISOString(),
      dir: num(wind.direction), speed: num(wind.speed), gust: num(wind.gust), min: num(wind.min),
      temperature: num(m.temperature),
    }];
  });
}

// The dataset: one item per station in stations.js, in that order, with the latest measurement and the history as rows
// [time, dir, speed, gust]. meta: name and position per station from Holfuy's answers. A station without measurements
// has time null.
export function buildStations(stations, rows, meta, now = Date.now()) {
  const items = stations.map((s) => {
    const own = rows.filter((r) => r.station === s.id).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const last = own[own.length - 1];
    const m = meta[s.id] ?? {};
    return {
      id: s.id,
      name: s.name ?? m.name ?? String(s.id),
      site: s.site ?? null,
      lat: m.lat ?? null, lon: m.lon ?? null, altitude: m.altitude ?? null,
      time: last?.time ?? null,
      wind: last ? { dir: last.dir, speed: last.speed, gust: last.gust, min: last.min } : null,
      temperature: last?.temperature ?? null,
      history: own.map((r) => [r.time, r.dir, r.speed, r.gust]),
    };
  });
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), items };
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
  await store.prune(new Date(now - KEEP_DAYS * 86400000).toISOString());
  const rows = await store.measurementsSince(new Date(now - HISTORY_HOURS * 3600000).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildStations(stations, rows, meta, now)));
}
