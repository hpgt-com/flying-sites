// Flying activity per site (dataset «flights»): how many paragliders are seen in the air from each flying site, from the
// Open Glider Network's live data (live.js fetchLive), every few minutes on the schedule. A pilot seen flying counts once
// a day, for the site nearest where they were first seen that day (where they took off, as near as the data shows),
// if one is within RADIUS_KM; a pilot first seen far from every site (passing through) counts for none. Per site and
// day only sums are kept (store.js flight_days): pilots, minutes in the air, the farthest from launch and the highest.
// To count a pilot once, the day's pilots are kept by a key made from their device id and a random salt for the day
// (state «flights-today»); at the first run of a new day the old keys and the salt are thrown away, so no device id
// or track is ever kept. OGN's rules (glidernet.org/ogn-data-usage) are followed as in live.js. Only pilots whose app
// or vario sends to OGN are counted (pgpilot, FANET varios, FLARM). Tested in test/data-worker.test.js.

import { fetchLive, SOURCE, LICENSE } from "../live.js";

export const DATASET = "flights";
export const RADIUS_KM = 5;
// Flying: moving at MIN_SPEED m/s over the ground, or climbing or sinking at MIN_CLIMB m/s (soaring against the wind
// can be slow over the ground). A pilot standing at launch with the app on is neither.
export const MIN_SPEED = 3;
export const MIN_CLIMB = 0.5;
// Positions older than this are left out, so a pilot who landed is not counted on as flying.
export const FRESH_SECONDS = 180;
const STATE = "flights-today";
const rad = Math.PI / 180;
const round1 = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// The date in Norway (YYYY-MM-DD), so a day is a Norwegian day.
const DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" });
export function osloDay(ms) { return DAY.format(new Date(ms)); }

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The site nearest the position, within RADIUS_KM, or null.
export function nearestSite(sites, pos) {
  let best = null, km = RADIUS_KM;
  for (const s of sites) { const d = distanceKm(s, pos); if (d <= km) { best = s; km = d; } }
  return best;
}

export function isFlying(item) {
  return (isNum(item.speed) && item.speed >= MIN_SPEED) || (isNum(item.climb) && Math.abs(item.climb) >= MIN_CLIMB);
}

// The key a pilot is counted by today: the first 16 hex digits of SHA-256 of the day's salt and the device id.
export async function pilotKey(salt, id) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Adds what is seen now (items with key, from parseLive) to the day ({ pilots: { key: { site, last, minutes, dist, alt } } }):
// each new position of a flying pilot counts `minutes` (the time between runs). Returns whether anything changed.
export function observe(day, items, sites, now, minutes) {
  let changed = false;
  for (const item of items) {
    const t = Date.parse(item.time);
    if (!isFlying(item) || now - t > FRESH_SECONDS * 1000) continue;
    let p = day.pilots[item.key];
    if (!p) p = day.pilots[item.key] = { site: nearestSite(sites, item)?.id ?? null, last: 0, minutes: 0, dist: 0, alt: null };
    if (t <= p.last) continue;
    p.last = t;
    p.minutes += minutes;
    const site = p.site && sites.find((s) => s.id === p.site);
    if (site) {
      p.dist = Math.max(p.dist, round1(distanceKm(site, item)));
      if (isNum(item.alt)) p.alt = Math.max(p.alt ?? 0, Math.round(item.alt));
    }
    changed = true;
  }
  return changed;
}

// The day summed up per site: [{ day, site, pilots, minutes, max_dist, max_alt }].
export function dayRows(day) {
  const sites = {};
  for (const p of Object.values(day.pilots)) {
    if (!p.site) continue;
    const s = (sites[p.site] ??= { day: day.day, site: p.site, pilots: 0, minutes: 0, max_dist: 0, max_alt: null });
    s.pilots++;
    s.minutes += p.minutes;
    s.max_dist = Math.max(s.max_dist, p.dist);
    if (p.alt !== null) s.max_alt = Math.max(s.max_alt ?? 0, p.alt);
  }
  return Object.values(sites);
}

// The dataset from all the stored days: per site the days with flying, the pilots (a pilot counted once a day), the
// minutes in the air, the farthest from launch and the highest, the last day, and the same per month (YYYY-MM).
export function buildFlights(rows, since, now = Date.now()) {
  const sites = {};
  for (const r of rows) {
    const s = (sites[r.site] ??= { days: 0, pilots: 0, minutes: 0, maxDist: 0, maxAlt: null, last: null, months: {} });
    const m = (s.months[r.day.slice(0, 7)] ??= { days: 0, pilots: 0, minutes: 0 });
    for (const x of [s, m]) { x.days++; x.pilots += r.pilots; x.minutes += r.minutes; }
    s.maxDist = Math.max(s.maxDist, r.max_dist ?? 0);
    if (isNum(r.max_alt)) s.maxAlt = Math.max(s.maxAlt ?? 0, r.max_alt);
    if (!s.last || r.day > s.last) s.last = r.day;
  }
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), since, sites };
}

// One run: what OGN hears now is added to the day; when something changed (or a new day began), the day's sums and the
// dataset are stored. minutes: the time between runs (schedule.js).
export async function run(store, sites, now = Date.now(), minutes = 2) {
  const items = await fetchLive(sites, now);
  const today = osloDay(now);
  let day = await store.getState(STATE);
  let changed = false;
  if (!day || day.day !== today) {
    day = { day: today, salt: crypto.randomUUID(), pilots: {} };
    changed = true;
  }
  const keyed = await Promise.all(items.map(async (i) => ({ ...i, key: await pilotKey(day.salt, i.id) })));
  if (observe(day, keyed, sites, now, minutes)) {
    await store.putFlightDays(dayRows(day));
    changed = true;
  }
  let since = await store.getState("flights-since");
  if (!since) { since = today; await store.putState("flights-since", since); changed = true; }
  if (!changed) return;
  await store.putState(STATE, day);
  await store.putSnapshot(DATASET, JSON.stringify(buildFlights(await store.flightDays(), since, now)));
}
