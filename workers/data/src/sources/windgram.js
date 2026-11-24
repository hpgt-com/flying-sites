// Høydevind fra Open-Meteo for startstedene i WINDGRAM_SITES (datasettet «windgram»), i samme format som i bygget
// (lib/weather/open-meteo.js), så stedssiden kan bruke begge (src/assets/js/windgram.js bruker dette når det er nyere).
// Modellkjøringene hos Open-Meteo endres med noen timers mellomrom. Å lese svaret for et startsted tar noen ms av de
// 10 ms CPU en kjøring kan bruke. Derfor henter hver kjøring (hvert tiende minutt, schedule.js) de PER_RUN startstedene
// som ble hentet for lengst siden, og hvert startsted fornyes omtrent hver halvtime. Et startsted som feiler, beholder
// det forrige rutenettet. Testet i test/data-worker.test.js.

import { fetchSite, WINDGRAM_SITES } from "../../../../lib/weather/open-meteo.js";

export const DATASET = "windgram";
export const SOURCE = "Open-Meteo";
export const LICENSE = "CC BY 4.0, Open-Meteo";
// Et startsted hentet for lengre tid siden enn dette, utelates (rutenettet ville for det meste vært timer som er
// passert).
export const MAX_AGE_HOURS = 6;
export const PER_RUN = 2;

// Datasettet fra tilstanden ({ sites: { id: { fetched, grid } } }): startstedene hentet de siste MAX_AGE_HOURS timene.
// fetched er tiden til det eldste startstedet, så siden aldri regner et startsted som nyere enn det er. null når det er
// tomt.
export function buildWindgram(state, now = Date.now()) {
  const fresh = Object.entries(state?.sites ?? {}).filter(([, s]) => s?.grid && now - Date.parse(s.fetched) < MAX_AGE_HOURS * 3600000);
  if (!fresh.length) return null;
  const oldest = Math.min(...fresh.map(([, s]) => Date.parse(s.fetched)));
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(oldest).toISOString(), sites: Object.fromEntries(fresh.map(([id, s]) => [id, s.grid])) };
}

// Startstedene som skal hentes nå: de som mangler i tilstanden først, så de som ble forsøkt for lengst siden. Et
// mislykket forsøk teller (tried), så startsteder som fortsetter å feile, havner bakerst i køen i stedet for å ta
// plassene i hver kjøring.
export function pickSites(sites, state, count = PER_RUN) {
  const age = (id) => Math.max(Date.parse(state.sites[id]?.fetched) || 0, Date.parse(state.sites[id]?.tried) || 0);
  return [...sites].sort((a, b) => age(a.id) - age(b.id)).slice(0, count);
}

// Én kjøring: henter de PER_RUN startstedene i WINDGRAM_SITES som ble hentet for lengst siden (ett om gangen), og
// lagrer tilstanden og datasettet.
export async function run(store, sites, now = Date.now(), ids = WINDGRAM_SITES, count = PER_RUN) {
  const state = (await store.getState(DATASET)) ?? { sites: {} };
  state.sites = Object.fromEntries(Object.entries(state.sites ?? {}).filter(([id]) => ids.includes(id)));
  for (const site of pickSites(sites.filter((s) => ids.includes(s.id)), state, count)) {
    try {
      state.sites[site.id] = { fetched: new Date(now).toISOString(), grid: await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude ?? undefined, now) };
    } catch (err) {
      state.sites[site.id] = { ...state.sites[site.id], tried: new Date(now).toISOString() };
      console.warn(`Open-Meteo: ${site.id}: ${err.message}`);
    }
  }
  await store.putState(DATASET, state);
  const body = buildWindgram(state, now);
  if (body) await store.putSnapshot(DATASET, JSON.stringify(body));
}
