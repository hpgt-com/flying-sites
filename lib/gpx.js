// Leser GPX-filer og lager tall og høydeprofil for gangrutene.
// Høyder hentes fra Kartverket og caches i src/_data/cache/elevations/.
// GPS-høyden i filen brukes som reserve hvis Kartverket ikke svarer.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.resolve("src/_data/cache/elevations");
const KARTVERKET_URL = "https://ws.geonorge.no/hoydedata/v1/punkt";
const KARTVERKET_MAX_POINTS = 50; // maks antall punkter per kall
const STEP_M = 10; // avstand mellom punktene i profilen
const STEEP = 0.25; // brattere enn 25 %

export function parseGpx(xml) {
  const points = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[2];
    const inner = m[3] ?? "";
    const lat = Number(/lat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = /<ele>([^<]+)<\/ele>/.exec(inner)?.[1];
    const time = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
    points.push({
      lat,
      lon,
      ele: ele !== undefined ? Number(ele) : null,
      time: time ? Date.parse(time) : null,
    });
  }
  return points;
}

function distance(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Punkter med jevn avstand langs ruten, med GPS-høyde interpolert.
function resample(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  const total = cumulative.at(-1);
  const result = [];
  let j = 0;
  for (let d = 0; d < total; d += STEP_M) {
    while (j < points.length - 2 && cumulative[j + 1] < d) j++;
    const a = points[j];
    const b = points[j + 1];
    const t = cumulative[j + 1] > cumulative[j] ? (d - cumulative[j]) / (cumulative[j + 1] - cumulative[j]) : 0;
    result.push({
      d,
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * t : null,
    });
  }
  const last = points.at(-1);
  result.push({ d: total, lat: last.lat, lon: last.lon, ele: last.ele });
  return result;
}

async function fetchKartverket(points) {
  const elevations = [];
  for (let i = 0; i < points.length; i += KARTVERKET_MAX_POINTS) {
    const chunk = points.slice(i, i + KARTVERKET_MAX_POINTS);
    const url = new URL(KARTVERKET_URL);
    url.searchParams.set("koordsys", "4258");
    url.searchParams.set("geojson", "false");
    url.searchParams.set(
      "punkter",
      JSON.stringify(chunk.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]))
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Kartverket svarte ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.punkter) || data.punkter.length !== chunk.length) {
      throw new Error("Uventet svar fra Kartverket");
    }
    for (const p of data.punkter) {
      if (typeof p.z !== "number") throw new Error("Kartverket mangler høyde for et punkt");
      elevations.push(p.z);
    }
  }
  return elevations;
}

// Kartverket-høyder fra cache, eller hentet og lagret. null hvis ikke tilgjengelig.
async function kartverketElevations(cacheKey, gpxText, points) {
  // Linjeskift normaliseres, så nøkkelen blir lik på Windows (CRLF) og i CI (LF).
  // "steg=" står igjen fra før engelske navn, så eksisterende cache fortsatt treffer.
  const hash = crypto.createHash("sha1").update(gpxText.replace(/\r\n/g, "\n")).update(`steg=${STEP_M}`).digest("hex");
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (cache.hash === hash && cache.elevations?.length === points.length) return cache.elevations;
  } catch {
    // ingen cache ennå
  }
  if (process.env.ELEVATIONS_OFFLINE) return null;
  try {
    const elevations = await fetchKartverket(points);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ source: "Kartverket", fetched: new Date().toISOString(), hash, elevations }) + "\n"
    );
    return elevations;
  } catch (err) {
    console.warn(`[gpx] Fikk ikke høyder fra Kartverket for ${cacheKey}: ${err.message}. Bruker GPS-høyde.`);
    return null;
  }
}

// Bevegelsestid fra tidsstempler (uten pauser), rundet til 5 min. null hvis GPX mangler tid.
function movingTime(points) {
  if (points.length < 2 || points.some((p) => p.time === null)) return null;
  let seconds = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].time - points[i - 1].time) / 1000;
    if (dt <= 0) continue;
    const speed = distance(points[i - 1], points[i]) / dt;
    if (speed >= 0.2 && speed <= 4) seconds += dt;
  }
  if (!seconds) return null;
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

export async function processRoute(dir, siteId, file) {
  const gpxText = fs.readFileSync(path.join(dir, file), "utf8");
  const raw = parseGpx(gpxText);
  if (raw.length < 2) throw new Error(`${siteId}/${file} har færre enn to punkter`);

  const points = resample(raw);
  // Filnavnet inneholder stedets id (<id>-route.gpx), så det er unikt på tvers av steder.
  const cacheKey = file.replace(/\.gpx$/i, "");
  const kv = await kartverketElevations(cacheKey, gpxText, points);
  let elevationSource = null;
  if (kv) {
    points.forEach((p, i) => (p.ele = kv[i]));
    elevationSource = "Kartverket";
  } else if (points.every((p) => p.ele !== null)) {
    elevationSource = "GPS";
  }

  const length = points.at(-1).d;
  const result = {
    file,
    lengthKm: length / 1000,
    elevationSource,
    movingTimeMin: movingTime(raw),
    line: raw.map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]),
    profile: null,
  };
  if (!elevationSource) return result;

  // Stigning over et vindu på ca. ±20 m, så enkeltpunkter ikke gir falske topper.
  const k = 2;
  const grade = points.map((_, i) => {
    const a = points[Math.max(0, i - k)];
    const b = points[Math.min(points.length - 1, i + k)];
    return b.d > a.d ? (b.ele - a.ele) / (b.d - a.d) : 0;
  });

  // Stigning med hysterese på 3 m, så støy i høydedata ikke summeres opp.
  let gain = 0;
  let ref = points[0].ele;
  for (const p of points) {
    if (p.ele > ref + 3) { gain += p.ele - ref; ref = p.ele; }
    else if (p.ele < ref - 3) ref = p.ele;
  }

  let steepM = 0;
  for (let i = 1; i < points.length; i++) {
    const g = (grade[i] + grade[i - 1]) / 2;
    if (Math.abs(g) > STEEP) steepM += points[i].d - points[i - 1].d;
  }

  const eles = points.map((p) => p.ele);
  result.elevationGain = gain;
  result.fromMasl = points[0].ele;
  result.toMasl = points.at(-1).ele;
  result.minMasl = Math.min(...eles);
  result.maxMasl = Math.max(...eles);
  result.steepM = steepM;
  // [avstand m, høyde moh, lat, lon, stigning %]
  result.profile = points.map((p, i) => [
    Math.round(p.d),
    Math.round(p.ele * 10) / 10,
    Number(p.lat.toFixed(6)),
    Number(p.lon.toFixed(6)),
    Math.round(grade[i] * 100),
  ]);
  return result;
}
