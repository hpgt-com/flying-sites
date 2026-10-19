// Fetches the power lines and other obstacles around every site (lib/obstacles.js) and saves them as one GeoJSON file
// for the map layer «Kraftlinjer og hindre» (src/_data/cache/obstacles/region.geojson). Needs no key. Never writes to
// the site files; changes show up in the Git diff and are reviewed before publishing (.github/workflows/obstacles.yml).
//
//   npm run obstacles
//   npm run obstacles -- --no-osm     (NVE only, when Overpass cannot be reached; the file then says so)

import fs from "node:fs";
import path from "node:path";
import { readSites } from "../lib/site-files.js";
import { siteBox, NVE_LAYERS, nveQueryUrl, nveFeatures, OVERPASS, overpassQuery, osmFeatures, obstaclesGeoJSON, summary, OUT } from "../lib/obstacles.js";

const withOsm = !process.argv.includes("--no-osm");
const USER_AGENT = "hpgt-flysteder (https://flysteder.hpgt.com)";

async function getJson(url, options = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...options, headers: { "user-agent": USER_AGENT, ...options.headers }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${new URL(url).host}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

const boxes = readSites().map((s) => siteBox(s.data)).filter(Boolean);
console.log(`Henter kraftlinjer og hindre rundt ${boxes.length} steder …`);

const features = [];
for (const box of boxes) {
  for (const layer of NVE_LAYERS) features.push(...nveFeatures(await getJson(nveQueryUrl(layer, box)), layer));
}
if (withOsm) {
  const body = new URLSearchParams({ data: overpassQuery(boxes) });
  features.push(...osmFeatures(await getJson(OVERPASS, { method: "POST", body })));
}

const geojson = obstaclesGeoJSON(features, { fetched: new Date().toISOString().slice(0, 10), sources: withOsm ? ["nve", "osm"] : ["nve"] });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
// One feature per line, so the PR's diff shows what was added, changed or removed.
const { features: all, ...head } = geojson;
fs.writeFileSync(OUT, JSON.stringify(head).slice(0, -1) + ',"features":[\n' + all.map((f) => JSON.stringify(f)).join(",\n") + "\n]}\n");
const n = summary(geojson.features);
const NAMES = { power: "kraftlinjer", pylon: "master og stolper", wind: "vindturbiner", minor: "lavspentlinjer", aerialway: "heiser og taubaner", mast: "master (tele o.l.)" };
console.log(Object.keys(NAMES).map((k) => `  ${NAMES[k]}: ${n[k] ?? 0}`).join("\n"));
if (!withOsm) console.log("Uten OpenStreetMap (--no-osm): lavspent, heiser og master mangler.");
console.log(`Skrev ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} kB).`);
