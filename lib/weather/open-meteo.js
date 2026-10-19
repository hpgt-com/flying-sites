// Winds aloft (windgram) from Open-Meteo (CC BY 4.0, free for non-commercial use) for the launches in WINDGRAM_SITES.
// Draft. If fetching fails, only the winds aloft are missing on the site page. The data service
// (workers/data/src/sources/windgram.js) fetches the same with fetchSite, each launch about every half hour, and the page
// uses it when newer.

import { buildWindgram, hourlyVariables } from "../windgram.js";

export const WINDGRAM_SITES = ["sollifjellet", "saetertinden", "heia", "kilhusasen", "elgen"];
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

// The grid for one launch, from the current hour and HOURS hours ahead.
export async function fetchSite(launch, launchMasl, now = Date.now()) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", launch.lat.toFixed(4));
  url.searchParams.set("longitude", launch.lon.toFixed(4));
  url.searchParams.set("hourly", hourlyVariables().join(","));
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "3");
  const grid = buildWindgram(await fetchJson(url), launchMasl);
  if (!grid) throw new Error("tomt svar");
  const start = grid.times.findIndex((t) => t > now - 3600000);
  const keep = (list) => list.slice(Math.max(0, start), Math.max(0, start) + HOURS);
  const hourly = ["times", "cells", "blh", "cloudBase", "cape", "rain", "clouds", "sun", "gust"];
  return { ...grid, ...Object.fromEntries(hourly.map((k) => [k, keep(grid[k] ?? [])])) };
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
