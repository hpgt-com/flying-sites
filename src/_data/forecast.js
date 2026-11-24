// Vindprognose fra MET for hver start (lib/weather/met.js), til vindvurderingen på forsiden og
// «Vind nå» på stedssidene. Leses fra .cache/weather/forecast.json, se lib/weather/index.js.
// Arbeidsflyten bygger siden to ganger i timen, men GitHub kan forsinke eller hoppe over planlagte kjøringer,
// så prognosen kan være eldre (se maxForecastAgeHours).

import { loadWeather } from "../../lib/weather/index.js";

export default () => loadWeather("forecast");
