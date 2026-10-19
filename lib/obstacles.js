// Power lines and other obstacles around the sites, for the map layer «Kraftlinjer og hindre»: the overhead power lines
// and their masts from NVE (Nettanlegg: transmission, regional and distribution grid, 22 kV and up; NLOD), the wind
// turbines from NVE (Vindkraft), and from OpenStreetMap what NVE does not have: low-voltage lines (power=minor_line),
// ski lifts and other aerial lifts, and communication masts (ODbL). Fetched by scripts/update-obstacles.mjs around each
// site and saved as one GeoJSON file (OUT); never written to the site files. Not complete: low voltage is in
// OpenStreetMap only where someone has drawn it, and wires that are not power lines (such as a mast's guy wires) are
// in neither. Tested in test/obstacles.test.js.

export const NVE_GRID = "https://kart.nve.no/enterprise/rest/services/Nettanlegg4/MapServer";
export const NVE_WIND = "https://kart.nve.no/enterprise/rest/services/Vindkraft2/MapServer";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
export const OUT = "src/_data/cache/obstacles/region.geojson";
// How far from the launches and landings obstacles are fetched.
export const MARGIN_M = 1500;

// The NVE layers: the three grid levels as lines, the masts and poles, and the wind turbines.
export const NVE_LAYERS = [
  { service: NVE_GRID, layer: 0, kind: "power" },
  { service: NVE_GRID, layer: 1, kind: "power" },
  { service: NVE_GRID, layer: 2, kind: "power" },
  { service: NVE_GRID, layer: 4, kind: "pylon" },
  { service: NVE_WIND, layer: 4, kind: "wind" },
];
// Aerial lifts in OpenStreetMap that hang in the air (not stations, pylons, magic carpets or ground lifts).
const AERIAL = ["cable_car", "gondola", "mixed_lift", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "zip_line", "goods"];

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

// The query for one NVE layer inside a box: the features with their position in WGS84.
export function nveQueryUrl({ service, layer }, box) {
  const p = new URLSearchParams({
    f: "json", where: "1=1", geometry: `${box.w},${box.s},${box.e},${box.n}`, geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true",
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

// The features once each (the same line can lie in the boxes of several sites), sorted by id so the file only changes
// when the data does.
export function dedupe(features) {
  const byId = new Map();
  for (const f of features) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The file: the features with the date they were fetched and which sources are in it (the map's attribution).
export function obstaclesGeoJSON(features, { fetched, sources }) {
  return { type: "FeatureCollection", fetched, sources, features: dedupe(features) };
}

// Counts per kind, for the script's output and the PR text.
export function summary(features) {
  const n = {};
  for (const f of features) n[f.properties.kind] = (n[f.properties.kind] ?? 0) + 1;
  return n;
}
