// Flying activity per site (dataset «flights»): how many flights paragliders make from each flying site, from the Open
// Glider Network's live data (live.js fetchLive), every few minutes on the schedule. A flight begins when a pilot is
// seen flying after having landed, so several flights a day by the same pilot count each (the lift on Sollifjellet, a
// new try after landing early). Landed: seen standing still LANDED_RUNS runs in a row, or not heard for GAP_MINUTES,
// unless the pilot was then still AIRBORNE_M or more over the ground (Kartverket's elevation model, groundAt): one who
// hovers in the wind, or flies out of the receivers' reach high up and comes back, is still on the same flight. Each
// flight counts for the site nearest where it was first seen (where it took off, as near as the data shows), if one is
// within RADIUS_KM; a flight first seen far from every site (passing through) counts for none. Per site and day only
// sums are kept (store.js flight_days): flights, pilots (each counted once a day), minutes in the air, the farthest from
// launch and the highest. To tell the day's pilots apart, they are kept by a key made from their device id and a random
// salt for the day (state «flights-today»), with only each pilot's last position in the air; at the first run of a new
// day the old keys, positions and the salt are thrown away, so no device id or track is ever kept. OGN's rules (glidernet.org/ogn-data-usage) are followed as in live.js. Only
// pilots whose app or vario sends to OGN are counted (pgpilot, FANET varios, FLARM). Tested in test/data-worker.test.js.

import { fetchLive, SOURCE, LICENSE } from "../live.js";

export const DATASET = "flights";
export const RADIUS_KM = 5;
// Flying: moving at MIN_SPEED m/s over the ground, or climbing or sinking at MIN_CLIMB m/s (soaring against the wind
// can be slow over the ground), but never faster than MAX_SPEED m/s (80 km/h): that is a car with the app on. A pilot
// standing at launch with the app on is neither.
export const MIN_SPEED = 3;
export const MIN_CLIMB = 0.5;
export const MAX_SPEED = 22;
// A flight counts only once the pilot has been seen AIRBORNE_START_M or more over the ground (Kartverket's elevation
// model, as for landing): a car, a bike or a walk with the app on moves, but stays on the ground. Until then the flight
// is pending, with its minutes, and is dropped if the pilot lands first. Without the ground's height (no answer from
// Kartverket, outside Norway, no height from the device) it counts after PENDING_RUNS runs, as before.
export const AIRBORNE_START_M = 50;
export const PENDING_RUNS = 3;
// Each flight is also kept on its own (store flights, dataset «flight-log»): the site, the start and the end, the sums,
// whether it was counted (dropped: never seen in the air, a car or a walk with the app on), and the positions OGN gave,
// one per run. No device, no key: a random id. Shown on /flyaktivitet/ and the site page, so a flight that looks wrong
// can be seen for what it was. Counted flights are kept TRACK_DAYS, dropped ones DROPPED_DAYS, the sums for ever.
export const LOG_DATASET = "flight-log";
export const TRACK_DAYS = 120;
export const DROPPED_DAYS = 14;
// Positions older than this are left out, so a pilot who landed is not counted on as flying.
export const FRESH_SECONDS = 180;
// Landed: seen on the ground this many runs in a row (one could be a moment of slow, level flight), or not heard for
// GAP_MINUTES (out of the receivers' reach, or the app turned off after landing), and in both cases less than
// AIRBORNE_M over the ground where last seen. A pilot not heard for more than MAX_GAP_MINUTES has landed whatever the
// height. Without the ground's height (Kartverket did not answer, or outside Norway) a stop or a gap means landed.
export const LANDED_RUNS = 2;
export const GAP_MINUTES = 15;
export const MAX_GAP_MINUTES = 120;
export const AIRBORNE_M = 100;
const ELEVATION_API = "https://ws.geonorge.no/hoydedata/v1/punkt";
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
  if (isNum(item.speed) && item.speed > MAX_SPEED) return false;
  return (isNum(item.speed) && item.speed >= MIN_SPEED) || (isNum(item.climb) && Math.abs(item.climb) >= MIN_CLIMB);
}

// The key a pilot is counted by today: the first 16 hex digits of SHA-256 of the day's salt and the device id.
export async function pilotKey(salt, id) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The pilots whose height over the ground is needed this run, as [key, lat, lon]: those who have stood still long
// enough to be landed (where they stand), those heard again after a gap (where they were last seen in the air), and
// those whose flight is pending (where they are now, under the key with ":now", since the gap may ask for the same pilot).
export function needsGround(day, items, now) {
  const out = [];
  for (const item of items) {
    const p = day.pilots[item.key], t = Date.parse(item.time);
    if (!p || !p.flying || t <= p.last || now - t > FRESH_SECONDS * 1000) continue;
    if (!isFlying(item)) { if (p.still + 1 >= LANDED_RUNS) out.push([item.key, item.lat, item.lon]); continue; }
    if (t - p.last > GAP_MINUTES * 60000 && t - p.last <= MAX_GAP_MINUTES * 60000 && p.pos) out.push([item.key, p.pos[0], p.pos[1]]);
    if (p.pending) out.push([item.key + ":now", item.lat, item.lon]);
  }
  return out;
}

// Whether a height (m above the sea) is AIRBORNE_M or more over the ground's (m), when both are known.
const airborne = (alt, ground) => isNum(alt) && isNum(ground) && alt - ground >= AIRBORNE_M;

const flightId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
// The pilot's open flight ended: it goes to the day's finished list (written to the store by run), counted when it was
// seen in the air (not pending any more). A flight far from every site has no track and is not kept.
function finish(day, p) {
  const t = p.track;
  p.track = null;
  if (!t || !t.points.length) return;
  (day.finished ??= []).push({ id: t.id, day: day.day, site: t.site, start: t.start, end: t.points[t.points.length - 1][0], minutes: t.minutes,
    max_alt: t.maxAlt, max_dist: t.maxDist, max_speed: t.maxSpeed, counted: p.pending ? 0 : 1, points: t.points });
}
// Pilots not heard for MAX_GAP_MINUTES have landed (observe only sees those heard): their flights are finished. With
// now = Infinity (the day is over) every open flight is finished. Returns whether anything changed.
export function sweep(day, now) {
  let changed = false;
  for (const p of Object.values(day.pilots)) {
    if (!p.flying || now - p.last <= MAX_GAP_MINUTES * 60000) continue;
    finish(day, p);
    p.flying = false;
    p.pending = null;
    changed = true;
  }
  return changed;
}

// Adds what is seen now (items with key, from parseLive) to the day ({ pilots: { key: { last, flying, still, pos, site,
// minutes, dist, alt, flights, pending } } }): a pilot seen flying after landing begins a new flight, for the site nearest
// where it is first seen; each new position in the air counts `minutes` (the time between runs) to that flight's site,
// with the farthest from it and the highest. The flight is pending ({ minutes, dist, alt, runs }) until the pilot is seen
// AIRBORNE_START_M over the ground (see above); then it and its minutes are counted. pos: the last position in the air
// ([lat, lon, alt]), only for the day. ground: { key: the ground's height in m } for the pilots needsGround named.
// flights: { site: n }, minutes/dist/alt: { site: … }. Returns whether anything changed.
export function observe(day, items, sites, now, minutes, ground = {}) {
  let changed = false;
  for (const item of items) {
    const t = Date.parse(item.time);
    if (now - t > FRESH_SECONDS * 1000) continue;
    let p = day.pilots[item.key];
    if (p && t <= p.last) continue;
    if (!isFlying(item)) {
      // On the ground: only those who have flown today are followed, until they are seen landed. Standing still high
      // over the ground is hovering in the wind, and counting starts again. Landed while pending: never in the air.
      if (p && p.flying && ++p.still >= LANDED_RUNS) {
        if (airborne(item.alt, ground[item.key])) p.still = 0;
        else { finish(day, p); p.flying = false; p.pending = null; }
      }
      if (p) { p.last = t; changed = true; }
      continue;
    }
    if (!p) p = day.pilots[item.key] = { last: 0, flying: false, still: 0, pos: null, site: null, flights: {}, minutes: {}, dist: {}, alt: {}, pending: null, track: null };
    const gap = t - p.last;
    const sameFlight = p.flying && (gap <= GAP_MINUTES * 60000 || (gap <= MAX_GAP_MINUTES * 60000 && p.pos && airborne(p.pos[2], ground[item.key])));
    if (!sameFlight) {
      if (p.flying) finish(day, p);
      p.site = nearestSite(sites, item)?.id ?? null;
      p.pending = p.site ? { minutes: 0, dist: 0, alt: null, runs: 0 } : null;
      p.track = p.site ? { id: flightId(), site: p.site, start: item.time, minutes: 0, maxAlt: null, maxDist: 0, maxSpeed: 0, points: [] } : null;
    }
    p.flying = true;
    p.still = 0;
    p.last = t;
    p.pos = [item.lat, item.lon, isNum(item.alt) ? Math.round(item.alt) : null];
    const site = p.site && sites.find((s) => s.id === p.site);
    if (site && p.track) {
      const tr = p.track;
      tr.points.push([item.time, Number(item.lat.toFixed(5)), Number(item.lon.toFixed(5)), isNum(item.alt) ? Math.round(item.alt) : null, isNum(item.speed) ? item.speed : null, isNum(item.climb) ? item.climb : null]);
      tr.minutes += minutes;
      tr.maxDist = Math.max(tr.maxDist, round1(distanceKm(site, item)));
      if (isNum(item.alt)) tr.maxAlt = Math.max(tr.maxAlt ?? 0, Math.round(item.alt));
      if (isNum(item.speed)) tr.maxSpeed = Math.max(tr.maxSpeed, item.speed);
    }
    if (site) {
      const sums = p.pending ?? { minutes: p.minutes[site.id] ?? 0, dist: p.dist[site.id] ?? 0, alt: p.alt[site.id] ?? null };
      sums.minutes += minutes;
      sums.dist = Math.max(sums.dist, round1(distanceKm(site, item)));
      if (isNum(item.alt)) sums.alt = Math.max(sums.alt ?? 0, Math.round(item.alt));
      if (p.pending) {
        const g = ground[item.key + ":now"];
        const known = isNum(g) && isNum(item.alt);
        if ((known && item.alt - g >= AIRBORNE_START_M) || (!known && ++p.pending.runs >= PENDING_RUNS)) {
          p.flights[site.id] = (p.flights[site.id] ?? 0) + 1;
          p.minutes[site.id] = (p.minutes[site.id] ?? 0) + sums.minutes;
          p.dist[site.id] = Math.max(p.dist[site.id] ?? 0, sums.dist);
          if (isNum(sums.alt)) p.alt[site.id] = Math.max(p.alt[site.id] ?? 0, sums.alt);
          p.pending = null;
        }
      } else {
        p.minutes[site.id] = sums.minutes;
        p.dist[site.id] = sums.dist;
        if (isNum(sums.alt)) p.alt[site.id] = sums.alt;
      }
    }
    changed = true;
  }
  return changed;
}

// The ground's height (m) at each point ([key, lat, lon]) from Kartverket's elevation model, as { key: m }, in one
// request. A point without an answer (outside Norway, or Kartverket down) is left out.
export async function groundAt(points) {
  if (!points.length) return {};
  const url = new URL(ELEVATION_API);
  url.searchParams.set("koordsys", "4258");
  url.searchParams.set("geojson", "false");
  url.searchParams.set("punkter", JSON.stringify(points.map(([, lat, lon]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))])));
  try {
    const r = await fetch(url, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Kartverket svarte ${r.status}`);
    const d = await r.json();
    const out = {};
    points.forEach(([key], i) => { const z = d?.punkter?.[i]?.z; if (isNum(z)) out[key] = z; });
    return out;
  } catch (err) {
    console.warn(`flights: ${err.message}`);
    return {};
  }
}

// The day summed up per site: [{ day, site, flights, pilots, minutes, max_dist, max_alt }].
export function dayRows(day) {
  const sites = {};
  for (const p of Object.values(day.pilots)) {
    for (const [id, n] of Object.entries(p.flights)) {
      const s = (sites[id] ??= { day: day.day, site: id, flights: 0, pilots: 0, minutes: 0, max_dist: 0, max_alt: null });
      s.flights += n;
      s.pilots++;
      s.minutes += p.minutes[id] ?? 0;
      s.max_dist = Math.max(s.max_dist, p.dist[id] ?? 0);
      if (isNum(p.alt[id])) s.max_alt = Math.max(s.max_alt ?? 0, p.alt[id]);
    }
  }
  return Object.values(sites);
}

// The dataset from all the stored days: per site the flights, the days with flying, the pilots (a pilot counted once a
// day), the minutes in the air, the farthest from launch and the highest, the last day, the same per month (YYYY-MM),
// and the flights and minutes of each day in the last RECENT_DAYS (recent, by date), so a page can count today and the
// last 30 days by its own clock.
export const RECENT_DAYS = 31;
export function buildFlights(rows, since, now = Date.now()) {
  const sites = {};
  const from = osloDay(now - (RECENT_DAYS - 1) * 86400000);
  for (const r of rows) {
    const s = (sites[r.site] ??= { flights: 0, days: 0, pilots: 0, minutes: 0, maxDist: 0, maxAlt: null, last: null, months: {}, recent: {} });
    if (r.day >= from) s.recent[r.day] = { flights: r.flights, minutes: r.minutes };
    const m = (s.months[r.day.slice(0, 7)] ??= { flights: 0, days: 0, pilots: 0, minutes: 0 });
    for (const x of [s, m]) { x.flights += r.flights; x.days++; x.pilots += r.pilots; x.minutes += r.minutes; }
    s.maxDist = Math.max(s.maxDist, r.max_dist ?? 0);
    if (isNum(r.max_alt)) s.maxAlt = Math.max(s.maxAlt ?? 0, r.max_alt);
    if (!s.last || r.day > s.last) s.last = r.day;
  }
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), since, sites };
}

// The flights of the last RECENT_DAYS, newest first, each with its positions ([time, lat, lon, alt, speed m/s, climb m/s]).
export function buildFlightLog(rows, now = Date.now()) {
  const flights = rows.map((r) => ({ id: r.id, day: r.day, site: r.site, start: r.start, end: r.end, minutes: r.minutes, maxAlt: r.max_alt ?? null,
    maxDist: r.max_dist ?? null, maxSpeed: r.max_speed ?? null, counted: r.counted === 1, points: typeof r.points === "string" ? JSON.parse(r.points) : r.points }))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return { dataset: LOG_DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), days: RECENT_DAYS, flights };
}

// The day's finished flights written to the store, and the old ones pruned. Returns how many were written.
async function flushFinished(store, day, now) {
  const list = day.finished ?? [];
  for (const f of list) await store.putFlight(f);
  day.finished = [];
  if (list.length) await store.pruneFlights(osloDay(now - TRACK_DAYS * 86400000), osloDay(now - DROPPED_DAYS * 86400000));
  return list.length;
}

// One-off: a car on the E6 past Bjerkvik with the app on was counted as Haugfjellet's first flight on 25 October 2026
// (27 km in 18 minutes, 179 m above the sea), before the rules above. Removed once (the state flag records it). Delete
// this and its use in run() after it has run on the service.
export const CLEANUP = { day: "2026-10-25", site: "haugfjellet", flag: "flights-cleanup-2026-10-25" };
async function cleanup(store, day) {
  if (await store.getState(CLEANUP.flag)) return false;
  await store.deleteFlightDay(CLEANUP.day, CLEANUP.site);
  if (day.day === CLEANUP.day) {
    for (const p of Object.values(day.pilots)) {
      for (const k of ["flights", "minutes", "dist", "alt"]) delete p[k][CLEANUP.site];
      if (p.site === CLEANUP.site) p.pending = null;
    }
  }
  await store.putState(CLEANUP.flag, { at: new Date().toISOString() });
  return true;
}

// One run: what OGN hears now is added to the day; when something changed (or a new day began), the day's sums and the
// dataset are stored. minutes: the time between runs (schedule.js).
export async function run(store, sites, now = Date.now(), minutes = 2) {
  const items = await fetchLive(sites, now, { store });
  if (items.via) console.log(`flights: ${items.length} fra OGNs APRS-strøm (kartet svarte ikke)`);
  const today = osloDay(now);
  let day = await store.getState(STATE);
  let changed = false, written = 0;
  if (!day || day.day !== today) {
    // The old day is over: its open flights end now and are written with its date.
    if (day) { sweep(day, Infinity); written += await flushFinished(store, day, now); }
    day = { day: today, salt: crypto.randomUUID(), pilots: {}, finished: [] };
    changed = true;
  }
  if (await cleanup(store, day)) changed = true;
  const keyed = await Promise.all(items.map(async (i) => ({ ...i, key: await pilotKey(day.salt, i.id) })));
  const ground = await groundAt(needsGround(day, keyed, now));
  const seen = observe(day, keyed, sites, now, minutes, ground);
  if (sweep(day, now) || seen) {
    await store.putFlightDays(dayRows(day));
    changed = true;
  }
  written += await flushFinished(store, day, now);
  let since = await store.getState("flights-since");
  if (!since) { since = today; await store.putState("flights-since", since); changed = true; }
  if (!changed) return;
  await store.putState(STATE, day);
  await store.putSnapshot(DATASET, JSON.stringify(buildFlights(await store.flightDays(), since, now)));
  if (written || !(await store.getState("flight-log-built"))) {
    await store.putSnapshot(LOG_DATASET, JSON.stringify(buildFlightLog(await store.flightsSince(osloDay(now - (RECENT_DAYS - 1) * 86400000)), now)));
    await store.putState("flight-log-built", { at: new Date(now).toISOString() });
  }
}
