// Henter luftrom fra openAIP for hele regionen og lagrer:
//   src/_data/cache/airspace/<id>.json   luftrom over og nær hver start (brukes på flystedssiden)
//   src/_data/cache/airspace/region.geojson   alle luftrom som polygoner (brukes av kartlaget)
//   src/_data/cache/airspace/checked.json     datoen for denne sjekken, skrives hver gang
//
//   OPENAIP_API_KEY=... npm run airspace
//
// Nøkkelen lages på openaip.net og skal aldri committes. På GitHub er den en repository secret.
// Skriptet skriver aldri til flystedsfilene. Endringer vises i diffen i Git og gås gjennom før publisering.

import fs from "node:fs";
import path from "node:path";
import { readSites } from "../lib/site-files.js";
import { fetchCountry, withinCircles, airspaceForLaunch, regionGeoJSON, CACHE_DIR, NEARBY_KM, CHECKED_FILE } from "../lib/airspace.js";

// Margin rundt flystedene, så kartet også viser luftrom et stykke utenfor dem (Lofoten, Bardufoss osv.).
const MARGIN_KM = 60;

const apiKey = process.env.OPENAIP_API_KEY;
if (!apiKey) {
  console.error("Mangler OPENAIP_API_KEY. Sett den som miljøvariabel før du kjører skriptet.");
  process.exit(1);
}

const sites = readSites();

// Regionen er én eller flere sirkler som til sammen dekker alle startene, pluss margin. Hver sirkel har sentrum i en
// start og dekker startene innenfor MAX_RADIUS_KM - MARGIN_KM. Luftrommene i landene i COUNTRIES hentes i sin helhet
// (openAIP tillater ikke lenger geografiske søk, se fetchCountry), og det som ligger innenfor en sirkel, beholdes.
const COUNTRIES = ["NO", "SE", "FI"]; // Sverige og Finland for luftrommene øst for flystedene (kartet viser 60 km utenfor dem)
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
  // Sentrum i starten som dekker flest av de gjenværende.
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
for (const country of COUNTRIES) {
  console.log(`Henter luftrom for ${country} …`);
  const all = await fetchCountry(country, apiKey);
  const near = withinCircles(all, circles);
  console.log(`  ${all.length} luftrom, ${near.length} innenfor regionen (${circles.map((c) => `${c.radiusKm} km`).join(", ")}).`);
  for (const a of near) byId.set(a._id ?? JSON.stringify([a.name, a.geometry]), a);
}
const items = [...byId.values()];
if (!items.length) {
  console.error("Fikk ingen luftrom fra openAIP. Stopper, så cachen ikke tømmes.");
  process.exit(1);
}
console.log(`${items.length} luftrom i regionen.`);

const describe = (a) =>
  `${a.name} (${a.type}${a.class ? ", klasse " + a.class : ""}, ${a.lower.value} ${a.lower.unit} ${a.lower.ref}` +
  `${a.overLaunch ? ", over start" : `, ${a.distanceKm} km unna`}${a.byNotam ? ", aktiveres ved NOTAM" : ""})`;

// Samme innhold, uansett rekkefølge: rekkefølgen fra openAIP er ikke fast, og en ny rekkefølge alene skal ikke telle
// som en endring (da ville dagens dato blitt «sist endret» på alle flystedene).
const sameSet = (a, b) => a.length === b.length &&
  JSON.stringify(a.map((x) => JSON.stringify(x)).sort()) === JSON.stringify(b.map((x) => JSON.stringify(x)).sort());

fs.mkdirSync(CACHE_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
for (const { id, data } of sites) {
  const { lat, lon } = data.launch;
  const airspaces = airspaceForLaunch(items, lat, lon);
  const file = path.join(CACHE_DIR, `${id}.json`);
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).airspaces : null;
  const unchanged = before && sameSet(before, airspaces);
  if (!unchanged) {
    const content = { source: "openAIP", fetched: today, nearbyKm: NEARBY_KM, launch: { lat, lon }, airspaces };
    fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  }
  console.log(`\n${data.name}: ${airspaces.length} luftrom${unchanged ? " (uendret)" : before ? " (ENDRET)" : " (ny)"}`);
  for (const a of airspaces) console.log(`  ${describe(a)}`);
}

// Flysteder som er fjernet eller har fått ny id, skal ikke etterlate cache-filer.
for (const file of fs.readdirSync(CACHE_DIR)) {
  if (file.endsWith(".json") && file !== CHECKED_FILE && !sites.some((s) => `${s.id}.json` === file)) {
    fs.unlinkSync(path.join(CACHE_DIR, file));
    console.log(`\nFjernet ${file} (stedet finnes ikke lenger).`);
  }
}

// Kartlaget. Skrives bare når innholdet er endret, så datoen i cache-filene ikke gir støy i diffen.
const geoFile = path.join(CACHE_DIR, "region.geojson");
const geo = regionGeoJSON(items);
const oldGeo = fs.existsSync(geoFile) ? JSON.parse(fs.readFileSync(geoFile, "utf8")) : null;
if (!oldGeo || !sameSet(oldGeo.features, geo.features)) {
  fs.writeFileSync(geoFile, JSON.stringify({ ...geo, source: "openAIP (CC BY-NC 4.0)", fetched: today }) + "\n");
  console.log(`\nKartlaget oppdatert: ${geo.features.length} luftrom.`);
}

// Datoen for denne sjekken, skrives hver gang (også når ingenting er endret), så nettstedet kan vise når luftrommet
// sist ble sjekket, og varsle når en månedlig sjekk mangler. Den månedlige PR-en har derfor alltid minst denne endringen.
fs.writeFileSync(path.join(CACHE_DIR, CHECKED_FILE), JSON.stringify({ source: "openAIP", checked: today, sites: sites.length }, null, 2) + "\n");
console.log(`\nKontrollert ${today} (${CHECKED_FILE}).`);
