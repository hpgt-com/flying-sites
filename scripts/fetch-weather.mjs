// Fetches the MET wind forecast and the Open-Meteo winds aloft and writes them to .cache/weather/ (lib/weather/).
//
//   npm run weather
//
// Always ends without error: a source that fails is written as null, and the site builds without it.

import { FETCHERS, WEATHER_DIR, fetchWeather } from "../lib/weather/index.js";
import { readSites } from "../lib/site-files.js";

const sites = readSites();
for (const name of Object.keys(FETCHERS)) {
  const value = await fetchWeather(name, WEATHER_DIR, sites);
  const count = value ? Object.keys(value.sites).length : 0;
  console.log(`${name}: ${count} steder → ${WEATHER_DIR}/${name}.json`);
}
