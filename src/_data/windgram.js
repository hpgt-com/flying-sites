// Winds aloft from Open-Meteo for the launches in WINDGRAM_SITES (lib/weather/open-meteo.js). Read from
// .cache/weather/windgram.json, see lib/weather/index.js.

import { loadWeather } from "../../lib/weather/index.js";

export default () => loadWeather("windgram");
