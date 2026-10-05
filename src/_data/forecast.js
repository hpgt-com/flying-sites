// Vindvarsel fra MET (api.met.no, samme kilde som Yr) for hver start, til vindvurderingen på forsiden.
// Hentes ved hver bygging. Workflowen bygger siden to ganger i timen, men GitHub kan forsinke eller hoppe over planlagte kjøringer, så varselet kan være eldre (se maxForecastAgeHours).
// Lokalt mellomlagres det i .cache/ i 30 minutter, så `npm start` ikke spør MET ved hver endring.
// Feiler hentingen for et sted, mangler bare det stedet. Feiler alle, blir det ingen vindvurdering,
// og resten av siden bygges som vanlig.

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

  const ids = fs.readdirSync(SITES_DIR).filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")));
  const fetched = {};
  const failed = [];
  // Hvert sted hentes for seg. Feiler ett, får bare det stedet «Ingen varsel», resten får vurdering.
  for (const id of ids) {
    try {
      const text = fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8");
      const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]);
      fetched[id] = await fetchSite(data.launch, data.elevation?.launch_masl);
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  const series = Object.values(fetched);
  if (!series.length) {
    console.warn(`[varsel] Fikk ikke vindvarsel fra MET for noen steder: ${failed.join(", ")}. Forsiden bygges uten vindvurdering.`);
    return null;
  }
  if (failed.length) console.warn(`[varsel] Mangler vindvarsel for ${failed.join(", ")}.`);

  // Tidene lagres én gang. Stedene hentes etter hverandre og kan starte på hver sin time hvis hentingen
  // går over et timeskifte, så hver rad plasseres på sitt tidspunkt. Mangler en time, blir den null.
  const times = series[0].map((row) => row[0]);
  const sites = {};
  for (const [id, rows] of Object.entries(fetched)) {
    const byTime = new Map(rows.map(([time, dir, speed, gust]) => [time, [dir, speed, gust]]));
    sites[id] = times.map((time) => byTime.get(time) ?? null);
  }
  const forecast = { fetched: new Date().toISOString(), source: "MET Norge", times, sites };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(forecast));
  return forecast;
}
