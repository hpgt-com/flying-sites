// How well the forecast hit (dataset «verification»): for each flying site with its own station (stations.js), every
// finished hour the forecast for that hour (forecast_hours, as it stood during the hour, sources/forecast.js) is set
// against what the station measured in it: the mean wind, the highest gust and the direction. The pairs are kept for a
// year (store.js verify_hours), and the dataset sums up the last DAYS days per site. Tested in test/data-worker.test.js.

export const DATASET = "verification";
export const DAYS = 30;
export const KEEP_DAYS = 365;
// The hours looked at again on each run, so an hour whose measurements came late (MET's hourly) is still paired.
export const BACK_HOURS = 3;
// A sector needs this many hours before its own error is shown, and the direction counts only in some wind.
export const SECTOR_MIN_HOURS = 5;
export const DIR_MIN_SPEED = 2;
const HOUR = 3600000;
const CODES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const rad = Math.PI / 180;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

export function sector(dir) { return CODES[Math.round((((dir % 360) + 360) % 360) / 45) % 8]; }
// The smallest angle between two directions, 0–180.
export function angle(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

// What a station measured in the hour from `start` (ms): rows with a time after the start up to and including the end of
// the hour (MET stamps its hourly value at the end). { speed (mean), gust (highest), dir (vector mean), n }, or null.
export function measuredHour(rows, start) {
  const part = rows.filter((r) => { const t = Date.parse(r.time); return t > start && t <= start + HOUR && num(r.speed) !== null; });
  if (!part.length) return null;
  let u = 0, v = 0, withDir = 0;
  for (const r of part) if (num(r.dir) !== null) { u += Math.sin(r.dir * rad) * r.speed; v += Math.cos(r.dir * rad) * r.speed; withDir++; }
  const gusts = part.map((r) => num(r.gust)).filter((g) => g !== null);
  return {
    speed: round1(part.reduce((t, r) => t + r.speed, 0) / part.length),
    gust: gusts.length ? Math.max(...gusts) : null,
    dir: withDir && (u || v) ? Math.round((Math.atan2(u, v) / rad + 360) % 360) : null,
    n: part.length,
  };
}

// The pairs for the finished hours from `from` to `now`: one per linked site with both a forecast and a measurement.
// links: [{ site, source, station }]; hours: forecast_hours rows; rows: measurements rows of every linked station.
export function pairs(links, hours, rows, from, now) {
  const out = [];
  for (const link of links) {
    const own = rows.filter((r) => r.source === link.source && String(r.station) === String(link.station));
    for (const h of hours.filter((x) => x.site === link.site)) {
      const start = Date.parse(h.time);
      if (start < from || start + HOUR > now || num(h.speed) === null) continue;
      const m = measuredHour(own, start);
      if (!m) continue;
      out.push({ site: link.site, station: String(link.station), time: h.time, f_dir: num(h.dir), f_speed: h.speed, f_gust: num(h.gust),
        m_dir: m.dir, m_speed: m.speed, m_gust: m.gust, n: m.n });
    }
  }
  return out;
}

// One site's pairs summed up: the mean error of the mean wind and the gust (measured − forecast, so + means stronger than
// forecast), the mean absolute error, the share of hours the direction was within 45° (in DIR_MIN_SPEED or more), and the
// error of the mean wind per sector the wind came from. null without pairs.
export function summarize(list) {
  if (!list.length) return null;
  const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const err = list.map((p) => p.m_speed - p.f_speed);
  const gusts = list.filter((p) => num(p.m_gust) !== null && num(p.f_gust) !== null).map((p) => p.m_gust - p.f_gust);
  const dirs = list.filter((p) => num(p.m_dir) !== null && num(p.f_dir) !== null && p.m_speed >= DIR_MIN_SPEED);
  const bySector = {};
  for (const p of list) if (num(p.m_dir) !== null) (bySector[sector(p.m_dir)] ??= []).push(p.m_speed - p.f_speed);
  const sectors = Object.fromEntries(Object.entries(bySector).filter(([, xs]) => xs.length >= SECTOR_MIN_HOURS)
    .map(([code, xs]) => [code, { hours: xs.length, bias: round1(mean(xs)) }]));
  return {
    hours: list.length,
    bias: round1(mean(err)),
    mae: round1(mean(err.map(Math.abs))),
    gustBias: gusts.length ? round1(mean(gusts)) : null,
    dirHit: dirs.length ? Math.round((dirs.filter((p) => angle(p.m_dir, p.f_dir) <= 45).length / dirs.length) * 100) / 100 : null,
    sectors,
  };
}

// The dataset from the stored pairs: per site its station and the summary of the last DAYS days.
export function buildVerification(stored, now = Date.now()) {
  const sites = {};
  for (const p of stored) (sites[p.site] ??= []).push(p);
  return {
    dataset: DATASET, source: "MET Norge, Holfuy", fetched: new Date(now).toISOString(), days: DAYS,
    sites: Object.fromEntries(Object.entries(sites).map(([site, list]) => [site, { station: list[list.length - 1].station, ...summarize(list) }])),
  };
}

// One run: pairs the last BACK_HOURS finished hours, stores them, prunes those older than KEEP_DAYS, and stores the dataset.
export async function run(store, links, now = Date.now()) {
  if (!links.length) return;
  const from = Math.floor(now / HOUR) * HOUR - BACK_HOURS * HOUR;
  const hours = (await store.forecastHoursSince(new Date(from).toISOString()));
  const rows = [];
  for (const source of [...new Set(links.map((l) => l.source))]) rows.push(...(await store.measurementsSince(source, new Date(from).toISOString())));
  await store.putVerifyHours(pairs(links, hours, rows, from, now));
  await store.pruneVerifyHours(new Date(now - KEEP_DAYS * 24 * HOUR).toISOString());
  const stored = await store.verifyHoursSince(new Date(now - DAYS * 24 * HOUR).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildVerification(stored, now)));
}
