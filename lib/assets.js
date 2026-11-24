// Versjonsnumre på CSS- og JS-filer: "/assets/css/styles.css" blir "/assets/css/styles.css?v=1a2b3c4d",
// der nummeret er en hash av innholdet. Når filen endres, endres også adressen, så nettlesere (særlig på mobil)
// henter den nye filen i stedet for en gammel kopi fra cachen. GitHub Pages lar filer ligge i cachen i 10 min.

import crypto from "node:crypto";
import fs from "node:fs";

// Hvor filene under /assets/ kommer fra (det samme som passthrough-kopieringen i eleventy.config.js).
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
    return url; // ikke en kildefil; brukes som den er
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (!cache.has(key)) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    cache.set(key, `${url}?v=${hash}`);
  }
  return cache.get(key);
}
