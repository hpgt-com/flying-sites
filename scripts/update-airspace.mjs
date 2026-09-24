// Henter luftrom fra openAIP for flystedene og lagrer det i src/_data/cache/airspace/<id>.json.
//
//   OPENAIP_API_KEY=... npm run airspace                  Alle steder
//   OPENAIP_API_KEY=... npm run airspace -- sollifjellet  Bare de nevnte stedene
//
// Nøkkelen lages på openaip.net og skal aldri inn i repoet. I GitHub ligger den som repository secret.
// Skriptet skriver aldri i stedsfilene. Endringer vises i Git-diffen og gjennomgås før de publiseres.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fetchAirspace, CACHE_DIR, NEARBY_KM } from "../lib/airspace.js";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES_DIR = "src/flysteder";
const PAUSE_MS = 2500; // openAIP har fartsgrense

const apiKey = process.env.OPENAIP_API_KEY;
if (!apiKey) {
  console.error("Mangler OPENAIP_API_KEY. Sett den som miljøvariabel før du kjører skriptet.");
  process.exit(1);
}

const wanted = process.argv.slice(2);
const ids = fs.readdirSync(SITES_DIR)
  .filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")))
  .filter((id) => !wanted.length || wanted.includes(id));
const unknown = wanted.filter((id) => !ids.includes(id));
if (unknown.length) {
  console.error(`Ukjente steder: ${unknown.join(", ")}`);
  process.exit(1);
}

const describe = (a) =>
  `${a.name} (${a.type}${a.class ? ", klasse " + a.class : ""}, ${a.lower.value} ${a.lower.unit} ${a.lower.ref}` +
  `${a.overLaunch ? ", over start" : `, ${a.distanceKm} km unna`}${a.byNotam ? ", aktiveres ved NOTAM" : ""})`;

fs.mkdirSync(CACHE_DIR, { recursive: true });
for (const [i, id] of ids.entries()) {
  if (i) await new Promise((r) => setTimeout(r, PAUSE_MS));
  const text = fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8");
  const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]);
  const { lat, lon } = data.launch;
  const airspaces = await fetchAirspace(lat, lon, apiKey);

  const file = path.join(CACHE_DIR, `${id}.json`);
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).airspaces : null;
  const content = { source: "openAIP", fetched: new Date().toISOString().slice(0, 10), nearbyKm: NEARBY_KM, launch: { lat, lon }, airspaces };
  const unchanged = before && JSON.stringify(before) === JSON.stringify(airspaces);
  if (!unchanged) fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");

  console.log(`\n${data.name}: ${airspaces.length} luftrom${unchanged ? " (uendret)" : before ? " (ENDRET)" : " (ny)"}`);
  for (const a of airspaces) console.log(`  ${describe(a)}`);
}
