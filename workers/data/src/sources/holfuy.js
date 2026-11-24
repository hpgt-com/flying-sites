// Målt vind fra Holfuys værstasjoner (datasettet «stations»). Hver kjøring (hvert minutt) henter den siste målingen for
// alle stasjonene i stations.js i én forespørsel, lagrer den, og bygger datasettet med målingene de siste HISTORY_HOURS
// timene per stasjon. API-nøkkelen er hemmeligheten HOLFUY_KEY i Cloudflare. Testet i test/data-worker.test.js.
//
// Lageret beholder målinger i KEEP_DAYS dager. Eldre dager skrives til arkivet (archive.js, R2) når en dag er over, én
// CSV per stasjon per dag (holfuy/station=<id>/year=<year>/<date>.csv) og stasjonene i holfuy/stations.csv. Først
// etter det slettes de fra lageret.

import { archiveSource } from "../archive.js";
import { extraValues, num } from "../measurements.js";

export const DATASET = "stations";
export const SOURCE = "Holfuy";
// Nøkkelen til kilden i lageret og arkivet (measurements.js).
export const KEY = "holfuy";
export const HISTORY_HOURS = 6;
// Målinger eldre enn dette slettes fra lageret når de er i arkivet, så lageret holdes lite.
export const KEEP_DAYS = 7;
const API_URL = "https://api.holfuy.com/live/";
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// Forespørselen etter den siste målingen for flere stasjoner: JSON, °C, m/s, tider i UTC og stasjonens posisjon (loc),
// så stasjonene kan vises på kartene. Nøkkelen står i adressen, så adressen logges aldri.
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

// Holfuys navn for det som har sitt eget felt, eller ikke er en måling (enheter, stasjonens posisjon og navn).
const KNOWN = new Set(["stationId", "stationName", "dateTime", "location.latitude", "location.longitude", "location.altitude",
  "wind.direction", "wind.speed", "wind.gust", "wind.min", "wind.unit", "temperature", "humidity", "pressure", "rain"]);

// Holfuy svarer med et objekt for én stasjon og { measurements: [...] } for flere. Hver måling blir { source, station,
// name, lat, lon, altitude, time } og feltene i measurements.js (vind, temperatur, fuktighet, trykk, nedbør), med null
// for det stasjonen ikke måler, og andre tall i extra. Målinger uten stasjonsnummer eller gyldig tid hoppes over.
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

// Datasettet: ett element per stasjon i stations.js, i den rekkefølgen, med den siste målingen og historikken som rader
// [time, dir, speed, gust, min, temperature]. meta: navn og posisjon per stasjon fra svarene fra Holfuy. En stasjon
// uten målinger har time null.
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
      ...(s.near ? { near: s.near } : {}),
      source: SOURCE,
      url: `https://holfuy.com/en/weather/${encodeURIComponent(String(s.id))}`,
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

// Én kjøring. Gjør ingenting uten stasjoner eller uten nøkkelen. En mislykket forespørsel lar det forrige datasettet
// være som det er.
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
  const before = JSON.stringify(meta);
  for (const m of own) meta[m.station] = { name: m.name, lat: m.lat, lon: m.lon, altitude: m.altitude };
  // Skrives bare når et navn eller en posisjon er endret, som er sjelden: en skriving hvert minutt teller mot dagens
  // rader.
  if (JSON.stringify(meta) !== before) await store.putState("holfuy-meta", meta);
  // De ferske målingene publiseres først. Arkivet kommer etterpå, og et arkiv som feiler (R2 nede), gir bare en
  // logglinje.
  const rows = await store.measurementsSince(KEY, new Date(now - HISTORY_HOURS * 3600000).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildStations(stations, rows, meta, now)));
  try {
    await archive(store, env, stations, now);
  } catch (err) {
    console.warn(`Holfuy: arkivet: ${err.message}`);
  }
}

// Arkivet (archive.js): de ferdige dagene per stasjon, og stasjonslisten med navn og posisjoner fra Holfuy.
async function archive(store, env, stations, now) {
  const meta = (await store.getState("holfuy-meta")) ?? {};
  const list = stations.map((s) => ({ source: KEY, id: s.id, name: s.name ?? meta[s.id]?.name ?? null, model: s.model ?? null, site: s.site ?? null, lat: meta[s.id]?.lat ?? null, lon: meta[s.id]?.lon ?? null, altitude: meta[s.id]?.altitude ?? null }));
  await archiveSource(store, env, KEY, list, KEEP_DAYS, now);
}
