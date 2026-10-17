// Wind forecast from MET for each launch (lib/weather/met.js), for the wind assessment on the front page and
// «Vind nå» on the site pages. Read from .cache/weather/forecast.json, see lib/weather/index.js.
// The workflow builds the site twice an hour, but GitHub may delay or skip scheduled runs, so the forecast can be
// older (see maxForecastAgeHours).

import { loadWeather } from "../../lib/weather/index.js";

export default () => loadWeather("forecast");
