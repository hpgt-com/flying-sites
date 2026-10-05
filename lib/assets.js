// Versjonsnummer på CSS- og JS-filer: «/assets/css/styles.css» blir «/assets/css/styles.css?v=1a2b3c4d»,
// der tallet er en hash av innholdet. Endres filen, endres adressen, så nettlesere (særlig mobil) henter
// den nye filen i stedet for en gammel fra hurtigbufferen. GitHub Pages lar filer ligge i bufferen i 10 min.

import crypto from "node:crypto";
import fs from "node:fs";

// Hvor filene på /assets/ kommer fra (samme som passthrough-kopieringen i eleventy.config.js).
const SOURCES = [
  ["/assets/leaflet-markercluster/", "node_modules/leaflet.markercluster/dist/"],
  ["/assets/leaflet/", "node_modules/leaflet/dist/"],
  ["/assets/", "src/assets/"],
];

const cache = new Map();

export function assetUrl(url) {
  const match = SOURCES.find(([prefix]) => url.startsWith(prefix));
  if (!match) return url;
  const file = match[1] + url.slice(match[0].length);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return url; // finnes ikke som kildefil, brukes som den er
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (!cache.has(key)) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    cache.set(key, `${url}?v=${hash}`);
  }
  return cache.get(key);
}
