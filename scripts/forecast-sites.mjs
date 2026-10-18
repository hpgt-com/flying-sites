// Writes the launches the weather service fetches (workers/forecast/src/sites.json) from the site files, before deploy.
// The same fields as the build sends to MET: the launch position and height (lib/weather/met.js).
//
//   node scripts/forecast-sites.mjs

import fs from "node:fs";
import { readSites } from "../lib/site-files.js";

const sites = readSites().map(({ id, data }) => ({
  id,
  lat: data.launch.lat,
  lon: data.launch.lon,
  altitude: data.elevation?.launch_masl ?? null,
}));
fs.writeFileSync("workers/forecast/src/sites.json", JSON.stringify(sites, null, 2) + "\n");
console.log(`${sites.length} steder → workers/forecast/src/sites.json`);
