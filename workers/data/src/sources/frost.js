// Målt vær fra METs egne værstasjoner (Frost, frost.met.no), i samme stasjonsdatasett som Holfuy. Stasjonene innenfor
// området til flystedene finner MET selv én gang i døgnet, og de siste observasjonene hentes hvert tiende minutt,
// lagres og arkiveres som Holfuys. Klient-ID-en er hemmeligheten FROST_CLIENT_ID i Cloudflare (gratis,
// frost.met.no/auth/requestCredentials.html). Uten den hoppes MET over. Testet i test/data-worker.test.js.

import { archiveSource } from "../archive.js";
import { num } from "../measurements.js";

export const DATASET = "stations-met";
export const SOURCE = "MET Norge";
// Vilkårene til MET krever kreditering. Dataene fra Frost er CC BY (frost.met.no/termsofuse.html).
export const LICENSE = "CC BY 4.0, MET Norge";
// Nøkkelen til kilden i lageret og arkivet (measurements.js).
export const KEY = "met";
export const HISTORY_HOURS = 6;
export const KEEP_DAYS = 7;
// Stasjonene i området slås opp på nytt etter så lang tid, så nye og nedlagte stasjoner kommer med.
export const DISCOVER_HOURS = 24;
// Området til flystedene, utvidet med så mye (grader, mer øst–vest, der en grad er kortere) for oppslaget. Av
// stasjonene som finnes, beholdes de innenfor NEAR_KM km fra et startsted: været over hele regionen, fra Lofoten til
// Bardu, uten de fjerne hjørnene av boksen. Kartet tynner dem ut når det er zoomet ut (src/assets/js/stations.js), så
// alle kan beholdes.
export const MARGIN = 0.5;
export const NEAR_KM = 50;
const API = "https://frost.met.no";
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// Det som spørres etter, og hvor det havner. Frost gir navnet på elementet. Kastet er det høyeste de siste 10
// minuttene, nedbøren summen den siste timen.
export const ELEMENTS = {
  wind_from_direction: "dir",
  wind_speed: "speed",
  "max(wind_speed_of_gust PT10M)": "gust",
  air_temperature: "temperature",
  relative_humidity: "humidity",
  air_pressure_at_sea_level: "pressure",
  "sum(precipitation_amount PT1H)": "rain",
};

// Området til flystedene som en lukket polygon i formatet til Frost, "POLYGON((lon lat, …))".
export function areaPolygon(sites, margin = MARGIN) {
  const lats = sites.map((s) => s.lat), lons = sites.map((s) => s.lon);
  const s = Math.min(...lats) - margin, n = Math.max(...lats) + margin, w = Math.min(...lons) - 2 * margin, e = Math.max(...lons) + 2 * margin;
  const p = (lon, lat) => `${lon.toFixed(3)} ${lat.toFixed(3)}`;
  return `POLYGON((${p(w, s)}, ${p(e, s)}, ${p(e, n)}, ${p(w, n)}, ${p(w, s)}))`;
}

// Stasjonene innenfor `km` km fra et startsted.
export function nearSites(stations, sites, km = NEAR_KM) {
  const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));
  return stations.filter((s) => sites.some((site) => dist(s, site) <= km));
}

// «EVENES LUFTHAVN» → «Evenes lufthavn»: navnene fra MET er med store bokstaver.
export function stationName(name) {
  const s = String(name ?? "").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

// Kildene fra Frost som stasjoner: { id, name, lat, lon, altitude }, bare landstasjoner med posisjon.
export function parseSources(data) {
  return (Array.isArray(data?.data) ? data.data : []).flatMap((s) => {
    const c = s?.geometry?.coordinates;
    if (typeof s?.id !== "string" || !/^SN\d+$/.test(s.id) || !Array.isArray(c) || num(c[0]) === null || num(c[1]) === null) return [];
    return [{ id: s.id, name: stationName(s.name), lat: num(c[1]), lon: num(c[0]), altitude: num(s.masl) }];
  });
}

// Observasjonene fra Frost som målinger, én per stasjon og tid, med feltene i measurements.js. Frost gir hvert element
// med sin egen tid ("latest" kan være ulik per element). Den siste tiden med vindfart brukes, og de andre elementene
// fra den samme tiden. Stasjoner uten vindfart utelates.
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

// Datasettet: ett element per stasjon som har målt vind de siste timene, sortert etter navn, i samme form som Holfuys
// (sources/holfuy.js). sites: { SN…: site id } for en stasjon som hører til et flysted (stations.js).
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
  // 404 og 412: Frost har ingen data for forespørselen (ingen stasjon har disse elementene nå). Det er ikke en feil.
  if (response.status === 404 || response.status === 412) return { data: [] };
  if (!response.ok) throw new Error(`Frost svarte ${response.status}`);
  return response.json();
}

// Én kjøring: slår opp stasjonene i området når DISCOVER_HOURS timer har gått, henter de siste observasjonene (i
// grupper, så adressen holdes kort), lagrer og arkiverer dem, og lagrer datasettet. Uten klient-ID-en skjer ingenting.
// exclude: MET-numre som aldri skal vises (stations.js MET_EXCLUDE). Når området eller listen endres, slås stasjonene
// opp på nytt med én gang i stedet for etter DISCOVER_HOURS timer.
export async function run(store, env, sites, siteOf = {}, now = Date.now(), exclude = []) {
  if (!env.FROST_CLIENT_ID || !sites.length) return;
  const area = `${areaPolygon(sites)} ${NEAR_KM} ${exclude.join(",")}`;
  let state = (await store.getState("met-stations")) ?? { found: null, stations: [] };
  if (!state.found || state.area !== area || now - Date.parse(state.found) > DISCOVER_HOURS * 3600000) {
    // Bare feltene parseSources leser, så svaret for hele regionen er lite å lese.
    const data = await frost(env, "/sources/v0.jsonld", { types: "SensorSystem", geometry: areaPolygon(sites), validtime: "now", fields: "id,name,geometry,masl" });
    state = { found: new Date(now).toISOString(), area, stations: nearSites(parseSources(data), sites).filter((s) => !exclude.includes(s.id)) };
  }
  const measurements = [];
  for (let i = 0; i < state.stations.length; i += 25) {
    const ids = state.stations.slice(i, i + 25).map((s) => s.id).join(",");
    const data = await frost(env, "/observations/v0.jsonld", { sources: ids, referencetime: "latest", maxage: "PT2H", elements: Object.keys(ELEMENTS).join(",") });
    measurements.push(...parseObservations(data));
  }
  // Bare stasjonene som måler vind, beholdes, så de neste kjøringene spør etter færre.
  const active = new Set(measurements.map((m) => m.station));
  if (measurements.length) state.stations = state.stations.filter((s) => active.has(s.id));
  await store.putState("met-stations", state);
  await store.addMeasurements(measurements);
  // De ferske målingene publiseres først. Arkivet kommer etterpå, og et arkiv som feiler (R2 nede), gir bare en
  // logglinje.
  const rows = await store.measurementsSince(KEY, new Date(now - HISTORY_HOURS * 3600000).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildStations(state.stations, rows, siteOf, now)));
  try {
    await archiveSource(store, env, KEY, state.stations.map((s) => ({ source: KEY, id: s.id, name: s.name, model: null, site: siteOf[s.id] ?? null, lat: s.lat, lon: s.lon, altitude: s.altitude })), KEEP_DAYS, now);
  } catch (err) {
    console.warn(`Frost: arkivet: ${err.message}`);
  }
}
