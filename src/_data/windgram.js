// Winds aloft from Open-Meteo for the launches in WINDGRAM_SITES (lib/weather/open-meteo.js). Read from
// .cache/weather/windgram.json, see lib/weather/index.js. enabled lists the launches, so their page has winds aloft
// even when the build has none (the page then fetches them from the data service, src/assets/js/windgram.js).

import { loadWeather } from "../../lib/weather/index.js";
import { WINDGRAM_SITES } from "../../lib/weather/open-meteo.js";

export default async () => ({ ...((await loadWeather("windgram")) ?? {}), enabled: WINDGRAM_SITES });
