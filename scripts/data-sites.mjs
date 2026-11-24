// Skriver startene datatjenesten henter varsel for (workers/data/src/sites.json) fra flystedsfilene, før publisering.
// De samme feltene som byggingen sender til MET: posisjonen og høyden til start (lib/weather/met.js), og navnet,
// for sakene fra «Meld fra om endring» (src/report.js).
//
//   node scripts/data-sites.mjs

import fs from "node:fs";
import { readSites } from "../lib/site-files.js";

const sites = readSites().map(({ id, data }) => ({
  id,
  name: data.name,
  lat: data.launch.lat,
  lon: data.launch.lon,
  altitude: data.elevation?.launch_masl ?? null,
}));
fs.writeFileSync("workers/data/src/sites.json", JSON.stringify(sites, null, 2) + "\n");
console.log(`${sites.length} steder → workers/data/src/sites.json`);
