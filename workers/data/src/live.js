// «Piloter i lufta»: paraglidere (og speedflyere) som Open Glider Network hører i området akkurat nå (FANET fra
// varioer og mobilapper, FLARM), som /v1/live.json. Hentes ved behov, ikke etter timeplanen. Kartet spør med noen
// sekunders mellomrom mens laget er på, og svaret holdes i CACHE_SECONDS sekunder i Cloudflares hurtigbuffer. Slik får
// OGN høyst én forespørsel per ti sekunder, uansett hvor mange som ser. Sporet til hver pilot de siste TRAIL_MINUTES
// minuttene, med stigningen i hvert punkt, holdes i minnet i lageret (skrives aldri ned) og sendes med som trail, så
// kartet kan tegne det med én gang.
// OGNs regler (glidernet.org/ogn-data-usage): ODbL, og eiernes personvernvalg følges. OGNs sanntidsdata utelater
// allerede enheter som ikke skal spores, og gir dem som ikke skal identifiseres, et tilfeldig kortnavn, som vises som
// ukjent her. Ingenting eldre enn 24 timer sendes videre (posisjoner eldre enn MAX_AGE_SECONDS utelates). Når
// nettkartet ikke svarer, leses de samme posisjonene fra OGNs APRS-strøm (aprs.js), og da følges reglene her.
// Testet i test/data-worker.test.js.

import { listenAprs } from "./aprs.js";

export const DATASET = "live";
export const SOURCE = "Open Glider Network";
export const LICENSE = "ODbL, Open Glider Network";
export const CACHE_SECONDS = 10;
// Når både OGN og APRS-reserven har feilet: hvor lenge svaret er 503 med én gang, uten å spørre på nytt. Ellers lytter
// hver forespørsel til APRS i APRS_LIVE_SECONDS sekunder mens de er nede, og kartet spør med noen sekunders mellomrom.
export const FAIL_SECONDS = 20;
// Hvor lenge forespørselen fra kartet lytter til APRS-strømmen når nettkartet er nede.
export const APRS_LIVE_SECONDS = 8;
export const MAX_AGE_SECONDS = 600;
export const TRAIL_MINUTES = 10;
const API = "https://live.glidernet.org/lxml.php";
// Bare OGNs luftfartøytype 7, paraglider (også speedwings), beholdes: det er pilotene dette er for. Det flys ikke
// hangglider her, og fly, seilfly og resten ville fylt kartet uten å si en paragliderpilot stort.
export const PARAGLIDER = 7;

// Området: flystedene (sites.json) med en margin, som OGNs grenser (nord, sør, øst, vest).
export function bounds(sites, margin = 0.5) {
  const lats = sites.map((s) => s.lat), lons = sites.map((s) => s.lon);
  return { n: Math.max(...lats) + margin, s: Math.min(...lats) - margin, e: Math.max(...lons) + 2 * margin, w: Math.min(...lons) - 2 * margin };
}

const num = (v) => { const n = Number(v); return v !== "" && Number.isFinite(n) ? n : null; };

// Svaret fra OGN som elementer, nyeste først:
//   <m a="lat,lon,short name,name,alt m,hh:mm:ss,age s,track,speed km/h,climb m/s,type,receiver,device,id"/>
// now: tiden for svaret, for tiden til hver posisjon (now − age).
export function parseLive(xml, now = Date.now()) {
  const items = [];
  for (const m of String(xml).matchAll(/<m a="([^"]*)"/g)) {
    const f = m[1].split(",");
    if (f.length < 14) continue;
    const lat = num(f[0]), lon = num(f[1]), age = num(f[6]), type = num(f[10]);
    if (lat === null || lon === null || age === null || age > MAX_AGE_SECONDS || type !== PARAGLIDER) continue;
    const id = /^[0-9a-f]{6,16}$/i.test(f[13]) ? f[13].toLowerCase() : null;
    if (!id) continue;
    // Et kortnavn som begynner med «_» (og ID-en som navn) er OGNs måte å vise en enhet som ikke skal identifiseres,
    // eller som ikke er registrert. Den vises som ukjent.
    const anonymous = f[2].startsWith("_") || !f[3] || f[3].toLowerCase() === id;
    const name = anonymous ? null : f[3].slice(0, 20);
    const speed = num(f[8]);
    items.push({
      id, name, lat, lon, alt: num(f[4]), track: num(f[7]), speed: speed === null ? null : Math.round((speed / 3.6) * 10) / 10,
      climb: num(f[9]), type, time: new Date(now - age * 1000).toISOString(),
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

// Legger posisjonene ([{ id, time, lat, lon, climb }]) til sporene (et Map id → [[ms, lat, lon, climb], ...]), fjerner
// det som er eldre enn keepMs før now, og gir { id: [[lat, lon, climb], ...] }, eldste først, for de gitte ID-ene. Da
// kan kartet fargelegge sporet etter stigning og synk (climb i m/s, eller null når OGN ikke ga den).
export function mergeTrails(tracks, positions, now, keepMs) {
  for (const p of positions) {
    const t = Date.parse(p.time);
    const track = tracks.get(p.id) ?? [];
    if (!track.length || track[track.length - 1][0] < t) track.push([t, p.lat, p.lon, p.climb ?? null]);
    tracks.set(p.id, track);
  }
  for (const [id, track] of tracks) {
    const kept = track.filter((x) => x[0] >= now - keepMs);
    if (kept.length) tracks.set(id, kept);
    else tracks.delete(id);
  }
  return Object.fromEntries(positions.map((p) => [p.id, (tracks.get(p.id) ?? []).map((x) => [x[1], x[2], x[3]])]));
}

// Paraglidere OGN hører i stedenes område nå, slik parseLive gir dem. Brukes også for flyaktiviteten
// (sources/flights.js). Når nettkartet feiler og et lager er gitt, hentes de fra APRS-strømmen i stedet (aprs.js), med
// lytting i aprsSeconds sekunder. items har da via: "aprs". Kaster feilen fra nettkartet når heller ikke reserven
// kan brukes.
export async function fetchLive(sites, now = Date.now(), { store = null, aprsSeconds = 20, connect } = {}) {
  const b = bounds(sites);
  const url = `${API}?a=0&b=${b.n.toFixed(2)}&c=${b.s.toFixed(2)}&d=${b.e.toFixed(2)}&e=${b.w.toFixed(2)}`;
  let error;
  try {
    const r = await fetch(url, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return parseLive(await r.text(), now);
    error = new Error(`OGN svarte ${r.status}`);
  } catch (err) {
    error = err;
  }
  if (!store) throw error;
  try {
    const noTrack = new Set(await store.noTrack(now));
    const items = await listenAprs(sites, noTrack, { seconds: aprsSeconds, now, connect });
    items.via = "aprs";
    return items;
  } catch (err) {
    throw new Error(`${error.message}; APRS: ${err.message}`);
  }
}

// Svaret på GET /v1/live.json, fra OGN, eller fra hurtigbufferen når den er fersk. store: for sporene (mergeLive).
export async function handleLive(sites, now = Date.now(), cache = globalThis.caches?.default, store = null) {
  const key = new Request("https://data.hpgt.com/v1/live.json");
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const failKey = new Request("https://data.hpgt.com/v1/live.json?failed");
  const unavailable = () => Response.json({ dataset: DATASET, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (cache && (await cache.match(failKey))) return unavailable();
  let body;
  try {
    // Kort lytting når reserven trengs: kartet spør igjen om noen sekunder.
    const items = await fetchLive(sites, now, { store, aprsSeconds: APRS_LIVE_SECONDS });
    if (store && items.length) {
      const trails = await store.mergeLive(items.map(({ id, time, lat, lon, climb }) => ({ id, time, lat, lon, climb })), now, TRAIL_MINUTES * 60000);
      for (const item of items) item.trail = trails[item.id] ?? [];
    }
    body = JSON.stringify({ dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), ...(items.via ? { via: items.via } : {}), items });
  } catch (err) {
    console.warn(`live: ${err.message}`);
    if (cache) await cache.put(failKey, new Response("failed", { headers: { "cache-control": `public, max-age=${FAIL_SECONDS}` } }));
    return unavailable();
  }
  const res = new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_SECONDS}` } });
  if (cache) await cache.put(key, res.clone());
  return res;
}
