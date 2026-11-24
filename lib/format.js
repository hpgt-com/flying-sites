// Felles formatering og oppslag for maler og byggelogikk. Tekstene ligger i src/_i18n/<lang>.json, og
// funksjonene tar språket som siste argument (norsk når det mangler).

import { dict, fmt, DEFAULT_LANG } from "./i18n.js";

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export const CATEGORIES = ["PG", "SPG", "PPG", "WINCH"];
export const LEVELS = ["PP2", "PP3", "PP4", "PP5"];

// Forkortelse for en retningskode (NE -> NØ på norsk).
export function directionLabel(code, lang = DEFAULT_LANG) {
  return dict(lang).directions.labels[code] ?? code;
}

// Ord for en retningskode (NE -> nordøst på norsk).
export function directionWord(code, lang = DEFAULT_LANG) {
  return dict(lang).directions.words[code] ?? code;
}

export function sortDirections(list = []) {
  return [...list].sort((a, b) => DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
}

// "primary" | "possible" | "none" for én retning på et flysted (wind_directions).
export function directionType(windDirections, code) {
  if (windDirections?.primary?.includes(code)) return "primary";
  if (windDirections?.possible?.includes(code)) return "possible";
  return "none";
}

// Tall med språkets desimaltegn (komma på norsk).
export function formatNumber(n, decimals = 0, lang = DEFAULT_LANG) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number(n).toFixed(decimals).replace(".", dict(lang).meta.decimal);
}

// dd.mm.yyyy på norsk, «6 Oct 2026» på engelsk (meta.dateStyle i ordboken).
export function formatDate(iso, lang = DEFAULT_LANG) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const meta = dict(lang).meta;
  if (meta.dateStyle === "text") return `${d.getDate()} ${meta.months[d.getMonth()]} ${d.getFullYear()}`;
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function feetToMeters(ft) {
  return Math.round(ft * 0.3048);
}

// Høydegrense fra luftromsdata: { value, unit: FT|FL|M, ref: GND|MSL|STD } -> "4500 ft", "FL105", "bakken".
export function formatLimit(limit, lang = DEFAULT_LANG) {
  if (!limit) return "";
  const t = dict(lang).limits;
  if (limit.ref === "GND" && !limit.value) return t.ground;
  if (limit.unit === "FL") return `FL${limit.value}`;
  const text = limit.unit === "M" ? `${limit.value} m` : `${limit.value} ft`;
  return limit.ref === "GND" ? fmt(t.aboveGround, { text }) : text;
}

// Omtrentlige meter over havet for en grense oppgitt i fot MSL; ellers tom.
export function limitMasl(limit, lang = DEFAULT_LANG) {
  if (!limit || limit.ref !== "MSL") return "";
  return fmt(dict(lang).limits.aboutMasl, { m: limit.unit === "M" ? limit.value : feetToMeters(limit.value) });
}

// Lesbar tekst for en `source`-verdi i flystedsfilene (sources.labels i ordboken).
export function sourceLabel(source, lang = DEFAULT_LANG) {
  return dict(lang).sources.labels[source] ?? source;
}

// Starter gruppert etter retninger og kategorier for listen under «Start»: starter med samme retninger blir
// én rad med tekstene under hverandre, i samme rekkefølge som i flystedsfilen. Kartet viser fortsatt hver
// start der den er (launches[].lat/lon).
export function groupLaunches(launches = []) {
  const groups = new Map();
  for (const l of (launches ?? []).filter(Boolean)) {
    const key = JSON.stringify([[...(l.directions ?? [])].sort(), [...(l.categories ?? [])].sort()]);
    if (!groups.has(key)) groups.set(key, { directions: l.directions ?? [], categories: l.categories ?? [], texts: [] });
    if (l.text) groups.get(key).texts.push(l.text);
  }
  return [...groups.values()];
}

// Retninger per kategori, for forsiden: { SPG: { primary, possible } }. Hentes fra startene, der en start
// uten egne kategorier gjelder alle kategoriene på flystedet. Primary/possible følger wind_directions, så
// retninger som ikke står der («ikke egnet»), utelates. Bare for flysteder med flere kategorier, og bare
// kategorier med egne starter. Ellers gjelder retningene for flystedet.
export function categoryDirections(d) {
  const categories = d.categories ?? [];
  if (categories.length < 2) return {};
  const primary = d.wind_directions?.primary ?? [];
  const possible = d.wind_directions?.possible ?? [];
  const result = {};
  for (const c of categories) {
    const launches = (d.launches ?? []).filter((l) => (l.categories ?? categories).includes(c));
    if (!launches.length || launches.some((l) => !(l.directions ?? []).length)) continue;
    const dirs = new Set(launches.flatMap((l) => l.directions));
    result[c] = { primary: primary.filter((x) => dirs.has(x)), possible: possible.filter((x) => dirs.has(x)) };
  }
  return result;
}

// Stedsnavn søket på forsiden finner en start på, i tillegg til navnet: kommune og region. Regionen deles
// på «og», og deler som er en kommune, droppes: «Harstad og Kvæfjord» skal ikke få «Kvæfjord» til å finne
// startene i Harstad. «Lofoten», «Andøya» og andre regioner som ikke er kommuner, er søkbare.
export function searchPlaces(d, municipalities) {
  const parts = String(d.region ?? "").split(/\s+og\s+/).filter((p) => p && !municipalities.has(p));
  return [...new Set([d.municipality, ...parts].filter(Boolean))];
}
