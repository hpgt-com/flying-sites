// METs varsel for hvert startsted (datasettet «forecast»), i samme format som i bygget (lib/weather/met.js), så sidene
// kan bruke begge.
//
// Gratisplanen gir hver kjøring 10 ms CPU-tid, og å lese svaret fra MET for alle startstedene tar omtrent 15 ms. Derfor
// henter hver kjøring (hvert femte minutt) bare de PER_RUN startstedene som ble hentet for lengst siden, og hele
// varselet fornyes omtrent hver halvtime. Tilstanden har radene for hvert startsted med når de ble hentet. Testet i
// test/data-worker.test.js.
//
// Hver henting lagrer også varselet for timen som pågår (store.js forecast_hours), der den siste hentingen i timen
// vinner. Slik vet vi etterpå hva varselet sa for hver time. Med følger timens temperatur og trykk (met.js metExtras,
// beholdt per startsted som extras), som verifiseringen sammenligner med stasjonenes egne. Datasettet har de siste
// PAST_HOURS timene av dem som past, for «Målt mot varslet» på værsiden. De beholdes i KEEP_DAYS dager.

import { fetchSite, mergeSites } from "../../../../lib/weather/met.js";

export const DATASET = "forecast";
export const LICENSE = "CC BY 4.0, MET Norge";
// Produktet hos MET som varselet kommer fra (api.met.no). MET sier ikke i svaret hvilken værmodell som ligger bak.
export const PRODUCT = "Locationforecast 2.0 (complete)";
export const PER_RUN = 6;
// Startsteder hentet for lengre tid siden enn dette, utelates fra varselet (siden slår av vurderingen etter 6 timer).
export const MAX_AGE_HOURS = 6;
export const PAST_HOURS = 6;
export const KEEP_DAYS = 30;
const HOUR = 3600000;

// Raden i varselet for et startsted for timen som pågår ved `now` ([time, dir, speed, gust, rain]), eller null.
export function hourNow(rows, now) {
  return rows.find((r) => { const t = Date.parse(r[0]); return t <= now && now < t + HOUR; }) ?? null;
}

// De lagrede timene som { site: [[time, dir, speed, gust], ...] }, eldste først, for past i datasettet.
export function groupPast(hours) {
  const past = {};
  for (const h of [...hours].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    (past[h.site] ??= []).push([h.time, h.dir, h.speed, h.gust]);
  }
  return past;
}

// Startstedene som skal hentes nå: de som mangler i tilstanden først, så de som ble forsøkt for lengst siden. Et
// mislykket forsøk teller (tried), så startsteder som fortsetter å feile, havner bakerst i køen i stedet for å ta
// plassene i hver kjøring.
export function pickSites(sites, state, count = PER_RUN) {
  const age = (id) => Math.max(Date.parse(state.sites[id]?.fetched) || 0, Date.parse(state.sites[id]?.tried) || 0);
  return [...sites].sort((a, b) => age(a.id) - age(b.id)).slice(0, count);
}

// Tilstanden med bare startstedene som fortsatt finnes (et fjernet sted forsvinner ved neste kjøring).
export function keepSites(state, sites) {
  const ids = new Set(sites.map((s) => s.id));
  return { sites: Object.fromEntries(Object.entries(state?.sites ?? {}).filter(([id]) => ids.has(id))) };
}

// Varselet fra startstedene hentet de siste MAX_AGE_HOURS timene. fetched er hentetiden til det eldste startstedet, så
// alderssjekken på siden aldri regner et startsted som nyere enn det er. Timene følger startstedet der radene begynner
// senest, og de andre plasseres etter tid. null når det er tomt.
export function buildForecast(state, now = Date.now(), past = null) {
  const fresh = Object.entries(state.sites)
    .filter(([, s]) => now - Date.parse(s.fetched) < MAX_AGE_HOURS * 3600000 && s.rows?.length)
    .sort(([, a], [, b]) => Date.parse(b.rows[0][0]) - Date.parse(a.rows[0][0]));
  if (!fresh.length) return null;
  const rows = Object.fromEntries(fresh.map(([id, s]) => [id, s.rows]));
  const updated = Object.fromEntries(fresh.map(([id, s]) => [id, s.updated]));
  const oldest = Math.min(...fresh.map(([, s]) => Date.parse(s.fetched)));
  const forecast = { dataset: DATASET, license: LICENSE, product: PRODUCT, ...mergeSites(rows, new Date(oldest), updated) };
  if (past && Object.keys(past).length) forecast.past = past;
  return forecast;
}

// Én kjøring: henter startstedene som ble hentet for lengst siden, ett etter ett (MET får høyst én forespørsel om
// gangen fra oss), og lagrer tilstanden og varselet. Et startsted som feiler, beholder de forrige radene. Expires og
// Last-Modified fra MET beholdes per startsted (lib/weather/met.js fetchSite). Det spørres ikke etter et startsted på
// nytt før Expires, og et uendret varsel kommer tilbake som 304. Begge regnes som hentet nå, siden MET har sagt at
// radene er gjeldende.
export async function run(store, sites, now = Date.now()) {
  const state = keepSites(await store.getState(DATASET), sites);
  const hours = [];
  for (const site of pickSites(sites, state)) {
    try {
      const prev = state.sites[site.id] ?? {};
      const r = await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude, { expires: prev.expires, lastModified: prev.rows ? prev.lastModified : null, now });
      const rows = r.notModified ? prev.rows : r.rows;
      const extras = (r.notModified ? prev.extras : r.extras) ?? [];
      state.sites[site.id] = { fetched: new Date(now).toISOString(), updated: r.notModified ? prev.updated : r.updated, rows, extras, expires: r.expires ?? null, lastModified: r.lastModified ?? null };
      const h = hourNow(rows, now);
      const x = h && extras.find((e) => e[0] === h[0]);
      if (h) hours.push({ site: site.id, time: h[0], dir: h[1], speed: h[2], gust: h[3], rain: h[4], temp: x?.[1] ?? null, pressure: x?.[2] ?? null, fetched: new Date(now).toISOString() });
    } catch (err) {
      state.sites[site.id] = { ...state.sites[site.id], tried: new Date(now).toISOString() };
      console.warn(`MET: ${site.id}: ${err.message}`);
    }
  }
  await store.putState(DATASET, state);
  await store.putForecastHours(hours);
  await store.pruneForecastHours(new Date(now - KEEP_DAYS * 24 * HOUR).toISOString());
  const past = groupPast(await store.forecastHoursSince(new Date(now - PAST_HOURS * HOUR).toISOString()));
  const forecast = buildForecast(state, now, past);
  if (forecast) await store.putSnapshot(DATASET, JSON.stringify(forecast));
}
