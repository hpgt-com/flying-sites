// Fetches airspace from openAIP for the whole region and saves:
//   src/_data/cache/airspace/<id>.json   airspace over and near each launch (used on the site page)
//   src/_data/cache/airspace/region.geojson   all airspace as polygons (used by the map layer)
//
//   OPENAIP_API_KEY=... npm run airspace
//
// The key is created on openaip.net and must never be committed. On GitHub it is a repository secret.
// The script never writes to the site files. Changes show up in the Git diff and are reviewed before publishing.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fetchRegion, airspaceForLaunch, regionGeoJSON, CACHE_DIR, NEARBY_KM } from "../lib/airspace.js";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES_DIR = "src/sites";
// Margin around the sites, so the map also shows airspace some way beyond them (Lofoten, Bardufoss etc.).
const MARGIN_KM = 60;

const apiKey = process.env.OPENAIP_API_KEY;
if (!apiKey) {
  console.error("Mangler OPENAIP_API_KEY. Sett den som miljøvariabel før du kjører skriptet.");
  process.exit(1);
}

const sites = fs.readdirSync(SITES_DIR)
  .filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")))
  .map((id) => {
    const text = fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8");
    return { id, data: yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]) };
  });

// Airspace is fetched in one or more circles that together cover all launches, plus margin. openAIP
// rejects too large a radius (216 km gave 400), so the sites in Lofoten, on Andøya and in Bjerkvik cannot be
// covered by one circle around the middle of the region. Each circle is centred on a launch and covers the
// launches within MAX_RADIUS_KM - MARGIN_KM. Usually this means 2–3 requests.
const MAX_RADIUS_KM = 150;
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const launches = sites.map((s) => s.data.launch);
const circles = [];
let left = [...launches];
while (left.length) {
  // Centre on the launch that covers most of the remaining ones.
  const reach = MAX_RADIUS_KM - MARGIN_KM;
  const center = left.reduce((best, l) => {
    const n = left.filter((o) => km(l, o) <= reach).length;
    return n > best.n ? { l, n } : best;
  }, { l: left[0], n: 0 }).l;
  const covered = left.filter((o) => km(center, o) <= reach);
  const radiusKm = Math.ceil(Math.max(...covered.map((o) => km(center, o))) + MARGIN_KM);
  circles.push({ center, radiusKm });
  left = left.filter((o) => !covered.includes(o));
}

const byId = new Map();
for (const { center, radiusKm } of circles) {
  console.log(`Henter luftrom innen ${radiusKm} km fra ${center.lat.toFixed(3)}, ${center.lon.toFixed(3)} …`);
  for (const a of await fetchRegion(center.lat.toFixed(5), center.lon.toFixed(5), radiusKm * 1000, apiKey)) {
    byId.set(a._id ?? JSON.stringify([a.name, a.geometry]), a);
  }
}
const items = [...byId.values()];
console.log(`${items.length} luftrom i regionen.`);

const describe = (a) =>
  `${a.name} (${a.type}${a.class ? ", klasse " + a.class : ""}, ${a.lower.value} ${a.lower.unit} ${a.lower.ref}` +
  `${a.overLaunch ? ", over start" : `, ${a.distanceKm} km unna`}${a.byNotam ? ", aktiveres ved NOTAM" : ""})`;

fs.mkdirSync(CACHE_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
for (const { id, data } of sites) {
  const { lat, lon } = data.launch;
  const airspaces = airspaceForLaunch(items, lat, lon);
  const file = path.join(CACHE_DIR, `${id}.json`);
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).airspaces : null;
  const unchanged = before && JSON.stringify(before) === JSON.stringify(airspaces);
  if (!unchanged) {
    const content = { source: "openAIP", fetched: today, nearbyKm: NEARBY_KM, launch: { lat, lon }, airspaces };
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  }
  console.log(`\n${data.name}: ${airspaces.length} luftrom${unchanged ? " (uendret)" : before ? " (ENDRET)" : " (ny)"}`);
  for (const a of airspaces) console.log(`  ${describe(a)}`);
}

// Sites that were removed or got a new id must not leave cache files behind.
for (const file of fs.readdirSync(CACHE_DIR)) {
  if (file.endsWith(".json") && !sites.some((s) => `${s.id}.json` === file)) {
    fs.unlinkSync(path.join(CACHE_DIR, file));
    console.log(`\nFjernet ${file} (stedet finnes ikke lenger).`);
  }
}

// The map layer. Only written when the content changed, so the date in the cache files does not add diff noise.
const geoFile = path.join(CACHE_DIR, "region.geojson");
const geo = regionGeoJSON(items);
const oldGeo = fs.existsSync(geoFile) ? JSON.parse(fs.readFileSync(geoFile, "utf8")) : null;
if (!oldGeo || JSON.stringify(oldGeo.features) !== JSON.stringify(geo.features)) {
  fs.writeFileSync(geoFile, JSON.stringify({ ...geo, source: "openAIP (CC BY-NC 4.0)", fetched: today }) + "\n");
  console.log(`\nKartlaget oppdatert: ${geo.features.length} luftrom.`);
}
