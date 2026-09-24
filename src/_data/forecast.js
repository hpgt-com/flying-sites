// Vindvarsel fra MET (api.met.no, samme kilde som Yr) for hver start, til vindvurderingen på forsiden.
// Hentes ved hver bygging. Workflowen bygger siden hver time, så varselet er aldri mer enn rundt en time gammelt.
// Lokalt mellomlagres det i .cache/ i 30 minutter, så `npm start` ikke spør MET ved hver endring.
// Feiler hentingen, blir det ingen vindvurdering, og resten av siden bygges som vanlig.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES_DIR = "src/flysteder";
const CACHE_FILE = path.resolve(".cache/forecast.json");
const CACHE_MINUTES = 30;
const HOURS = 48;
// MET krever at klienten identifiserer seg med kontaktinfo.
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com; 22492302+krishofs@users.noreply.github.com)";

async function fetchSite(launch, altitude) {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/complete");
  url.searchParams.set("lat", launch.lat.toFixed(4));
  url.searchParams.set("lon", launch.lon.toFixed(4));
  if (Number.isFinite(altitude)) url.searchParams.set("altitude", Math.round(altitude));
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`MET svarte ${response.status}`);
  const data = await response.json();
  return data.properties.timeseries.slice(0, HOURS).map((t) => {
    const d = t.data.instant.details;
    return [t.time, Math.round(d.wind_from_direction), d.wind_speed, d.wind_speed_of_gust ?? null];
  });
}

export default async function () {
  if (process.env.FORECAST_OFFLINE) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - Date.parse(cached.fetched) < CACHE_MINUTES * 60000) return cached;
  } catch {
    // ingen gyldig mellomlagring
  }

  try {
    const ids = fs.readdirSync(SITES_DIR).filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")));
    const sites = {};
    let times = null;
    for (const id of ids) {
      const text = fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8");
      const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]);
      const series = await fetchSite(data.launch, data.elevation?.launch_masl);
      times ??= series.map((s) => s[0]);
      // Kompakt: [retning, vind, kast] per time. Tidene er like for alle steder og lagres én gang.
      sites[id] = series.map(([, dir, speed, gust]) => [dir, speed, gust]);
    }
    const forecast = { fetched: new Date().toISOString(), source: "MET Norge", times, sites };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(forecast));
    return forecast;
  } catch (err) {
    console.warn(`[varsel] Fikk ikke vindvarsel fra MET: ${err.message}. Forsiden bygges uten vindvurdering.`);
    return null;
  }
}
