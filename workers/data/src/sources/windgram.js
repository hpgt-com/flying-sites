// Winds aloft from Open-Meteo for the launches in WINDGRAM_SITES (dataset «windgram»), in the same format as the build's
// (lib/weather/open-meteo.js), so the site page can use either (src/assets/js/windgram.js uses this one when newer).
// Open-Meteo's model runs change every few hours. Reading a launch's answer takes a few ms of the 10 ms of CPU a run may
// use, so each run (every 10 minutes, schedule.js) fetches the PER_RUN launches fetched longest ago, and each launch is
// renewed about every half hour. A launch that fails keeps its previous grid. Tested in test/data-worker.test.js.

import { fetchSite, WINDGRAM_SITES } from "../../../../lib/weather/open-meteo.js";

export const DATASET = "windgram";
export const SOURCE = "Open-Meteo";
export const LICENSE = "CC BY 4.0, Open-Meteo";
// A launch fetched longer ago than this is left out (the grid would mostly be past hours).
export const MAX_AGE_HOURS = 6;
export const PER_RUN = 2;

// The dataset from the state ({ sites: { id: { fetched, grid } } }): the launches fetched in the last MAX_AGE_HOURS.
// fetched is the oldest launch's, so the page never counts a launch as newer than it is. null when empty.
export function buildWindgram(state, now = Date.now()) {
  const fresh = Object.entries(state?.sites ?? {}).filter(([, s]) => s?.grid && now - Date.parse(s.fetched) < MAX_AGE_HOURS * 3600000);
  if (!fresh.length) return null;
  const oldest = Math.min(...fresh.map(([, s]) => Date.parse(s.fetched)));
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(oldest).toISOString(), sites: Object.fromEntries(fresh.map(([id, s]) => [id, s.grid])) };
}

// The launches to fetch now: those missing from the state first, then those fetched longest ago.
export function pickSites(sites, state, count = PER_RUN) {
  const age = (id) => Date.parse(state.sites[id]?.fetched) || 0;
  return [...sites].sort((a, b) => age(a.id) - age(b.id)).slice(0, count);
}

// One run: fetches the PER_RUN launches in WINDGRAM_SITES fetched longest ago (one at a time) and stores the state and
// the dataset.
export async function run(store, sites, now = Date.now(), ids = WINDGRAM_SITES, count = PER_RUN) {
  const state = (await store.getState(DATASET)) ?? { sites: {} };
  state.sites = Object.fromEntries(Object.entries(state.sites ?? {}).filter(([id]) => ids.includes(id)));
  for (const site of pickSites(sites.filter((s) => ids.includes(s.id)), state, count)) {
    try {
      state.sites[site.id] = { fetched: new Date(now).toISOString(), grid: await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude ?? undefined, now) };
    } catch (err) {
      console.warn(`Open-Meteo: ${site.id}: ${err.message}`);
    }
  }
  await store.putState(DATASET, state);
  const body = buildWindgram(state, now);
  if (body) await store.putSnapshot(DATASET, JSON.stringify(body));
}
