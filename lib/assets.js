// Version numbers on CSS and JS files: "/assets/css/styles.css" becomes "/assets/css/styles.css?v=1a2b3c4d",
// where the number is a hash of the content. When the file changes, so does the URL, so browsers (especially
// mobile) fetch the new file instead of a stale cached one. GitHub Pages lets files stay cached for 10 min.

import crypto from "node:crypto";
import fs from "node:fs";

// Where the files under /assets/ come from (same as the passthrough copy in eleventy.config.js).
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
    return url; // not a source file; use as is
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (!cache.has(key)) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    cache.set(key, `${url}?v=${hash}`);
  }
  return cache.get(key);
}
