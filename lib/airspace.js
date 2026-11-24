// Luftrom rundt hver start, fra openAIP (https://www.openaip.net, CC BY-NC 4.0).
// Hentes med `npm run airspace` og lagres i src/_data/cache/airspace/<id>.json. Skriver aldri til flystedsfilene.

import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.core.openaip.net/api/airspaces";
export const CACHE_DIR = path.resolve("src/_data/cache/airspace");
// Luftrom innenfor denne avstanden fra start regnes som i nærheten.
export const NEARBY_KM = 10;
// Luftrom med gulv over dette er uten betydning for paraglidere og speedglidere.
const MAX_LOWER_FT = 10000;

// Typekoder fra API-spesifikasjonen til openAIP. Bare typene som betyr noe for oss, er med.
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

// Omtrentlig gulv i fot over havet. Brukes bare til å sile bort høye luftrom.
function lowerFeet(l) {
  if (!l) return 0;
  if (l.unit === "FL") return l.value * 100;
  if (l.unit === "M") return l.value / 0.3048;
  return l.value;
}

// "EVENES TMA" -> "Evenes TMA". Forkortelser og koder (TMA, EN-D474, ENT740) beholdes.
// "NOTAM" fjernes fra navnet, siden det vises som en egen merknad (byNotam).
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

// Avstand i km fra punktet til nærmeste kant. Flat tilnærming, god nok innenfor noen titalls km.
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
      await new Promise((r) => setTimeout(r, 20000 * i)); // openAIP begrenser antall forespørsler
      continue;
    }
    // openAIP sier hvorfor i svaret (en utløpt eller tilbakekalt nøkkel gir 401 eller 403), så det tas med i feilen.
    // En HTML-side med /cdn-cgi/ er Cloudflare foran openAIP som stopper forespørselen før den kommer fram. Fra
    // november 2026 gjør openAIP det med de geografiske søkene den har stengt for alle (pos/dist, bbox); da er ikke
    // nøkkelen problemet (docs/operations.md «Luftrom»).
    const body = await response.text().catch(() => "");
    if (/cdn-cgi|<!doctype html/i.test(body)) {
      throw new Error(`openAIP svarte ${response.status} fra Cloudflare foran openAIP: forespørselen ble stoppet før den kom fram, ikke på grunn av nøkkelen. Det skjer med søk openAIP har stengt for eksterne klienter (pos/dist og bbox fra november 2026); se openaip.net/blog for om noe mer er stengt.`);
    }
    const why = body.replace(/\s+/g, " ").trim().slice(0, 300);
    const hint = response.status === 401 || response.status === 403 ? " Sjekk at OPENAIP_API_KEY fortsatt er gyldig (openaip.net → API clients)." : "";
    throw new Error(`openAIP svarte ${response.status}${why ? `: ${why}` : ""}.${hint}`);
  }
}

// Alle relevante luftrom i ett land (ISO-kode, f.eks. "NO"), side for side. openAIP slo av de geografiske søkene
// (`pos`/`dist` og `bbox`) for eksterne klienter i november 2026 («Geospatial query for external clients no longer
// available» på openaip.net/blog): de får 403 fra Cloudflare uansett nøkkel. Derfor hentes hele landet, og området
// rundt flystedene velges ut her (withinCircles).
export async function fetchCountry(country, apiKey) {
  const types = Object.keys(TYPES).map((t) => `type=${t}`).join("&");
  const items = [];
  for (let page = 1; ; page++) {
    const data = await fetchWithRetry(`${API_URL}?country=${encodeURIComponent(country)}&limit=1000&page=${page}&${types}`, apiKey);
    items.push(...(data.items ?? []));
    const more = data.nextPage || (data.totalPages && page < data.totalPages);
    if (!more || !data.items?.length) break;
  }
  return items.filter((a) => TYPES[a.type] && lowerFeet(limit(a.lowerLimit)) < MAX_LOWER_FT);
}

// openAIP slår sammen deler som IPPC nummererer hver for seg. Nøkkel: navnet i openAIP og gulvet i fot.
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
    // Militære øvingsområder (ENT…) og reserverte områder er bare aktive når de er kunngjort, som
    // ENT739 Grytøya sør i NOTAM A/8377/26. openAIP merker dem ikke, så typen avgjør.
    byNotam: Boolean(a.byNotam || a.onDemand || /\bNOTAM\b/i.test(a.name) || [8, 9, 25].includes(a.type)),
  };
}

// Luftrommene som ligger i eller går inn i noen av sirklene ({ center: { lat, lon }, radiusKm }): det det geografiske
// søket ga før, nå valgt ut fra hentingen av hele landet.
export function withinCircles(items, circles) {
  return items.filter((a) => {
    const polygons = rings(a.geometry);
    return circles.some(({ center, radiusKm }) => {
      const point = [center.lon, center.lat];
      return polygons.some((r) => pointInRing(point, r) || distanceToRingKm(point, r) <= radiusKm);
    });
  });
}

// Luftrom over og nær en start, sortert: over start først, deretter etter avstand.
export function airspaceForLaunch(items, lat, lon) {
  const point = [lon, lat];
  return items
    .map((a) => {
      const polygons = rings(a.geometry);
      const overLaunch = polygons.some((r) => pointInRing(point, r));
      const distanceKm = overLaunch ? 0 : Math.min(...polygons.map((r) => distanceToRingKm(point, r)));
      const { byNotam, ...rest } = describe(a);
      // Samme rekkefølge på feltene som før, så differ i cache-filene bare viser reelle endringer.
      return { ...rest, overLaunch, distanceKm: Math.round(distanceKm * 10) / 10, byNotam };
    })
    .filter((a) => a.overLaunch || a.distanceKm <= NEARBY_KM)
    // Over start først, så nærmest. Ved likhet avgjør navn og nedre grense, så rekkefølgen (og diffen i den månedlige
    // PR-en) ikke avhenger av rekkefølgen openAIP tilfeldigvis gir dem i.
    .sort((a, b) => Number(b.overLaunch) - Number(a.overLaunch) || a.distanceKm - b.distanceKm ||
      String(a.name).localeCompare(String(b.name), "nb") || (a.lower?.value ?? 0) - (b.lower?.value ?? 0));
}

// Luftrommene som GeoJSON for kartlaget. Koordinatene rundes av til 4 desimaler (omtrent 10 m) så filen blir liten.
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

// Laveste faste luftrom over start: det som begrenser hvor høyt du kan fly fra start uten klarering.
// Områder som bare er aktive ved NOTAM, er utelatt; siden viser dem for seg.
// Gir { airspace, fromGround, masl, aboveLaunch } eller null.
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

// Navn og merknad fra `airspace` i flystedsfilen går foran openAIP når type og gulv stemmer.
// openAIP kaller for eksempel både TMA1 og TMA2 ved Evenes bare "Evenes TMA", mens IPPC skiller dem.
// En oppføring uten type og gulv (bare navn og merknad) treffer luftrommet med samme navn.
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

// Når luftrommet sist ble sjekket mot openAIP (checked.json, skrives av hver vellykkede `npm run airspace`,
// også når ingenting endret seg). `fetched` i hvert flysteds fil er når luftrommet der sist endret seg.
// Det ventes en sjekk hver måned; etter AIRSPACE_STALE_DAYS varsler flystedssiden (site.njk og site.js).
export const AIRSPACE_STALE_DAYS = 45;
export const CHECKED_FILE = "checked.json";

export function readAirspaceChecked() {
  try {
    const { checked } = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, CHECKED_FILE), "utf8"));
    return /^\d{4}-\d{2}-\d{2}$/.test(checked) ? checked : null;
  } catch {
    return null;
  }
}

// Dager fra `checked` (YYYY-MM-DD) til `now`; null uten dato.
export function airspaceAgeDays(checked, now = Date.now()) {
  if (!checked) return null;
  return Math.floor((now - Date.parse(`${checked}T00:00:00Z`)) / 86400000);
}

export function readCachedAirspace(siteId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${siteId}.json`), "utf8"));
  } catch {
    return null;
  }
}
