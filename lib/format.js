// Shared formatting and lookups for templates and build logic. The texts live in src/_i18n/<lang>.json, and
// the functions take the language as their last argument (Norwegian when omitted).

import { dict, fmt, DEFAULT_LANG } from "./i18n.js";

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export const CATEGORIES = ["PG", "SPG", "PPG"];
export const LEVELS = ["PP2", "PP3", "PP4", "PP5"];

// Abbreviation for a direction code (NE -> NØ in Norwegian).
export function directionLabel(code, lang = DEFAULT_LANG) {
  return dict(lang).directions.labels[code] ?? code;
}

// Word for a direction code (NE -> nordøst in Norwegian).
export function directionWord(code, lang = DEFAULT_LANG) {
  return dict(lang).directions.words[code] ?? code;
}

export function sortDirections(list = []) {
  return [...list].sort((a, b) => DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
}

// "primary" | "possible" | "none" for one direction at a site (wind_directions).
export function directionType(windDirections, code) {
  if (windDirections?.primary?.includes(code)) return "primary";
  if (windDirections?.possible?.includes(code)) return "possible";
  return "none";
}

// Number with the language's decimal separator (comma in Norwegian).
export function formatNumber(n, decimals = 0, lang = DEFAULT_LANG) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number(n).toFixed(decimals).replace(".", dict(lang).meta.decimal);
}

// dd.mm.yyyy in Norwegian, «6 Oct 2026» in English (meta.dateStyle in the dictionary).
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

// Altitude limit from airspace data: { value, unit: FT|FL|M, ref: GND|MSL|STD } -> "4500 ft", "FL105", "bakken".
export function formatLimit(limit, lang = DEFAULT_LANG) {
  if (!limit) return "";
  const t = dict(lang).limits;
  if (limit.ref === "GND" && !limit.value) return t.ground;
  if (limit.unit === "FL") return `FL${limit.value}`;
  const text = limit.unit === "M" ? `${limit.value} m` : `${limit.value} ft`;
  return limit.ref === "GND" ? fmt(t.aboveGround, { text }) : text;
}

// Approximate metres above sea level for a limit given in feet MSL; otherwise empty.
export function limitMasl(limit, lang = DEFAULT_LANG) {
  if (!limit || limit.ref !== "MSL") return "";
  return fmt(dict(lang).limits.aboutMasl, { m: limit.unit === "M" ? limit.value : feetToMeters(limit.value) });
}

// Readable text for a `source` value in the site files (sources.labels in the dictionary).
export function sourceLabel(source, lang = DEFAULT_LANG) {
  return dict(lang).sources.labels[source] ?? source;
}

// Launches grouped by directions and categories for the list under «Start»: launches with the same directions
// become one row with their texts stacked, in site-file order. The map still shows each launch where it
// is (launches[].lat/lon).
export function groupLaunches(launches = []) {
  const groups = new Map();
  for (const l of (launches ?? []).filter(Boolean)) {
    const key = JSON.stringify([[...(l.directions ?? [])].sort(), [...(l.categories ?? [])].sort()]);
    if (!groups.has(key)) groups.set(key, { directions: l.directions ?? [], categories: l.categories ?? [], texts: [] });
    if (l.text) groups.get(key).texts.push(l.text);
  }
  return [...groups.values()];
}

// Directions per category, for the front page: { SPG: { primary, possible } }. Taken from the launches, where a
// launch without its own categories applies to all of the site's categories. Primary/possible follows
// wind_directions, so directions not listed there («ikke egnet») are left out. Only for sites with several
// categories, and only categories with their own launches. Otherwise the site's directions apply.
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

// Place names the front-page search matches a launch on, besides its name: municipality and region. The
// region is split on «og», and parts that are a municipality are dropped: «Harstad og Kvæfjord» must not make
// «Kvæfjord» find the launches in Harstad. «Lofoten», «Andøya» and other non-municipality regions are searchable.
export function searchPlaces(d, municipalities) {
  const parts = String(d.region ?? "").split(/\s+og\s+/).filter((p) => p && !municipalities.has(p));
  return [...new Set([d.municipality, ...parts].filter(Boolean))];
}
