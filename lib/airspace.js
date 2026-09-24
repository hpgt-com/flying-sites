// Luftrom rundt hver start fra openAIP (https://www.openaip.net, CC BY-NC 4.0).
// Hentes med `npm run airspace` og lagres i src/_data/cache/airspace/<id>.json. Skriver aldri i stedsfilene.

import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.core.openaip.net/api/airspaces";
export const CACHE_DIR = path.resolve("src/_data/cache/airspace");
const SEARCH_RADIUS_M = 15000;
// Luftrom innen denne avstanden fra starten regnes som nærliggende.
export const NEARBY_KM = 10;
// Luftrom som starter høyere enn dette, er uinteressant for paraglider og speedglider.
const MAX_LOWER_FT = 10000;

// Typekoder fra openAIPs API-spesifikasjon. Bare typene som betyr noe for oss, er med.
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

// Omtrentlig nedre grense i fot over havet, bare for å sortere bort høye luftrom.
function lowerFeet(l) {
  if (!l) return 0;
  if (l.unit === "FL") return l.value * 100;
  if (l.unit === "M") return l.value / 0.3048;
  return l.value;
}

// "EVENES TMA" -> "Evenes TMA". Forkortelser og koder (TMA, EN-D474, ENT740) beholdes.
// «NOTAM» i navnet fjernes, siden det vises som egen merknad (byNotam).
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

// Avstand i km fra punktet til nærmeste kant. Flat tilnærming, god nok innenfor noen mil.
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
      await new Promise((r) => setTimeout(r, 20000 * i)); // openAIP har fartsgrense
      continue;
    }
    throw new Error(`openAIP svarte ${response.status}`);
  }
}

// Luftrom over og nær starten, ferdig sortert: over starten først, så etter avstand.
export async function fetchAirspace(lat, lon, apiKey) {
  const url = `${API_URL}?pos=${lat},${lon}&dist=${SEARCH_RADIUS_M}&limit=200`;
  const data = await fetchWithRetry(url, apiKey);
  const point = [lon, lat];
  return (data.items ?? [])
    .filter((a) => TYPES[a.type])
    .map((a) => {
      const polygons = rings(a.geometry);
      const overLaunch = polygons.some((r) => pointInRing(point, r));
      const distanceKm = overLaunch ? 0 : Math.min(...polygons.map((r) => distanceToRingKm(point, r)));
      return {
        name: prettyName(a.name),
        type: TYPES[a.type].code,
        typeLabel: TYPES[a.type].label,
        class: CLASSES[a.icaoClass] ?? null,
        lower: limit(a.lowerLimit),
        upper: limit(a.upperLimit),
        overLaunch,
        distanceKm: Math.round(distanceKm * 10) / 10,
        // Militære øvingsområder (ENT…) og reserverte områder er bare aktive når de er varslet, som
        // ENT739 Grytøya sør i NOTAM A/8377/26. openAIP merker dem ikke, så typen avgjør.
        byNotam: Boolean(a.byNotam || a.onDemand || /\bNOTAM\b/i.test(a.name) || [8, 9, 25].includes(a.type)),
      };
    })
    .filter((a) => (a.overLaunch || a.distanceKm <= NEARBY_KM) && lowerFeet(a.lower) < MAX_LOWER_FT)
    .sort((a, b) => Number(b.overLaunch) - Number(a.overLaunch) || a.distanceKm - b.distanceKm);
}

// Laveste faste luftrom over starten: det som begrenser hvor høyt man kan fly fra start uten klarering.
// Områder som bare er aktive ved NOTAM, er ikke med. De vises for seg på siden.
// Returnerer { airspace, fromGround, masl, aboveLaunch } eller null.
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

export function readCachedAirspace(siteId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${siteId}.json`), "utf8"));
  } catch {
    return null;
  }
}
