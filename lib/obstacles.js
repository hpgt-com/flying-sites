// Kraftlinjer og andre hindre rundt flystedene, for kartlaget «Kraftlinjer og hindre»: luftlinjene og mastene deres
// fra NVE (Nettanlegg: sentral-, regional- og distribusjonsnett, 22 kV og opp; NLOD), vindturbinene fra NVE
// (Vindkraft), og fra OpenStreetMap det NVE ikke har: lavspentlinjer (power=minor_line), skitrekk og andre
// taubaner, og kommunikasjonsmaster (ODbL). Hentes av scripts/update-obstacles.mjs for hele området rundt flystedene
// (regionBox), unntatt mastene og stolpene fra NVE, som er mange og bare hentes nær flystedene (siteBox). Lagres som
// ruter på TILE_LAT × TILE_LON grader med en indeks, så kartet bare laster det det viser; skrives aldri til
// flystedsfilene. Ikke komplett: lavspent er i OpenStreetMap bare der noen har tegnet det, og vaiere som ikke er
// kraftlinjer (som bardunene til en mast), finnes i ingen av dem. Testes i test/obstacles.test.js.

export const NVE_GRID = "https://kart.nve.no/enterprise/rest/services/Nettanlegg4/MapServer";
export const NVE_WIND = "https://kart.nve.no/enterprise/rest/services/Vindkraft2/MapServer";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
// Indeksen (index.json) og rutene (tiles/<name>.geojson).
export const OUT_DIR = "src/_data/cache/obstacles";
// Hvor langt fra startene og landingene mastene og stolpene hentes.
export const MARGIN_M = 1500;
// Hvor langt rundt flystedene alt annet hentes, for turene bort fra dem.
export const REGION_MARGIN_M = 25000;
// Størrelsen på en rute i grader: omtrent 28 × 20 km så langt nord.
export const TILE_LAT = 0.25;
export const TILE_LON = 0.5;

// Lagene fra NVE: de tre nettnivåene som linjer, mastene og stolpene (bare nær flystedene) og vindturbinene.
export const NVE_LAYERS = [
  { service: NVE_GRID, layer: 0, kind: "power" },
  { service: NVE_GRID, layer: 1, kind: "power" },
  { service: NVE_GRID, layer: 2, kind: "power" },
  { service: NVE_GRID, layer: 4, kind: "pylon", nearSites: true },
  { service: NVE_WIND, layer: 4, kind: "wind" },
];
// Taubaner i OpenStreetMap som henger i lufta (ikke stasjoner, master, rullebånd eller trekk langs bakken). «yes» er
// en bane eller et taug ingen har sagt mer om, som gamle varetaug i Lofoten.
const AERIAL = ["cable_car", "gondola", "mixed_lift", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "zip_line", "goods", "yes"];

const round = (n) => Math.round(n * 1e5) / 1e5;
const rad = Math.PI / 180;

// Området som hentes rundt et flysted: startene og landingene med MARGIN_M rundt. { s, w, n, e } i grader.
export function siteBox(data, margin = MARGIN_M) {
  const pts = [data.launch, ...(data.launches ?? []), ...(data.landings ?? [])].filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pts.length) return null;
  const dLat = margin / 111320, dLon = margin / (111320 * Math.cos(pts[0].lat * rad));
  return {
    s: round(Math.min(...pts.map((p) => p.lat)) - dLat), n: round(Math.max(...pts.map((p) => p.lat)) + dLat),
    w: round(Math.min(...pts.map((p) => p.lon)) - dLon), e: round(Math.max(...pts.map((p) => p.lon)) + dLon),
  };
}

// Regionen: boksene til alle flystedene med REGION_MARGIN_M rundt, ut til hele ruter. { s, w, n, e } i grader.
export function regionBox(boxes, margin = REGION_MARGIN_M) {
  if (!boxes.length) return null;
  const s = Math.min(...boxes.map((b) => b.s)), n = Math.max(...boxes.map((b) => b.n));
  const dLat = margin / 111320, dLon = margin / (111320 * Math.cos(((s + n) / 2) * rad));
  return {
    s: Math.floor((s - dLat) / TILE_LAT) * TILE_LAT, n: Math.ceil((n + dLat) / TILE_LAT) * TILE_LAT,
    w: Math.floor((Math.min(...boxes.map((b) => b.w)) - dLon) / TILE_LON) * TILE_LON,
    e: Math.ceil((Math.max(...boxes.map((b) => b.e)) + dLon) / TILE_LON) * TILE_LON,
  };
}

// Navnet på ruten en posisjon ligger i: rad og kolonne talt fra 0° («274_32» er 68.5–68.75° N og 16–16.5° Ø).
// Kartet regner ut de samme navnene (addObstacleLayer i common.js).
export function tileKey(lat, lon) {
  return `${Math.floor(lat / TILE_LAT)}_${Math.floor(lon / TILE_LON)}`;
}

// Rutene et objekt ligger i. For en linje: hver rute hvert linjestykke kan krysse, så en linje mellom to ruter
// er i begge.
export function featureTiles(geometry) {
  const keys = new Set();
  const lines = geometry.type === "Point" ? [[geometry.coordinates]] : geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[i + 1] ?? a;
      const r0 = Math.floor(Math.min(a[1], b[1]) / TILE_LAT), r1 = Math.floor(Math.max(a[1], b[1]) / TILE_LAT);
      const c0 = Math.floor(Math.min(a[0], b[0]) / TILE_LON), c1 = Math.floor(Math.max(a[0], b[0]) / TILE_LON);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) keys.add(`${r}_${c}`);
    }
  }
  return [...keys];
}

// Spørringen for ett lag fra NVE innenfor en boks: objektene med posisjon i WGS84, én side fra offset (NVE gir
// maks 2000 per svar), i fast rekkefølge så sidene ikke overlapper.
export function nveQueryUrl({ service, layer }, box, offset = 0) {
  const p = new URLSearchParams({
    f: "json", where: "1=1", geometry: `${box.w},${box.s},${box.e},${box.n}`, geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true",
    orderByFields: "objectid", resultOffset: String(offset), resultRecordCount: "2000",
  });
  return `${service}/${layer}/query?${p}`;
}

// GeoJSON-objektene fra ett svar fra NVE. Linjer som ikke går i lufta (objekttype annet enn EL_Luftlinje), utelates,
// så en kabel i bakken aldri vises som et hinder.
export function nveFeatures(body, { service, layer, kind }) {
  if (body?.error) throw new Error(`NVE: ${body.error.message ?? "feil"}`);
  const out = [];
  for (const f of body?.features ?? []) {
    const a = f.attributes ?? {}, g = f.geometry ?? {};
    if (kind === "power" && a.objekttype && a.objekttype !== "EL_Luftlinje") continue;
    // Bare vindturbiner i drift (status D), ikke planlagte.
    if (kind === "wind" && a.status && a.status !== "D") continue;
    const id = `nve/${service === NVE_WIND ? "wind" : "grid"}/${layer}/${a.objectid ?? a.OBJECTID}`;
    const props = { kind, src: "nve" };
    if (Number.isFinite(a.spenning_kv)) props.kv = a.spenning_kv;
    // Eieren på linjene (mastene er mange, og tilhører eieren av linjen).
    if (a.eier && kind === "power") props.owner = a.eier;
    if (Number.isFinite(a.mastehoyde_m) && a.mastehoyde_m > 0) props.height = a.mastehoyde_m;
    if (kind === "wind" && a.anleggnavn) props.name = a.anleggnavn;
    let geometry = null;
    if (g.paths?.length) {
      const lines = g.paths.map((path) => path.map(([x, y]) => [round(x), round(y)]));
      geometry = lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };
    } else if (Number.isFinite(g.x) && Number.isFinite(g.y)) {
      geometry = { type: "Point", coordinates: [round(g.x), round(g.y)] };
    }
    if (geometry) out.push({ type: "Feature", id, properties: props, geometry });
  }
  return out;
}

// Én Overpass-spørring for alle boksene: lavspentlinjer, taubaner og kommunikasjonsmaster.
export function overpassQuery(boxes) {
  const parts = boxes.flatMap(({ s, w, n, e }) => {
    const b = `(${s},${w},${n},${e})`;
    return [`way["power"="minor_line"]${b};`, `way["aerialway"~"^(${AERIAL.join("|")})$"]${b};`, `nwr["man_made"~"^(mast|tower)$"]["tower:type"="communication"]${b};`, `nwr["man_made"="mast"][!"tower:type"]${b};`];
  });
  return `[out:json][timeout:90];(${parts.join("")});out tags geom;`;
}

// GeoJSON-objektene fra svaret fra Overpass.
export function osmFeatures(body) {
  const out = [];
  for (const el of body?.elements ?? []) {
    const tags = el.tags ?? {};
    let kind = null;
    if (tags.power === "minor_line") kind = "minor";
    else if (AERIAL.includes(tags.aerialway)) kind = "aerialway";
    else if (tags.man_made === "mast" || tags.man_made === "tower") kind = "mast";
    if (!kind) continue;
    const props = { kind, src: "osm" };
    if (kind === "aerialway") props.sub = tags.aerialway;
    if (tags.name) props.name = tags.name;
    if (tags.operator) props.owner = tags.operator;
    if (tags.height && Number.isFinite(parseFloat(tags.height))) props.height = parseFloat(tags.height);
    let geometry = null;
    if (el.type === "node" && Number.isFinite(el.lat)) geometry = { type: "Point", coordinates: [round(el.lon), round(el.lat)] };
    else if (el.type === "way" && el.geometry?.length) {
      const line = el.geometry.map((p) => [round(p.lon), round(p.lat)]);
      // En mast tegnet som omriss (en lukket way) vises som et punkt midt i.
      geometry = kind === "mast"
        ? { type: "Point", coordinates: [round(line.reduce((s, c) => s + c[0], 0) / line.length), round(line.reduce((s, c) => s + c[1], 0) / line.length)] }
        : { type: "LineString", coordinates: line };
    } else if (el.type === "relation" && el.bounds) {
      geometry = { type: "Point", coordinates: [round((el.bounds.minlon + el.bounds.maxlon) / 2), round((el.bounds.minlat + el.bounds.maxlat) / 2)] };
    }
    if (geometry) out.push({ type: "Feature", id: `osm/${el.type}/${el.id}`, properties: props, geometry });
  }
  return out;
}

// Objektene én gang hver (samme mast kan ligge i boksene til flere flysteder), sortert etter id så filene bare endres
// når dataene gjør det.
export function dedupe(features) {
  const byId = new Map();
  for (const f of features) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Rutene: objektene i hver rute (hvert én gang, sortert), etter navnet på ruten i rekkefølge. Tomme ruter utelates.
export function obstacleTiles(features) {
  const tiles = new Map();
  for (const f of dedupe(features)) {
    for (const key of featureTiles(f.geometry)) {
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(f);
    }
  }
  return new Map([...tiles].sort(([a], [b]) => (a < b ? -1 : 1)));
}

// Indeksen kartet leser først: datoen dataene ble hentet, hvilke kilder som er med (kreditering på kartet),
// størrelsen på rutene og hvilke ruter som finnes.
export function obstaclesIndex(tiles, { fetched, sources }) {
  return { fetched, sources, tileLat: TILE_LAT, tileLon: TILE_LON, tiles: [...tiles.keys()] };
}

// Antall per slag, til utskriften fra skriptet og teksten i PR-en.
export function summary(features) {
  const n = {};
  for (const f of features) n[f.properties.kind] = (n[f.properties.kind] ?? 0) + 1;
  return n;
}
