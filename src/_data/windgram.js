// Høydevind fra Open-Meteo for startene i WINDGRAM_SITES (lib/weather/open-meteo.js). Leses fra
// .cache/weather/windgram.json, se lib/weather/index.js. enabled lister startene, så siden deres har høydevind
// også når bygget ikke har noen (siden henter den da fra datatjenesten, src/assets/js/windgram.js).

import { loadWeather } from "../../lib/weather/index.js";
import { WINDGRAM_SITES } from "../../lib/weather/open-meteo.js";

export default async () => ({ ...((await loadWeather("windgram")) ?? {}), enabled: WINDGRAM_SITES });
