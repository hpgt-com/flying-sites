// Wind forecast from MET (api.met.no, the same source as Yr) for each launch, for the wind and rain assessment on the
// front page and «Vind nå» on the site pages. If fetching fails for one site, only that site is missing.

const HOURS = 48;
// MET requires clients to identify themselves with contact info.
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com; 22492302+krishofs@users.noreply.github.com)";

// One row per hour: [time, direction, speed, gust, rain]. Rain is precipitation over the next hour in mm (null when
// the forecast lacks it, further ahead).
export function metRows(data) {
  return data.properties.timeseries.slice(0, HOURS).map((t) => {
    const d = t.data.instant.details;
    const rain = t.data.next_1_hours?.details?.precipitation_amount ?? null;
    return [t.time, Math.round(d.wind_from_direction), d.wind_speed, d.wind_speed_of_gust ?? null, rain];
  });
}

// Times are stored once. Sites are fetched one after another and may start at different hours if fetching
// spans the top of the hour, so each row is placed at its own time. A missing hour becomes null.
export function mergeSites(fetched, now = new Date()) {
  const series = Object.values(fetched);
  if (!series.length) return null;
  const times = series[0].map((row) => row[0]);
  const sites = {};
  for (const [id, rows] of Object.entries(fetched)) {
    const byTime = new Map(rows.map(([time, dir, speed, gust, rain]) => [time, [dir, speed, gust, rain]]));
    sites[id] = times.map((time) => byTime.get(time) ?? null);
  }
  return { fetched: now.toISOString(), source: "MET Norge", times, sites };
}

async function fetchSite(launch, altitude) {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/complete");
  url.searchParams.set("lat", launch.lat.toFixed(4));
  url.searchParams.set("lon", launch.lon.toFixed(4));
  if (Number.isFinite(altitude)) url.searchParams.set("altitude", Math.round(altitude));
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`MET svarte ${response.status}`);
  return metRows(await response.json());
}

// sites: from readSites() in lib/site-files.js. Returns null when no site could be fetched.
export async function fetchForecast(sites) {
  const fetched = {};
  const failed = [];
  for (const { id, data } of sites) {
    try {
      fetched[id] = await fetchSite(data.launch, data.elevation?.launch_masl);
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  const forecast = mergeSites(fetched);
  if (!forecast) console.warn(`[varsel] Fikk ikke vindvarsel fra MET for noen steder: ${failed.join(", ")}. Siden bygges uten vindvurdering.`);
  else if (failed.length) console.warn(`[varsel] Mangler vindvarsel for ${failed.join(", ")}.`);
  return forecast;
}
