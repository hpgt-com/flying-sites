// The MET forecast for each launch (dataset «forecast»), in the same format as the build's (lib/weather/met.js), so the
// pages can use either.
//
// The free plan gives each run 10 ms of CPU time, and reading MET's answer for all launches takes about 15 ms. So each run
// (every 5 minutes) fetches only the PER_RUN launches that were fetched longest ago, and the whole forecast is renewed
// about every half hour. The state keeps each launch's rows with when they were fetched. Tested in
// test/data-worker.test.js.
//
// Each fetch also stores the forecast for the hour going on then (store.js forecast_hours), the latest fetch during the
// hour winning, so it is known afterwards what the forecast said for each hour. The dataset carries the last PAST_HOURS of
// them as past, for «Målt mot varslet» on the weather page; they are kept for KEEP_DAYS.

import { fetchSite, mergeSites } from "../../../../lib/weather/met.js";

export const DATASET = "forecast";
export const LICENSE = "CC BY 4.0, MET Norge";
// MET's product the forecast comes from (api.met.no). MET does not say which weather model behind it in the answer.
export const PRODUCT = "Locationforecast 2.0 (complete)";
export const PER_RUN = 6;
// Launches fetched longer ago than this are left out of the forecast (the site turns the assessment off after 6 hours).
export const MAX_AGE_HOURS = 6;
export const PAST_HOURS = 6;
export const KEEP_DAYS = 30;
const HOUR = 3600000;

// The row of a launch's forecast for the hour going on at `now` ([time, dir, speed, gust, rain]), or null.
export function hourNow(rows, now) {
  return rows.find((r) => { const t = Date.parse(r[0]); return t <= now && now < t + HOUR; }) ?? null;
}

// The stored hours as { site: [[time, dir, speed, gust], ...] }, oldest first, for the dataset's past.
export function groupPast(hours) {
  const past = {};
  for (const h of [...hours].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    (past[h.site] ??= []).push([h.time, h.dir, h.speed, h.gust]);
  }
  return past;
}

// The launches to fetch now: those missing from the state first, then those tried longest ago. A failed try counts
// (tried), so launches that keep failing go to the back of the queue instead of taking every run's places.
export function pickSites(sites, state, count = PER_RUN) {
  const age = (id) => Math.max(Date.parse(state.sites[id]?.fetched) || 0, Date.parse(state.sites[id]?.tried) || 0);
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

// One run: fetches the launches fetched longest ago, one after another (MET gets at most one request at a time from
// us), and stores the state and the forecast. A launch that fails keeps its previous rows.
export async function run(store, sites, now = Date.now()) {
  const state = keepSites(await store.getState(DATASET), sites);
  const hours = [];
  for (const site of pickSites(sites, state)) {
    try {
      const { rows, updated } = await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude);
      state.sites[site.id] = { fetched: new Date(now).toISOString(), updated, rows };
      const h = hourNow(rows, now);
      if (h) hours.push({ site: site.id, time: h[0], dir: h[1], speed: h[2], gust: h[3], rain: h[4], fetched: new Date(now).toISOString() });
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
