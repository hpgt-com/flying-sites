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

// Luftrommene hentes i én eller flere sirkler som til sammen dekker alle startene, pluss margin. openAIP
// avviser for stor radius (216 km ga 400), så stedene i Lofoten, på Andøya og i Bjerkvik kan ikke dekkes av
// én sirkel rundt midten av regionen. Hver sirkel har senter i en start og dekker startene innen
// MAX_RADIUS_KM - MARGIN_KM. Som regel blir det 2–3 kall.
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
  // Senter i starten som dekker flest av de gjenværende.
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

// Steder som er fjernet eller har fått ny id, skal ikke ha cache-filer liggende igjen.
for (const file of fs.readdirSync(CACHE_DIR)) {
  if (file.endsWith(".json") && !sites.some((s) => `${s.id}.json` === file)) {
    fs.unlinkSync(path.join(CACHE_DIR, file));
    console.log(`\nFjernet ${file} (stedet finnes ikke lenger).`);
  }
}

// Kartlaget. Skrives bare når innholdet er endret, så datoen i cache-filene ikke gir støy i diffen.
const geoFile = path.join(CACHE_DIR, "region.geojson");
const geo = regionGeoJSON(items);
const oldGeo = fs.existsSync(geoFile) ? JSON.parse(fs.readFileSync(geoFile, "utf8")) : null;
if (!oldGeo || JSON.stringify(oldGeo.features) !== JSON.stringify(geo.features)) {
  fs.writeFileSync(geoFile, JSON.stringify({ ...geo, source: "openAIP (CC BY-NC 4.0)", fetched: today }) + "\n");
  console.log(`\nKartlaget oppdatert: ${geo.features.length} luftrom.`);
}
