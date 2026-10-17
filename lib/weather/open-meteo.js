// Winds aloft (windgram) from Open-Meteo (CC BY 4.0, free for non-commercial use) for the launches in WINDGRAM_SITES.
// Draft: only Sollifjellet for now. If fetching fails, only the winds aloft are missing on the site page.

import { buildWindgram, hourlyVariables } from "../windgram.js";

export const WINDGRAM_SITES = ["sollifjellet"];
const HOURS = 48;

// Open-Meteo sometimes answers 429 (too many requests from the same address) or drops the connection.
// Then it retries once after five seconds.
async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Open-Meteo svarte ${response.status}`);
      return await response.json();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function fetchSite(launch, launchMasl) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", launch.lat.toFixed(4));
  url.searchParams.set("longitude", launch.lon.toFixed(4));
  url.searchParams.set("hourly", hourlyVariables().join(","));
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "3");
  const grid = buildWindgram(await fetchJson(url), launchMasl);
  if (!grid) throw new Error("tomt svar");
  // From the current hour and HOURS hours ahead.
  const start = grid.times.findIndex((t) => t > Date.now() - 3600000);
  const keep = (list) => list.slice(Math.max(0, start), Math.max(0, start) + HOURS);
  return { ...grid, times: keep(grid.times), cells: keep(grid.cells), blh: keep(grid.blh), cloudBase: keep(grid.cloudBase), cape: keep(grid.cape) };
}

// sites: from readSites() in lib/site-files.js. Returns null when no site could be fetched.
export async function fetchWindgram(sites) {
  const result = {};
  const failed = [];
  for (const { id, data } of sites.filter((s) => WINDGRAM_SITES.includes(s.id))) {
    try {
      result[id] = await fetchSite(data.launch, data.elevation?.launch_masl);
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  if (failed.length) console.warn(`[høydevind] Mangler høydevind for ${failed.join(", ")}.`);
  if (!Object.keys(result).length) return null;
  return { fetched: new Date().toISOString(), source: "Open-Meteo", sites: result };
}
