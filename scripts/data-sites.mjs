// Writes the launches the data service fetches the forecast for (workers/data/src/sites.json) from the site files,
// before deploy. The same fields as the build sends to MET: the launch position and height (lib/weather/met.js).
//
//   node scripts/data-sites.mjs

import fs from "node:fs";
import { readSites } from "../lib/site-files.js";

const sites = readSites().map(({ id, data }) => ({
  id,
  lat: data.launch.lat,
  lon: data.launch.lon,
  altitude: data.elevation?.launch_masl ?? null,
}));
fs.writeFileSync("workers/data/src/sites.json", JSON.stringify(sites, null, 2) + "\n");
console.log(`${sites.length} steder → workers/data/src/sites.json`);
