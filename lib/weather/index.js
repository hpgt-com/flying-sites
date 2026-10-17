// The weather module: the MET wind forecast and the Open-Meteo winds aloft, as JSON files in .cache/weather/.
//
//   npm run weather          fetches both and writes .cache/weather/forecast.json and windgram.json
//
// In «Build and deploy» the files are fetched in their own job (weather) and handed to the build as an artifact,
// so the build itself never queries MET or Open-Meteo (WEATHER_FETCH=0). Locally the build fetches by itself
// when a file is missing or older than 30 minutes, so `npm start` works as before. The site only reads the files,
// so the source can later move to a backend without changing the templates.
//
// A file holds null when nothing could be fetched. The site then builds without the wind assessment or winds aloft.

import fs from "node:fs";
import path from "node:path";
import { readSites } from "../site-files.js";
import { fetchForecast } from "./met.js";
import { fetchWindgram } from "./open-meteo.js";

export const WEATHER_DIR = ".cache/weather";
const MAX_AGE_MINUTES = 30;
export const FETCHERS = { forecast: fetchForecast, windgram: fetchWindgram };

const file = (name, dir) => path.resolve(dir, `${name}.json`);

export function writeWeather(name, value, dir = WEATHER_DIR) {
  fs.mkdirSync(path.resolve(dir), { recursive: true });
  fs.writeFileSync(file(name, dir), JSON.stringify(value));
}

// undefined when the file is missing or unreadable, so null (fetched, but nothing came back) can be told apart.
export function readWeather(name, dir = WEATHER_DIR) {
  try {
    return JSON.parse(fs.readFileSync(file(name, dir), "utf8"));
  } catch {
    return undefined;
  }
}

export async function fetchWeather(name, dir = WEATHER_DIR, sites = readSites()) {
  const value = await FETCHERS[name](sites);
  writeWeather(name, value, dir);
  return value;
}

// For the data files in src/_data/. env: process.env, or a stand-in in the tests.
export async function loadWeather(name, { env = process.env, dir = WEATHER_DIR, now = Date.now(), fetch = fetchWeather } = {}) {
  if (env.FORECAST_OFFLINE) return null;
  const value = readWeather(name, dir);
  if (env.WEATHER_FETCH === "0") {
    if (value === undefined) console.warn(`[vær] Fant ikke ${dir}/${name}.json. Siden bygges uten.`);
    return value ?? null;
  }
  if (value && now - Date.parse(value.fetched) < MAX_AGE_MINUTES * 60000) return value;
  return fetch(name, dir);
}
