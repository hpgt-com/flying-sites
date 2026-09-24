// Henter luftrom fra openAIP for hele regionen og lagrer:
//   src/_data/cache/airspace/<id>.json   luftrom over og nær hver start (brukes på stedssiden)
//   src/_data/cache/airspace/region.geojson   alle luftrommene som polygoner (brukes av kartlaget)
//
//   OPENAIP_API_KEY=... npm run airspace
//
// Nøkkelen lages på openaip.net og skal aldri inn i repoet. I GitHub ligger den som repository secret.
// Skriptet skriver aldri i stedsfilene. Endringer vises i Git-diffen og gjennomgås før de publiseres.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fetchRegion, airspaceForLaunch, regionGeoJSON, CACHE_DIR, NEARBY_KM } from "../lib/airspace.js";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES_DIR = "src/flysteder";
// Margin rundt stedene, så kartet også viser luftrom et stykke utenfor (Lofoten, Bardufoss osv.).
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

// Sirkel som dekker alle startene, pluss margin.
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const launches = sites.map((s) => s.data.launch);
const center = {
  lat: launches.reduce((sum, l) => sum + l.lat, 0) / launches.length,
  lon: launches.reduce((sum, l) => sum + l.lon, 0) / launches.length,
};
const radiusKm = Math.ceil(Math.max(...launches.map((l) => km(center, l))) + MARGIN_KM);

console.log(`Henter luftrom innen ${radiusKm} km fra ${center.lat.toFixed(3)}, ${center.lon.toFixed(3)} …`);
const items = await fetchRegion(center.lat.toFixed(5), center.lon.toFixed(5), radiusKm * 1000, apiKey);
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

// Kartlaget. Skrives bare når innholdet er endret, så datoen i cache-filene ikke gir støy i diffen.
const geoFile = path.join(CACHE_DIR, "region.geojson");
const geo = regionGeoJSON(items);
const oldGeo = fs.existsSync(geoFile) ? JSON.parse(fs.readFileSync(geoFile, "utf8")) : null;
if (!oldGeo || JSON.stringify(oldGeo.features) !== JSON.stringify(geo.features)) {
  fs.writeFileSync(geoFile, JSON.stringify({ ...geo, source: "openAIP (CC BY-NC 4.0)", fetched: today }) + "\n");
  console.log(`\nKartlaget oppdatert: ${geo.features.length} luftrom.`);
}
