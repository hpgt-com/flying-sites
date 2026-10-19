// Flight logs (IGC, and KML with times) for «Fra turlogger»: reads a log, finds the flight in it (takeoff and landing),
// which flying site it started from, the time in the air, the highest point and the farthest from launch. aggregate()
// sums many flights per site; only those sums are published (src/_data/logbook.json, scripts/logbook.mjs), never a
// track, a file or a name. Tested in test/igc.test.js.

const rad = Math.PI / 180;
// A flight: moving at TAKEOFF_SPEED m/s or more over WINDOW_S seconds. The launch: the nearest launch of a site within
// LAUNCH_KM. (The direction flown just after takeoff was tried and left out: a turn or drift right after takeoff gives
// a wrong picture of the launch direction. The grid of where flights climbed was left out too: thermal.kk7.ch, on the
// maps, is built from far more flights.)
export const TAKEOFF_SPEED = 4;
export const WINDOW_S = 20;
export const LAUNCH_KM = 0.5;
export const MIN_MINUTES = 1;

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
// An IGC file: { date: "YYYY-MM-DD" | null, points: [{ t (s from midnight UTC, past midnight continues), lat, lon, alt }] }.
// The GPS height when the logger has it, else the pressure height.
export function parseIgc(text) {
  const lines = String(text).split(/\r?\n/);
  const h = lines.map((l) => /^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/.exec(l)).find(Boolean);
  const date = h ? `20${h[3]}-${h[2]}-${h[1]}` : null;
  const points = [];
  let last = -1, day = 0;
  for (const l of lines) {
    const m = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])([-\d]\d{4})([-\d]\d{4})/.exec(l);
    if (!m) continue;
    let t = +m[1] * 3600 + +m[2] * 60 + +m[3] + day;
    if (t < last - 3600) { day += 86400; t += 86400; }
    last = t;
    const lat = (+m[4] + +m[5] / 60000) * (m[6] === "S" ? -1 : 1);
    const lon = (+m[7] + +m[8] / 60000) * (m[9] === "W" ? -1 : 1);
    const press = +m[11], gps = +m[12];
    points.push({ t, lat, lon, alt: gps > 0 ? gps : press });
  }
  return { date, points };
}

// A KML file with times: the same shape as parseIgc. Two kinds are read: a gx:Track (when + gx:coord, as most apps
// write a track), and one placemark per fix with its own time and point (as GpsDump can write the track points beside
// a plain line). A GpsDump trip has its times beside the tracklog's line instead: FsInfo's time_of_first_point and
// SecondsFromTimeOfFirstPoint, one per coordinate. A track without times (only a LineString) gives no points, since
// takeoff and time in the air cannot be found; the script then counts the file as one without a flight.
export function parseKml(text) {
  const s = String(text);
  let whens = [...s.matchAll(/<when>([^<]+)<\/when>/g)].map((m) => Date.parse(m[1]));
  let coords = [...s.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  const fs = !coords.length && /<Placemark\b(?:(?!<\/Placemark>)[\s\S])*?time_of_first_point="([^"]+)"[\s\S]*?<SecondsFromTimeOfFirstPoint>([^<]*)<\/SecondsFromTimeOfFirstPoint>[\s\S]*?<LineString\b[\s\S]*?<coordinates>([^<]+)<\/coordinates>/.exec(s);
  if (fs) {
    const first = Date.parse(fs[1]);
    whens = fs[2].trim().split(/\s+/).map((x) => first + Number(x) * 1000);
    coords = fs[3].trim().split(/\s+/).map((c) => c.split(",").map(Number));
  }
  if (!coords.length) {
    const fixes = [...s.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g)]
      .map((m) => [/<when>([^<]+)<\/when>/.exec(m[0]), /<Point\b[\s\S]*?<coordinates>([^<]+)<\/coordinates>/.exec(m[0])])
      .filter(([w, c]) => w && c);
    whens = fixes.map(([w]) => Date.parse(w[1]));
    coords = fixes.map(([, c]) => c[1].trim().split(",").map(Number));
  }
  const n = Math.min(whens.length, coords.length);
  if (!n || !Number.isFinite(whens[0])) return { date: null, points: [] };
  const start = whens[0], midnight = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  const points = [];
  for (let i = 0; i < n; i++) {
    const [lon, lat, alt] = coords[i];
    if (Number.isFinite(whens[i]) && Number.isFinite(lat) && Number.isFinite(lon)) points.push({ t: (whens[i] - midnight) / 1000, lat, lon, alt: Number.isFinite(alt) ? alt : null });
  }
  return { date: new Date(start).toISOString().slice(0, 10), points };
}

// The launches of the sites: [{ site, lat, lon }] from each site's launch and its launches with their own position.
export function launchPoints(sites) {
  const out = [];
  for (const s of sites) {
    if (s.launch) out.push({ site: s.id, lat: s.launch.lat, lon: s.launch.lon });
    for (const l of s.launches ?? []) if (Number.isFinite(l.lat) && Number.isFinite(l.lon)) out.push({ site: s.id, lat: l.lat, lon: l.lon });
  }
  return out;
}

// The index of the first point from which the next WINDOW_S seconds are flown at TAKEOFF_SPEED or more, searching from
// `from` in steps of `dir` (1 forwards for the takeoff, -1 backwards for the landing). -1 without one.
function moving(points, from, dir) {
  for (let i = from; i >= 0 && i < points.length; i += dir) {
    let j = i;
    while (j + dir >= 0 && j + dir < points.length && Math.abs(points[j].t - points[i].t) < WINDOW_S) j += dir;
    const dt = Math.abs(points[j].t - points[i].t);
    if (dt >= WINDOW_S * 0.75 && distanceKm(points[i], points[j]) * 1000 / dt >= TAKEOFF_SPEED) return i;
  }
  return -1;
}

// One flight from a parsed log: { date, takeoff (s), site (or null), minutes, maxAlt, maxDistKm }, or null when the log
// holds no flight.
export function analyzeFlight(log, launches) {
  const p = log.points;
  if (p.length < 10) return null;
  const a = moving(p, 0, 1), b = moving(p, p.length - 1, -1);
  if (a < 0 || b <= a) return null;
  const minutes = Math.round((p[b].t - p[a].t) / 60);
  if (minutes < MIN_MINUTES) return null;
  const start = p[a];
  let near = null, km = LAUNCH_KM;
  for (const l of launches) { const d = distanceKm(l, start); if (d <= km) { near = l; km = d; } }
  let maxAlt = null, maxDistKm = 0;
  for (let i = a; i <= b; i++) {
    if (Number.isFinite(p[i].alt)) maxAlt = Math.max(maxAlt ?? -Infinity, p[i].alt);
    maxDistKm = Math.max(maxDistKm, distanceKm(start, p[i]));
  }
  return {
    date: log.date, takeoff: start.t, site: near ? near.site : null, minutes,
    maxAlt: maxAlt == null ? null : Math.round(maxAlt), maxDistKm: Math.round(maxDistKm * 10) / 10,
  };
}

// The same flight in two files (an IGC and a KML of it): the same date and the same takeoff minute.
export const flightKey = (f) => `${f.date}|${Math.round(f.takeoff / 60)}`;

// The flights summed up: { flights, first, last, unattributed, sites: { id: { flights, first, last, minutes, months
// ({ "01".."12": n }), longest, highest, farthest ({ value, date }) } } }.
export function aggregate(flights) {
  const out = { flights: 0, first: null, last: null, unattributed: 0, sites: {} };
  const record = (cur, value, date) => (value != null && (!cur || value > cur.value) ? { value, date } : cur);
  for (const f of flights) {
    out.flights++;
    if (f.date) { if (!out.first || f.date < out.first) out.first = f.date; if (!out.last || f.date > out.last) out.last = f.date; }
    if (!f.site) { out.unattributed++; continue; }
    const s = (out.sites[f.site] ??= { flights: 0, first: null, last: null, minutes: 0, months: {}, longest: null, highest: null, farthest: null });
    s.flights++;
    s.minutes += f.minutes;
    if (f.date) {
      if (!s.first || f.date < s.first) s.first = f.date;
      if (!s.last || f.date > s.last) s.last = f.date;
      const m = f.date.slice(5, 7);
      s.months[m] = (s.months[m] ?? 0) + 1;
    }
    s.longest = record(s.longest, f.minutes, f.date);
    s.highest = record(s.highest, f.maxAlt, f.date);
    s.farthest = record(s.farthest, f.maxDistKm, f.date);
  }
  return out;
}
