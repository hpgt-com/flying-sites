// «Registrer tur» (prototype): POST /v1/logbook from flysteder.hpgt.com, a flight a pilot logs from the page
// /registrer-tur/: the site, the day, the minutes in the air, the highest point and the farthest from launch, and
// whether it came from a log file (read in the pilot's own browser, lib/igc.js: the track never leaves it) or was
// typed in. No name, no device, no track: only the sums, which are published for everyone as /v1/logbook.json (per
// site and month, the records). The browser is checked with Cloudflare Turnstile as for «Meld fra» (report.js), with
// the same kind of limits per day and per address. A flight sent twice (the same file again) counts once: the key is
// the site, the day and the takeoff minute from the log. Tested in test/data-worker.test.js.

import { turnstileOk, ipKey } from "./report.js";

export const DATASET = "logbook";
export const CATEGORIES = ["PG", "SPG"];
export const SOURCES = ["igc", "kml", "manual"];
export const MAX_MINUTES = 12 * 60;
export const MAX_ALT = 6000;
export const MAX_DIST_KM = 500;
// A flight may be logged up to this long after the day (old logs), never in the future.
export const MAX_AGE_DAYS = 400;
export const MAX_KEY = 80;
export const MAX_BODY = 4096;
// A busy evening after a good day: a pilot logs a handful, a few pilots more. Enough, and a flood is bounded.
export const DAILY_LIMIT = 200;
export const PER_IP_LIMIT = 20;
const DAY = 86400000;
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);

// The flight checked, or { error } with what is wrong. siteIds: the sites that exist.
export function checkFlight(body, siteIds, now = Date.now()) {
  if (!body || typeof body !== "object") return { error: "bad-request" };
  const site = typeof body.site === "string" && siteIds.includes(body.site) ? body.site : null;
  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  const t = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!site || !day || !Number.isFinite(t) || t > now + DAY || now - t > MAX_AGE_DAYS * DAY) return { error: "bad-request" };
  const minutes = int(body.minutes, 1, MAX_MINUTES);
  if (minutes === undefined) return { error: "bad-request" };
  const maxAlt = body.maxAlt == null ? null : int(body.maxAlt, 0, MAX_ALT);
  const maxDistKm = body.maxDistKm == null ? null : (typeof body.maxDistKm === "number" && body.maxDistKm >= 0 && body.maxDistKm <= MAX_DIST_KM ? Math.round(body.maxDistKm * 10) / 10 : undefined);
  if (maxAlt === undefined || maxDistKm === undefined) return { error: "bad-request" };
  const category = body.category == null || body.category === "" ? null : CATEGORIES.includes(body.category) ? body.category : undefined;
  const source = SOURCES.includes(body.source) ? body.source : undefined;
  const key = typeof body.key === "string" && /^[\w|:.-]{4,80}$/.test(body.key) ? body.key : undefined;
  if (category === undefined || source === undefined || key === undefined) return { error: "bad-request" };
  const token = typeof body.token === "string" ? body.token : "";
  if (!token || token.length > 4096) return { error: "no-token" };
  return { site, day, minutes, maxAlt, maxDistKm, category, source, key: `${site}|${key}`, token };
}

// The dataset from the stored flights: the sums for all and per site, the flights per month, and the records.
export function buildLogbook(rows, now = Date.now()) {
  const record = (cur, value, date) => (value != null && (!cur || value > cur.value) ? { value, date } : cur);
  const out = { dataset: DATASET, fetched: new Date(now).toISOString(), flights: 0, minutes: 0, first: null, last: null, months: {}, sites: {} };
  for (const f of [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    const month = f.day.slice(0, 7);
    out.flights++;
    out.minutes += f.minutes;
    out.first = out.first ?? f.day;
    out.last = f.day;
    out.months[month] = (out.months[month] ?? 0) + 1;
    const s = (out.sites[f.site] ??= { flights: 0, minutes: 0, first: f.day, last: f.day, months: {}, longest: null, highest: null, farthest: null, categories: {} });
    s.flights++;
    s.minutes += f.minutes;
    s.last = f.day;
    s.months[month] = (s.months[month] ?? 0) + 1;
    s.longest = record(s.longest, f.minutes, f.day);
    s.highest = record(s.highest, f.max_alt, f.day);
    s.farthest = record(s.farthest, f.max_dist_km, f.day);
    if (f.category) s.categories[f.category] = (s.categories[f.category] ?? 0) + 1;
  }
  return out;
}

// The answer to POST /v1/logbook: { status, body }. store: the flights and the day's counts; siteIds as for checkFlight.
export async function handleLogbook(request, env, store, siteIds, now = Date.now()) {
  if (!env.TURNSTILE_SECRET) return { status: 503, body: { error: "not-configured" } };
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return { status: 415, body: { error: "bad-request" } };
  if (Number(request.headers.get("content-length")) > MAX_BODY) return { status: 413, body: { error: "bad-length" } };
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return { status: 413, body: { error: "bad-length" } };
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const flight = checkFlight(body, siteIds, now);
  if (flight.error) return { status: 400, body: { error: flight.error } };
  const ip = request.headers.get("cf-connecting-ip");
  if (!(await turnstileOk(env, flight.token, ip))) return { status: 403, body: { error: "turnstile" } };
  const day = new Date(now).toISOString().slice(0, 10);
  const who = await ipKey(ip, await store.reportSalt(day));
  const reserved = await store.reserveReport(day, who, DAILY_LIMIT, PER_IP_LIMIT, "logbook");
  if (reserved !== "ok") return { status: 429, body: { error: "limit" } };
  const stored = { ...flight };
  delete stored.token;
  await store.putLoggedFlight(stored, now);
  const logbook = buildLogbook(await store.loggedFlights(), now);
  await store.putSnapshot(DATASET, JSON.stringify(logbook));
  return { status: 200, body: { ok: true, flights: logbook.flights, site: logbook.sites[flight.site]?.flights ?? 1 } };
}
