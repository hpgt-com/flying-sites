// Værmodulen: vindvarselet fra MET og høydevinden fra Open-Meteo, som JSON-filer i .cache/weather/.
//
//   npm run weather          henter begge og skriver .cache/weather/forecast.json og windgram.json
//
// I «Bygg og publiser» hentes filene i en egen jobb (weather) og gis til byggingen som en artefakt, så selve
// byggingen aldri spør MET eller Open-Meteo (WEATHER_FETCH=0). Lokalt henter byggingen selv når en fil mangler
// eller er eldre enn 30 minutter, så `npm start` virker som før. Nettstedet leser bare filene, så kilden senere
// kan flyttes til en backend uten å endre malene.
//
// En fil inneholder null når ingenting kunne hentes. Nettstedet bygges da uten vindvurdering eller høydevind.

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

// undefined når filen mangler eller ikke kan leses, så det går an å skille den fra null (hentet, men ingenting kom).
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

// For datafilene i src/_data/. env: process.env, eller en erstatning i testene.
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
