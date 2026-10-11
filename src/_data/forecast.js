// Wind forecast from MET (api.met.no, the same source as Yr) for each launch, for the wind and rain assessment on the
// front page and «Vind nå» on the site pages.
// Fetched on every build. The workflow builds the site twice an hour, but GitHub may delay or skip scheduled runs,
// so the forecast can be older (see maxForecastAgeHours).
// Locally it is cached in .cache/ for 30 minutes, so `npm start` does not query MET on every change.
// If fetching fails for one site, only that site is missing. If all fail, there is no wind assessment,
// and the rest of the site builds as usual.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES_DIR = "src/sites";
const CACHE_FILE = path.resolve(".cache/forecast.json");
const CACHE_MINUTES = 30;
const HOURS = 48;
// MET requires clients to identify themselves with contact info.
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
    // Precipitation over the next hour in mm (null when the forecast lacks it, further ahead).
    const rain = t.data.next_1_hours?.details?.precipitation_amount ?? null;
    return [t.time, Math.round(d.wind_from_direction), d.wind_speed, d.wind_speed_of_gust ?? null, rain];
  });
}

export default async function () {
  if (process.env.FORECAST_OFFLINE) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - Date.parse(cached.fetched) < CACHE_MINUTES * 60000) return cached;
  } catch {
    // no valid cache
  }

  const ids = fs.readdirSync(SITES_DIR).filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")));
  const fetched = {};
  const failed = [];
  // Each site is fetched separately. If one fails, only that site gets «Ingen varsel»; the rest are assessed.
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

  // Times are stored once. Sites are fetched one after another and may start at different hours if fetching
  // spans the top of the hour, so each row is placed at its own time. A missing hour becomes null.
  const times = series[0].map((row) => row[0]);
  const sites = {};
  for (const [id, rows] of Object.entries(fetched)) {
    const byTime = new Map(rows.map(([time, dir, speed, gust, rain]) => [time, [dir, speed, gust, rain]]));
    sites[id] = times.map((time) => byTime.get(time) ?? null);
  }
  const forecast = { fetched: new Date().toISOString(), source: "MET Norge", times, sites };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(forecast));
  return forecast;
}
