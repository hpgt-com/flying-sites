// «Piloter i lufta»: the aircraft the Open Glider Network hears in the area right now (FANET from paragliders' varios,
// FLARM and others), as /v1/live.json. Fetched on demand, not on the schedule: the map asks every few seconds while the
// layer is on, and the answer is kept CACHE_SECONDS in Cloudflare's cache, so OGN gets at most one request per few
// seconds however many look. Each aircraft's track over the last TRAIL_MINUTES is kept in memory in the store (never
// written down) and sent along as trail, so the map can draw it at once. OGN's rules (glidernet.org/ogn-data-usage): ODbL, the device owners'
// privacy choices are followed (OGN's live data already leaves out devices that must not be tracked, and gives those that
// must not be identified a random short name, which is shown as unknown here), and nothing older than 24 hours is passed
// on (positions older than MAX_AGE_SECONDS are left out). Tested in test/data-worker.test.js.

export const DATASET = "live";
export const SOURCE = "Open Glider Network";
export const LICENSE = "ODbL, Open Glider Network";
export const CACHE_SECONDS = 5;
export const MAX_AGE_SECONDS = 600;
export const TRAIL_MINUTES = 10;
const API = "https://live.glidernet.org/lxml.php";
// OGN's aircraft types: 6 hang glider, 7 paraglider; the others are kept with their type (planes, gliders and helicopters
// are worth seeing too), except 15, a static object.
const STATIC = 15;

// The area: the flying sites (sites.json) with a margin, as OGN's bounds (north, south, east, west).
export function bounds(sites, margin = 0.5) {
  const lats = sites.map((s) => s.lat), lons = sites.map((s) => s.lon);
  return { n: Math.max(...lats) + margin, s: Math.min(...lats) - margin, e: Math.max(...lons) + 2 * margin, w: Math.min(...lons) - 2 * margin };
}

const num = (v) => { const n = Number(v); return v !== "" && Number.isFinite(n) ? n : null; };

// OGN's answer (<m a="lat,lon,short name,name,alt m,hh:mm:ss,age s,track,speed km/h,climb m/s,type,receiver,device,id"/>)
// as items, newest first. now: the time of the answer, for each position's time (now − age).
export function parseLive(xml, now = Date.now()) {
  const items = [];
  for (const m of String(xml).matchAll(/<m a="([^"]*)"/g)) {
    const f = m[1].split(",");
    if (f.length < 14) continue;
    const lat = num(f[0]), lon = num(f[1]), age = num(f[6]), type = num(f[10]);
    if (lat === null || lon === null || age === null || age > MAX_AGE_SECONDS || type === STATIC) continue;
    const id = /^[0-9a-f]{6,16}$/i.test(f[13]) ? f[13].toLowerCase() : null;
    if (!id) continue;
    // A short name starting with «_» (and the id as the name) is OGN's way of showing a device that must not be identified,
    // or is not registered: shown as unknown.
    const anonymous = f[2].startsWith("_") || !f[3] || f[3].toLowerCase() === id;
    const name = anonymous ? null : f[3].slice(0, 20);
    const speed = num(f[8]);
    items.push({
      id, name, lat, lon, alt: num(f[4]), track: num(f[7]), speed: speed === null ? null : Math.round((speed / 3.6) * 10) / 10,
      climb: num(f[9]), type: type ?? 0, time: new Date(now - age * 1000).toISOString(),
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

// Adds the positions ([{ id, time, lat, lon }]) to the tracks (a Map id → [[ms, lat, lon], ...]), drops what is older than
// keepMs before now, and returns { id: [[lat, lon], ...] } oldest first for the ids given.
export function mergeTrails(tracks, positions, now, keepMs) {
  for (const p of positions) {
    const t = Date.parse(p.time);
    const track = tracks.get(p.id) ?? [];
    if (!track.length || track[track.length - 1][0] < t) track.push([t, p.lat, p.lon]);
    tracks.set(p.id, track);
  }
  for (const [id, track] of tracks) {
    const kept = track.filter((x) => x[0] >= now - keepMs);
    if (kept.length) tracks.set(id, kept);
    else tracks.delete(id);
  }
  return Object.fromEntries(positions.map((p) => [p.id, (tracks.get(p.id) ?? []).map((x) => [x[1], x[2]])]));
}

// The answer to GET /v1/live.json, from OGN, or from the cache when it is fresh. store: for the tracks (mergeLive).
export async function handleLive(sites, now = Date.now(), cache = globalThis.caches?.default, store = null) {
  const key = new Request("https://data.hpgt.workers.dev/v1/live.json");
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const b = bounds(sites);
  const url = `${API}?a=0&b=${b.n.toFixed(2)}&c=${b.s.toFixed(2)}&d=${b.e.toFixed(2)}&e=${b.w.toFixed(2)}`;
  let body;
  try {
    const r = await fetch(url, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`OGN svarte ${r.status}`);
    const items = parseLive(await r.text(), now);
    if (store && items.length) {
      const trails = await store.mergeLive(items.map(({ id, time, lat, lon }) => ({ id, time, lat, lon })), now, TRAIL_MINUTES * 60000);
      for (const item of items) item.trail = trails[item.id] ?? [];
    }
    body = JSON.stringify({ dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), items });
  } catch (err) {
    console.warn(`live: ${err.message}`);
    return Response.json({ dataset: DATASET, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const res = new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_SECONDS}` } });
  if (cache) await cache.put(key, res.clone());
  return res;
}
