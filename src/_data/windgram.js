// Høydevind (windgram) fra Open-Meteo (CC BY 4.0, gratis for ikke-kommersiell bruk) for startene i SITES.
// Utkast: bare Sollifjellet foreløpig. Hentes ved hver bygging, som vindvarselet fra MET (forecast.js), og
// mellomlagres lokalt i .cache/ i 30 minutter. Feiler hentingen, mangler bare høydevinden på stedssiden.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildWindgram, hourlyVariables } from "../../lib/windgram.js";

const yaml = createRequire(import.meta.url)("js-yaml");
const SITES = ["sollifjellet"];
const SITES_DIR = "src/flysteder";
const CACHE_FILE = path.resolve(".cache/windgram.json");
const CACHE_MINUTES = 30;
const HOURS = 48;

// Open-Meteo svarer av og til 429 (for mange forespørsler fra samme adresse) eller bryter forbindelsen.
// Da prøves det én gang til etter fem sekunder.
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
  // Fra timen nå og HOURS timer fram.
  const start = grid.times.findIndex((t) => t > Date.now() - 3600000);
  const keep = (list) => list.slice(Math.max(0, start), Math.max(0, start) + HOURS);
  return { ...grid, times: keep(grid.times), cells: keep(grid.cells), blh: keep(grid.blh), cloudBase: keep(grid.cloudBase), cape: keep(grid.cape) };
}

export default async function () {
  if (process.env.FORECAST_OFFLINE) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - Date.parse(cached.fetched) < CACHE_MINUTES * 60000) return cached;
  } catch {
    // ingen gyldig mellomlagring
  }
  const sites = {};
  const failed = [];
  for (const id of SITES) {
    try {
      const text = fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8");
      const data = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]);
      sites[id] = await fetchSite(data.launch, data.elevation?.launch_masl);
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  if (failed.length) console.warn(`[høydevind] Mangler høydevind for ${failed.join(", ")}.`);
  if (!Object.keys(sites).length) return null;
  const windgram = { fetched: new Date().toISOString(), source: "Open-Meteo", sites };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(windgram));
  return windgram;
}
