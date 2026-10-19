// Power lines and other obstacles around the sites, for the map layer «Kraftlinjer og hindre»: the overhead power lines
// and their masts from NVE (Nettanlegg: transmission, regional and distribution grid, 22 kV and up; NLOD), the wind
// turbines from NVE (Vindkraft), and from OpenStreetMap what NVE does not have: low-voltage lines (power=minor_line),
// ski lifts and other aerial lifts, and communication masts (ODbL). Fetched by scripts/update-obstacles.mjs for the
// whole region around the sites (regionBox), except NVE's masts and poles, which are many and only fetched near the
// sites (siteBox). Saved as tiles of TILE_LAT × TILE_LON degrees with an index, so the map only loads what it shows;
// never written to the site files. Not complete: low voltage is in OpenStreetMap only where someone has drawn it, and
// wires that are not power lines (such as a mast's guy wires) are in neither. Tested in test/obstacles.test.js.

export const NVE_GRID = "https://kart.nve.no/enterprise/rest/services/Nettanlegg4/MapServer";
export const NVE_WIND = "https://kart.nve.no/enterprise/rest/services/Vindkraft2/MapServer";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
// The index (index.json) and the tiles (tiles/<name>.geojson).
export const OUT_DIR = "src/_data/cache/obstacles";
// How far from the launches and landings the masts and poles are fetched.
export const MARGIN_M = 1500;
// How far around the sites everything else is fetched, for the flights away from them.
export const REGION_MARGIN_M = 25000;
// The size of a tile in degrees: about 28 × 20 km this far north.
export const TILE_LAT = 0.25;
export const TILE_LON = 0.5;

// The NVE layers: the three grid levels as lines, the masts and poles (only near the sites), and the wind turbines.
export const NVE_LAYERS = [
  { service: NVE_GRID, layer: 0, kind: "power" },
  { service: NVE_GRID, layer: 1, kind: "power" },
  { service: NVE_GRID, layer: 2, kind: "power" },
  { service: NVE_GRID, layer: 4, kind: "pylon", nearSites: true },
  { service: NVE_WIND, layer: 4, kind: "wind" },
];
// Aerial lifts in OpenStreetMap that hang in the air (not stations, pylons, magic carpets or ground lifts). «yes» is a
// lift or cable nobody has said more about, such as old cables for goods in Lofoten.
const AERIAL = ["cable_car", "gondola", "mixed_lift", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "zip_line", "goods", "yes"];

const round = (n) => Math.round(n * 1e5) / 1e5;
const rad = Math.PI / 180;

// The area to fetch around a site: its launches and landings with MARGIN_M around them. { s, w, n, e } in degrees.
export function siteBox(data, margin = MARGIN_M) {
  const pts = [data.launch, ...(data.launches ?? []), ...(data.landings ?? [])].filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pts.length) return null;
  const dLat = margin / 111320, dLon = margin / (111320 * Math.cos(pts[0].lat * rad));
  return {
    s: round(Math.min(...pts.map((p) => p.lat)) - dLat), n: round(Math.max(...pts.map((p) => p.lat)) + dLat),
    w: round(Math.min(...pts.map((p) => p.lon)) - dLon), e: round(Math.max(...pts.map((p) => p.lon)) + dLon),
  };
}

// The region: all the sites' boxes with REGION_MARGIN_M around them, out to whole tiles. { s, w, n, e } in degrees.
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

// The name of the tile a position lies in: its row and column counted from 0° («274_32» is 68.5–68.75° N and
// 16–16.5° E). The map works out the same names (addObstacleLayer in common.js).
export function tileKey(lat, lon) {
  return `${Math.floor(lat / TILE_LAT)}_${Math.floor(lon / TILE_LON)}`;
}

// The tiles a feature lies in. For a line, every tile each segment can cross, so a line between two tiles is in both.
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

// The query for one NVE layer inside a box: the features with their position in WGS84, one page from offset (NVE gives
// at most 2000 per answer), in a fixed order so the pages do not overlap.
export function nveQueryUrl({ service, layer }, box, offset = 0) {
  const p = new URLSearchParams({
    f: "json", where: "1=1", geometry: `${box.w},${box.s},${box.e},${box.n}`, geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true",
    orderByFields: "objectid", resultOffset: String(offset), resultRecordCount: "2000",
  });
  return `${service}/${layer}/query?${p}`;
}

// The GeoJSON features from one NVE answer. Lines that are not overhead (objekttype other than EL_Luftlinje) are left
// out, so a cable in the ground never shows as an obstacle.
export function nveFeatures(body, { service, layer, kind }) {
  if (body?.error) throw new Error(`NVE: ${body.error.message ?? "feil"}`);
  const out = [];
  for (const f of body?.features ?? []) {
    const a = f.attributes ?? {}, g = f.geometry ?? {};
    if (kind === "power" && a.objekttype && a.objekttype !== "EL_Luftlinje") continue;
    // Wind turbines in operation only (status D), not planned ones.
    if (kind === "wind" && a.status && a.status !== "D") continue;
    const id = `nve/${service === NVE_WIND ? "wind" : "grid"}/${layer}/${a.objectid ?? a.OBJECTID}`;
    const props = { kind, src: "nve" };
    if (Number.isFinite(a.spenning_kv)) props.kv = a.spenning_kv;
    // The owner on the lines (the masts are many, and belong to the line's owner).
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

// One Overpass query for all the boxes: low-voltage lines, aerial lifts and communication masts.
export function overpassQuery(boxes) {
  const parts = boxes.flatMap(({ s, w, n, e }) => {
    const b = `(${s},${w},${n},${e})`;
    return [`way["power"="minor_line"]${b};`, `way["aerialway"~"^(${AERIAL.join("|")})$"]${b};`, `nwr["man_made"~"^(mast|tower)$"]["tower:type"="communication"]${b};`, `nwr["man_made"="mast"][!"tower:type"]${b};`];
  });
  return `[out:json][timeout:90];(${parts.join("")});out tags geom;`;
}

// The GeoJSON features from the Overpass answer.
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
      // A mast drawn as an outline (a closed way) is shown as a point in its middle.
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

// The features once each (the same mast can lie in the boxes of several sites), sorted by id so the files only change
// when the data does.
export function dedupe(features) {
  const byId = new Map();
  for (const f of features) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The tiles: each tile's features (each once, sorted), by the tile's name in order. Tiles without features are left out.
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

// The index the map reads first: the date the data was fetched, which sources are in it (the map's attribution), the
// tile size and the tiles there are.
export function obstaclesIndex(tiles, { fetched, sources }) {
  return { fetched, sources, tileLat: TILE_LAT, tileLon: TILE_LON, tiles: [...tiles.keys()] };
}

// Counts per kind, for the script's output and the PR text.
export function summary(features) {
  const n = {};
  for (const f of features) n[f.properties.kind] = (n[f.properties.kind] ?? 0) + 1;
  return n;
}
