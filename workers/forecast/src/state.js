// The weather service's state and the forecast it serves, without Cloudflare or network, so it can be tested in Node
// (test/forecast-worker.test.js).
//
// The free plan gives each run 10 ms of CPU time, and reading MET's answer for all launches takes about 15 ms. So each run
// (every 5 minutes) fetches only the PER_RUN launches that were fetched longest ago, and the whole forecast is renewed
// about every half hour. The state keeps each launch's rows with when they were fetched.

import { mergeSites } from "../../../lib/weather/met.js";

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

// The forecast in the same format as the build's (lib/weather/met.js), from the launches fetched in the last
// MAX_AGE_HOURS. fetched is the oldest launch's fetch time, so the page's age check never counts a launch as newer
// than it is. The hours follow the launch whose rows start latest, and the others are placed by time. null when empty.
export function buildForecast(state, now = Date.now()) {
  const fresh = Object.entries(state.sites)
    .filter(([, s]) => now - Date.parse(s.fetched) < MAX_AGE_HOURS * 3600000 && s.rows?.length)
    .sort(([, a], [, b]) => Date.parse(b.rows[0][0]) - Date.parse(a.rows[0][0]));
  if (!fresh.length) return null;
  const rows = Object.fromEntries(fresh.map(([id, s]) => [id, s.rows]));
  const updated = Object.fromEntries(fresh.map(([id, s]) => [id, s.updated]));
  const oldest = Math.min(...fresh.map(([, s]) => Date.parse(s.fetched)));
  return mergeSites(rows, new Date(oldest), updated);
}
