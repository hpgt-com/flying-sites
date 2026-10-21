// Wind forecast from MET (api.met.no, the same source as Yr) for each launch, for the wind and rain assessment on the
// front page and «Vind nå» on the site pages. If fetching fails for one site, only that site is missing.

// How far ahead: MET gives every hour for about 2½ days, then every 6 hours (00, 06, 12, 18 UTC) for ten days; all of
// it is kept up to DAYS days from the first hour, so the timeline on the home page reaches as far.
export const DAYS = 5;
const HOUR = 3600000;
// MET requires clients to identify themselves with contact info.
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com; 22492302+krishofs@users.noreply.github.com)";

// One row per time in the forecast: [time, direction, speed, gust, rain]. Each counts until the next (an hour, or 6 hours
// further ahead). Rain is precipitation per hour in mm: the next hour's, or for a 6-hour step the 6 hours' spread evenly
// (null when the forecast lacks it). MET gives no gust for the 6-hour steps (null).
export function metRows(data, days = DAYS) {
  const series = data.properties.timeseries;
  const end = Date.parse(series[0]?.time) + days * 24 * HOUR;
  return series.filter((t) => Date.parse(t.time) < end).map((t) => {
    const d = t.data.instant.details;
    const six = t.data.next_6_hours?.details?.precipitation_amount;
    const rain = t.data.next_1_hours?.details?.precipitation_amount ?? (typeof six === "number" ? Math.round((six / 6) * 10) / 10 : null);
    return [t.time, Math.round(d.wind_from_direction), d.wind_speed, d.wind_speed_of_gust ?? null, rain];
  });
}

// When MET last updated the forecast for the point (the model run), not when we fetched it.
export function metUpdated(data) {
  const updated = data.properties?.meta?.updated_at;
  return Number.isFinite(Date.parse(updated)) ? updated : null;
}

// Times are stored once. Sites are fetched one after another and may start at different hours if fetching
// spans the top of the hour, so each row is placed at its own time. A missing hour becomes null.
// updated: MET's updated_at per site. The oldest is kept, so the page never claims a newer model run than every site has.
export function mergeSites(fetched, now = new Date(), updated = {}) {
  const series = Object.values(fetched);
  if (!series.length) return null;
  const times = series[0].map((row) => row[0]);
  const sites = {};
  for (const [id, rows] of Object.entries(fetched)) {
    const byTime = new Map(rows.map(([time, dir, speed, gust, rain]) => [time, [dir, speed, gust, rain]]));
    sites[id] = times.map((time) => byTime.get(time) ?? null);
  }
  const runs = Object.values(updated).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { fetched: now.toISOString(), updated: runs[0] ?? null, source: "MET Norge", times, sites };
}

export async function fetchSite(launch, altitude) {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/complete");
  url.searchParams.set("lat", launch.lat.toFixed(4));
  url.searchParams.set("lon", launch.lon.toFixed(4));
  if (Number.isFinite(altitude)) url.searchParams.set("altitude", Math.round(altitude));
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`MET svarte ${response.status}`);
  const data = await response.json();
  return { rows: metRows(data), updated: metUpdated(data) };
}

// sites: from readSites() in lib/site-files.js. Returns null when no site could be fetched.
export async function fetchForecast(sites) {
  const fetched = {};
  const updated = {};
  const failed = [];
  for (const { id, data } of sites) {
    try {
      ({ rows: fetched[id], updated: updated[id] } = await fetchSite(data.launch, data.elevation?.launch_masl));
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  const forecast = mergeSites(fetched, new Date(), updated);
  if (!forecast) console.warn(`[varsel] Fikk ikke vindvarsel fra MET for noen steder: ${failed.join(", ")}. Siden bygges uten vindvurdering.`);
  else if (failed.length) console.warn(`[varsel] Mangler vindvarsel for ${failed.join(", ")}.`);
  return forecast;
}
