// Henter vindvarselet fra MET og høydevinden fra Open-Meteo og skriver dem til .cache/weather/ (lib/weather/).
//
//   npm run weather
//
// Avslutter alltid uten feil: en kilde som feiler, skrives som null, og nettstedet bygges uten den.

import { FETCHERS, WEATHER_DIR, fetchWeather } from "../lib/weather/index.js";
import { readSites } from "../lib/site-files.js";

const sites = readSites();
for (const name of Object.keys(FETCHERS)) {
  const value = await fetchWeather(name, WEATHER_DIR, sites);
  const count = value ? Object.keys(value.sites).length : 0;
  console.log(`${name}: ${count} steder → ${WEATHER_DIR}/${name}.json`);
}
