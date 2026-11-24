// Henter kraftlinjene og de andre hindrene i regionen rundt flystedene (lib/obstacles.js) og lagrer dem som ruter
// med en indeks for kartlaget «Kraftlinjer og hindre» (src/_data/cache/obstacles/index.json og tiles/). Trenger ingen
// nøkkel. Skriver aldri til flystedsfilene; endringer vises i diffen i Git og gås gjennom før publisering
// (.github/workflows/obstacles.yml).
//
//   npm run obstacles
//   npm run obstacles -- --no-osm     (bare NVE, når Overpass ikke svarer; indeksen sier da det)

import fs from "node:fs";
import path from "node:path";
import { readSites } from "../lib/site-files.js";
import { siteBox, regionBox, NVE_LAYERS, nveQueryUrl, nveFeatures, OVERPASS, overpassQuery, osmFeatures, obstacleTiles, obstaclesIndex, summary, dedupe, OUT_DIR } from "../lib/obstacles.js";

const withOsm = !process.argv.includes("--no-osm");
const USER_AGENT = "hpgt-flysteder (https://flysteder.hpgt.com)";

async function getJson(url, options = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...options, headers: { "user-agent": USER_AGENT, ...options.headers }, signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${new URL(url).host}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

// Alle objektene i ett lag fra NVE innenfor en boks, side for side.
async function nveLayer(layer, box) {
  const out = [];
  for (let offset = 0; ; ) {
    const body = await getJson(nveQueryUrl(layer, box, offset));
    out.push(...nveFeatures(body, layer));
    offset += body.features?.length ?? 0;
    if (!body.exceededTransferLimit || !body.features?.length) return out;
  }
}

const boxes = readSites().map((s) => siteBox(s.data)).filter(Boolean);
const region = regionBox(boxes);
console.log(`Henter kraftlinjer og hindre i ${region.s}–${region.n}° N, ${region.w}–${region.e}° Ø (master og stolper rundt ${boxes.length} steder) …`);

const features = [];
for (const layer of NVE_LAYERS) {
  for (const box of layer.nearSites ? boxes : [region]) features.push(...await nveLayer(layer, box));
}
if (withOsm) {
  // Én spørring for hele regionen (Overpass tillater få om gangen).
  const body = new URLSearchParams({ data: overpassQuery([region]) });
  features.push(...osmFeatures(await getJson(OVERPASS, { method: "POST", body })));
}

const tiles = obstacleTiles(features);
const index = obstaclesIndex(tiles, { fetched: new Date().toISOString().slice(0, 10), sources: withOsm ? ["nve", "osm"] : ["nve"] });
// De gamle rutene fjernes, så en rute som ikke lenger har objekter, forsvinner.
fs.rmSync(path.join(OUT_DIR, "tiles"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, "tiles"), { recursive: true });
let bytes = 0;
for (const [key, list] of tiles) {
  // Ett objekt per linje, så diffen i PR-en viser hva som er lagt til, endret eller fjernet.
  const text = '{"type":"FeatureCollection","features":[\n' + list.map((f) => JSON.stringify(f)).join(",\n") + "\n]}\n";
  fs.writeFileSync(path.join(OUT_DIR, "tiles", `${key}.geojson`), text);
  bytes += Buffer.byteLength(text);
}
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index) + "\n");
const n = summary(dedupe(features));
const NAMES = { power: "kraftlinjer", pylon: "master og stolper", wind: "vindturbiner", minor: "lavspentlinjer", aerialway: "heiser og taubaner", mast: "master (tele o.l.)" };
console.log(Object.keys(NAMES).map((k) => `  ${NAMES[k]}: ${n[k] ?? 0}`).join("\n"));
if (!withOsm) console.log("Uten OpenStreetMap (--no-osm): lavspent, heiser og master mangler.");
console.log(`Skrev ${tiles.size} fliser i ${OUT_DIR}/tiles (${Math.round(bytes / 1024)} kB i alt, største ${Math.round(Math.max(...[...tiles.keys()].map((k) => fs.statSync(path.join(OUT_DIR, "tiles", `${k}.geojson`)).size)) / 1024)} kB).`);
