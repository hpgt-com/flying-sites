// Airspace around each launch, from openAIP (https://www.openaip.net, CC BY-NC 4.0).
// Fetched with `npm run airspace` and stored in src/_data/cache/airspace/<id>.json. Never writes to the site files.

import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.core.openaip.net/api/airspaces";
export const CACHE_DIR = path.resolve("src/_data/cache/airspace");
// Airspace within this distance of the launch counts as nearby.
export const NEARBY_KM = 10;
// Airspace with a floor above this is irrelevant for paragliders and speedgliders.
const MAX_LOWER_FT = 10000;

// Type codes from the openAIP API specification. Only the types that matter to us are included.
const TYPES = {
  1: { code: "R", label: "Restriksjonsområde" },
  2: { code: "D", label: "Fareområde" },
  3: { code: "P", label: "Forbudsområde" },
  4: { code: "CTR", label: "Kontrollsone" },
  5: { code: "TMZ", label: "Transponderpåbudt sone" },
  6: { code: "RMZ", label: "Radiopåbudt sone" },
  7: { code: "TMA", label: "Terminalområde" },
  8: { code: "TRA", label: "Midlertidig reservert område" },
  9: { code: "TSA", label: "Midlertidig segregert område" },
  13: { code: "ATZ", label: "Flyplassens trafikksone" },
  14: { code: "MATZ", label: "Militær trafikksone" },
  20: { code: "HTZ", label: "Helikoptertrafikksone" },
  23: { code: "TIZ", label: "Trafikkinformasjonssone" },
  24: { code: "TIA", label: "Trafikkinformasjonsområde" },
  25: { code: "MTA", label: "Militært øvings- og operasjonsområde" },
  26: { code: "CTA", label: "Kontrollområde" },
  28: { code: "ASRA", label: "Område for luftsport" },
  29: { code: "LAOR", label: "Begrensning for lav overflyging" },
  36: { code: "MCTR", label: "Militær kontrollsone" },
};
const CLASSES = ["A", "B", "C", "D", "E", "F", "G", null, null];
const UNITS = { 0: "M", 1: "FT", 6: "FL" };
const REFS = { 0: "GND", 1: "MSL", 2: "STD" };

function limit(l) {
  if (!l) return null;
  return { value: l.value, unit: UNITS[l.unit] ?? "?", ref: REFS[l.referenceDatum] ?? "?" };
}

// Approximate floor in feet above sea level, only used to filter out high airspace.
function lowerFeet(l) {
  if (!l) return 0;
  if (l.unit === "FL") return l.value * 100;
  if (l.unit === "M") return l.value / 0.3048;
  return l.value;
}

// "EVENES TMA" -> "Evenes TMA". Abbreviations and codes (TMA, EN-D474, ENT740) are kept.
// "NOTAM" is removed from the name, since it is shown as a separate note (byNotam).
function prettyName(name) {
  return name.split(" ")
    .filter((w) => w !== "NOTAM")
    .map((w) => (/^[A-ZÆØÅ]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function rings(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((p) => p[0]);
  return [];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Distance in km from the point to the nearest edge. Flat approximation, good enough within a few tens of km.
function distanceToRingKm([x, y], ring) {
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = (ring[i][0] - x) * kx, ay = (ring[i][1] - y) * ky;
    const bx = (ring[i + 1][0] - x) * kx, by = (ring[i + 1][1] - y) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

async function fetchWithRetry(url, apiKey, attempts = 4) {
  for (let i = 1; ; i++) {
    const response = await fetch(url, {
      headers: { "x-openaip-api-key": apiKey, "user-agent": "hpgt-flysteder (https://flysteder.hpgt.com)" },
      signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.json();
    if (response.status === 429 && i < attempts) {
      await new Promise((r) => setTimeout(r, 20000 * i)); // openAIP is rate-limited
      continue;
    }
    throw new Error(`openAIP svarte ${response.status}`);
  }
}

// All relevant airspace in a circle around the region, in one or a few requests. openAIP has a strict
// rate limit, so querying per launch took about 40 seconds per site.
export async function fetchRegion(lat, lon, radiusM, apiKey) {
  const types = Object.keys(TYPES).map((t) => `type=${t}`).join("&");
  const items = [];
  for (let page = 1; ; page++) {
    const data = await fetchWithRetry(`${API_URL}?pos=${lat},${lon}&dist=${radiusM}&limit=1000&page=${page}&${types}`, apiKey);
    items.push(...(data.items ?? []));
    const more = data.nextPage || (data.totalPages && page < data.totalPages);
    if (!more || !data.items?.length) break;
  }
  return items.filter((a) => TYPES[a.type] && lowerFeet(limit(a.lowerLimit)) < MAX_LOWER_FT);
}

// openAIP merges parts that IPPC numbers separately. Key: openAIP name and floor in feet.
const IPPC_NAMES = {
  "EVENES TMA": { 4500: "Evenes TMA1", 2500: "Evenes TMA2" },
};

function displayName(a) {
  return IPPC_NAMES[a.name]?.[a.lowerLimit?.value] ?? prettyName(a.name);
}

function describe(a) {
  return {
    name: displayName(a),
    type: TYPES[a.type].code,
    typeLabel: TYPES[a.type].label,
    class: CLASSES[a.icaoClass] ?? null,
    lower: limit(a.lowerLimit),
    upper: limit(a.upperLimit),
    // Military training areas (ENT…) and reserved areas are only active when announced, like
    // ENT739 Grytøya sør in NOTAM A/8377/26. openAIP does not flag them, so the type decides.
    byNotam: Boolean(a.byNotam || a.onDemand || /\bNOTAM\b/i.test(a.name) || [8, 9, 25].includes(a.type)),
  };
}

// Airspace over and near a launch, sorted: over the launch first, then by distance.
export function airspaceForLaunch(items, lat, lon) {
  const point = [lon, lat];
  return items
    .map((a) => {
      const polygons = rings(a.geometry);
      const overLaunch = polygons.some((r) => pointInRing(point, r));
      const distanceKm = overLaunch ? 0 : Math.min(...polygons.map((r) => distanceToRingKm(point, r)));
      const { byNotam, ...rest } = describe(a);
      // Same field order as before, so diffs in the cache files only show real changes.
      return { ...rest, overLaunch, distanceKm: Math.round(distanceKm * 10) / 10, byNotam };
    })
    .filter((a) => a.overLaunch || a.distanceKm <= NEARBY_KM)
    .sort((a, b) => Number(b.overLaunch) - Number(a.overLaunch) || a.distanceKm - b.distanceKm);
}

// The airspace as GeoJSON for the map layer. Coordinates are rounded to 4 decimals (about 10 m) to keep the file small.
export function regionGeoJSON(items) {
  const round = (c) => (typeof c[0] === "number" ? [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] : c.map(round));
  return {
    type: "FeatureCollection",
    features: items.map((a) => ({
      type: "Feature",
      properties: describe(a),
      geometry: { type: a.geometry.type, coordinates: round(a.geometry.coordinates) },
    })),
  };
}

// Lowest permanent airspace over the launch: what limits how high you can fly from launch without clearance.
// Areas only active by NOTAM are excluded; the page shows them separately.
// Returns { airspace, fromGround, masl, aboveLaunch } or null.
export function ceilingOverLaunch(airspaces, launchMasl) {
  const fixed = (airspaces ?? []).filter((a) => a.overLaunch && !a.byNotam);
  const ground = fixed.find((a) => a.lower?.ref === "GND" && !a.lower.value);
  if (ground) return { airspace: ground, fromGround: true, masl: null, aboveLaunch: null };
  const withMasl = fixed
    .filter((a) => a.lower?.ref === "MSL")
    .map((a) => ({ airspace: a, masl: Math.round(a.lower.unit === "M" ? a.lower.value : a.lower.value * 0.3048) }))
    .sort((x, y) => x.masl - y.masl);
  if (!withMasl.length) return null;
  const { airspace, masl } = withMasl[0];
  return { airspace, fromGround: false, masl, aboveLaunch: launchMasl != null ? masl - launchMasl : null };
}

// Name and note from the site file's `airspace` override openAIP when type and floor match.
// For example, openAIP calls both TMA1 and TMA2 at Evenes just "Evenes TMA", while IPPC separates them.
// An entry without type and floor (only name and note) matches the airspace with the same name.
export function applyManualAirspace(airspaces, manual) {
  const sameName = (m, a) => m.name && a.name && m.name.toLowerCase() === a.name.toLowerCase();
  return (airspaces ?? []).map((a) => {
    const match = (manual ?? []).filter(Boolean).find((m) => m.type
      ? (m.type ?? "").toUpperCase() === a.type &&
        m.lower?.value === a.lower?.value &&
        (m.lower?.unit ?? "").toUpperCase() === a.lower?.unit
      : sameName(m, a));
    return match ? { ...a, name: match.name ?? a.name, note: match.note ?? null } : a;
  });
}

export function readCachedAirspace(siteId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${siteId}.json`), "utf8"));
  } catch {
    return null;
  }
}
