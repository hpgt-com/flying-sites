// The MET forecast for each launch (dataset «forecast»), in the same format as the build's (lib/weather/met.js), so the
// pages can use either.
//
// The free plan gives each run 10 ms of CPU time, and reading MET's answer for all launches takes about 15 ms. So each run
// (every 5 minutes) fetches only the PER_RUN launches that were fetched longest ago, and the whole forecast is renewed
// about every half hour. The state keeps each launch's rows with when they were fetched. Tested in
// test/data-worker.test.js.

import { fetchSite, mergeSites } from "../../../../lib/weather/met.js";

export const DATASET = "forecast";
export const LICENSE = "CC BY 4.0, MET Norge";
// MET's product the forecast comes from (api.met.no). MET does not say which weather model behind it in the answer.
export const PRODUCT = "Locationforecast 2.0 (complete)";
export const PER_RUN = 6;
// Launches fetched longer ago than this are left out of the forecast (the site turns the assessment off after 6 hours).
export const MAX_AGE_HOURS = 6;

// The launches to fetch now: those missing from the state first, then those fetched longest ago.
export function pickSites(sites, state, count = PER_RUN) {
  const age = (id) => Date.parse(state.sites[id]?.fetched) || 0;
  return [...sites].sort((a, b) => age(a.id) - age(b.id)).slice(0, count);
}

// The state with only the launches that still exist (a removed site disappears at the next run).
export function keepSites(state, sites) {
  const ids = new Set(sites.map((s) => s.id));
  return { sites: Object.fromEntries(Object.entries(state?.sites ?? {}).filter(([id]) => ids.has(id))) };
}

// The forecast from the launches fetched in the last MAX_AGE_HOURS. fetched is the oldest launch's fetch time, so the
// page's age check never counts a launch as newer than it is. The hours follow the launch whose rows start latest, and
// the others are placed by time. null when empty.
export function buildForecast(state, now = Date.now()) {
  const fresh = Object.entries(state.sites)
    .filter(([, s]) => now - Date.parse(s.fetched) < MAX_AGE_HOURS * 3600000 && s.rows?.length)
    .sort(([, a], [, b]) => Date.parse(b.rows[0][0]) - Date.parse(a.rows[0][0]));
  if (!fresh.length) return null;
  const rows = Object.fromEntries(fresh.map(([id, s]) => [id, s.rows]));
  const updated = Object.fromEntries(fresh.map(([id, s]) => [id, s.updated]));
  const oldest = Math.min(...fresh.map(([, s]) => Date.parse(s.fetched)));
  return { dataset: DATASET, license: LICENSE, product: PRODUCT, ...mergeSites(rows, new Date(oldest), updated) };
}

// One run: fetches the launches fetched longest ago, one after another (MET gets at most one request at a time from
// us), and stores the state and the forecast. A launch that fails keeps its previous rows.
export async function run(store, sites, now = Date.now()) {
  const state = keepSites(await store.getState(DATASET), sites);
  for (const site of pickSites(sites, state)) {
    try {
      const { rows, updated } = await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude);
      state.sites[site.id] = { fetched: new Date(now).toISOString(), updated, rows };
    } catch (err) {
      console.warn(`MET: ${site.id}: ${err.message}`);
    }
  }
  await store.putState(DATASET, state);
  const forecast = buildForecast(state, now);
  if (forecast) await store.putSnapshot(DATASET, JSON.stringify(forecast));
}
