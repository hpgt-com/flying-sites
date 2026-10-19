// The build must fail if a site file is invalid.

import fs from "node:fs";
import path from "node:path";
import { DIRECTIONS, CATEGORIES, LEVELS } from "./format.js";
import { MAX_ORIGINAL_BYTES } from "./images.js";
import { readDrawing, validateDrawing } from "./drawing.js";
import { listSiteImages } from "./site-images.js";

// Allowed keys in front matter. Unknown keys (typos, old Norwegian names) fail the build.
// "[]" means each item in a list.
const ALLOWED_KEYS = {
  "": ["name", "id", "status", "region", "municipality", "external", "level", "training_site", "categories", "season",
    "wind_directions", "wind_limits", "launch", "landings", "no_fixed_landing", "parking", "access", "elevation", "airspace", "hazards",
    "launches", "reviewed", "links"],
  "external": ["flightlog_id", "yr_id"],
  "wind_directions": ["primary", "possible", "source"],
  "wind_limits": ["max_wind", "soar_min_wind", "source"],
  "launch": ["lat", "lon", "source"],
  "landings.[]": ["name", "lat", "lon", "primary", "source"],
  "parking.[]": ["name", "lat", "lon", "masl", "source"],
  "access": ["parking_text", "route_text", "routes", "walk_time_min"],
  "links.[]": ["title", "text", "url"],
  "access.routes.[]": ["file", "name", "km", "elevation_gain_m", "walk_time_min"],
  "elevation": ["launch_masl", "landing_masl", "difference_m", "source"],
  "airspace.[]": ["name", "type", "class", "lower", "upper", "valid_from", "source", "nearby", "note"],
  "airspace.[].lower": ["value", "unit", "ref"],
  "airspace.[].upper": ["value", "unit", "ref"],
  "hazards.[]": ["title", "text"],
  "launches.[]": ["directions", "categories", "text", "lat", "lon", "source"],
  "reviewed": ["by", "date"],
};

const STATUSES = ["draft", "reviewed"];
// Valid `source` values (the sources line at the bottom of the site page, sources.labels in the dictionary).
export const SOURCES = ["manual", "gpx", "kartverket", "flightlog", "local_knowledge", "flightlog/local_knowledge",
  "kartverket/flightlog", "flightlog/gpx", "ippc", "old_site"];

function findUnknownKeys(value, keyPath, errors) {
  if (Array.isArray(value)) {
    value.forEach((v) => findUnknownKeys(v, [...keyPath, "[]"], errors));
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date) return;
  const allowed = ALLOWED_KEYS[keyPath.join(".")];
  if (!allowed) return;
  for (const [key, v] of Object.entries(value)) {
    const fullPath = [...keyPath, key].join(".").replace(/\.\[\]/g, "[]");
    if (!allowed.includes(key)) errors.push(`ukjent nøkkel \`${fullPath}\``);
    else findUnknownKeys(v, [...keyPath, key], errors);
  }
}

// Eleventy adds its own fields to the data object, so unknown keys are checked against the raw front matter.
export function validateSite(data, inputPath, frontMatter) {
  const errors = [];
  const dir = path.dirname(inputPath);
  const dirName = path.basename(dir);

  if (frontMatter) findUnknownKeys(frontMatter, [], errors);

  if (!data.name || typeof data.name !== "string") errors.push("mangler `name`");
  // The municipality the launch is in (from Kartverket), so the front-page search finds the site on «Kvæfjord».
  if (!data.municipality || typeof data.municipality !== "string") errors.push("mangler `municipality` (kommunen starten ligger i)");

  // Links under «Logg og mer» (e.g. the ski resort with lift opening hours). https only.
  for (const link of data.links ?? []) {
    if (!link.title || !/^https:\/\//.test(link.url ?? "")) errors.push(`links trenger title og en https-adresse (${link.url ?? "mangler url"})`);
  }
  // All `source` values in front matter, so the sources line always has a text and the values stay consistent.
  const sources = [data.launch, data.wind_directions, data.wind_limits, data.elevation, ...(data.landings ?? []),
    ...(data.parking ?? []), ...(data.launches ?? []), ...(data.airspace ?? [])].map((x) => x?.source).filter((x) => x != null);
  for (const source of new Set(sources)) {
    if (!SOURCES.includes(source)) errors.push(`ukjent source «${source}» (gyldige: ${SOURCES.join(", ")})`);
  }
  if (!STATUSES.includes(data.status)) errors.push(`ugyldig status «${data.status}» (gyldige: ${STATUSES.join(", ")})`);
  // `status: reviewed` is set together with who and when. The date is written as '2026-09-24'.
  const reviewedDate = data.reviewed?.date;
  if (reviewedDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(reviewedDate instanceof Date ? reviewedDate.toISOString().slice(0, 10) : reviewedDate))) {
    errors.push(`reviewed.date (${reviewedDate}) skal skrives som '2026-09-24'`);
  }
  if (data.status === "reviewed" && !(data.reviewed?.by && reviewedDate)) {
    errors.push("status er «reviewed», men reviewed.by og reviewed.date er ikke satt");
  }
  if (data.status === "draft" && data.reviewed?.by && reviewedDate) {
    errors.push("reviewed.by og reviewed.date er satt, men status er fortsatt «draft»");
  }
  // Sites without a fixed landing (like Ramnskogheia, where you land on the bogs around the mountain) are marked
  // `no_fixed_landing: true`. Then no landing may be mapped.
  if (data.no_fixed_landing !== undefined && typeof data.no_fixed_landing !== "boolean") {
    errors.push("no_fixed_landing må være true eller false");
  }
  if (data.no_fixed_landing && (data.landings ?? []).length) {
    errors.push("no_fixed_landing er satt, men stedet har landinger. Fjern den ene");
  }
  if (data.id !== dirName) errors.push(`\`id\` (${data.id}) er ikke lik mappenavnet (${dirName})`);

  const checkDirections = (list, where) => {
    if (list === null || list === undefined) return;
    if (!Array.isArray(list)) return errors.push(`${where} må være en liste`);
    for (const code of list) {
      if (!DIRECTIONS.includes(code)) errors.push(`ugyldig retningskode «${code}» i ${where} (gyldige: ${DIRECTIONS.join(", ")})`);
    }
  };
  checkDirections(data.wind_directions?.primary, "wind_directions.primary");
  checkDirections(data.wind_directions?.possible, "wind_directions.possible");
  // Distance in km between two points. Good enough for the short distances here.
  const distanceKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));

  (data.launches ?? []).forEach((launch, i) => {
    checkDirections(launch.directions, `launches[${i}].directions`);
    for (const c of launch.categories ?? []) {
      if (!CATEGORIES.includes(c)) errors.push(`ugyldig kategori «${c}» i launches[${i}]`);
    }
    // Optional own position for the launch. It then gets its own wind rose on the site page map.
    const hasLat = launch.lat !== null && launch.lat !== undefined;
    const hasLon = launch.lon !== null && launch.lon !== undefined;
    if (hasLat !== hasLon) errors.push(`launches[${i}] må ha både lat og lon, eller ingen av dem`);
    else if (hasLat) {
      if (!Number.isFinite(launch.lat) || !Number.isFinite(launch.lon)) errors.push(`launches[${i}].lat/lon må være tall`);
      else if (Number.isFinite(data.launch?.lat) && Number.isFinite(data.launch?.lon)) {
        // Catches swapped lat/lon and copy-paste errors: all launches at a site are near the main launch.
        const km = distanceKm(launch, data.launch);
        if (km > 5) errors.push(`launches[${i}] ligger ${km.toFixed(1)} km fra launch.lat/lon (maks 5 km)`);
      }
    }
  });

  // The site's own wind limit, used in the front-page wind assessment instead of the shared maxWind.
  const maxWind = data.wind_limits?.max_wind;
  if (maxWind !== null && maxWind !== undefined && !(typeof maxWind === "number" && maxWind > 0 && maxWind <= 20)) {
    errors.push(`wind_limits.max_wind (${maxWind}) må være et tall i m/s mellom 0 og 20`);
  }
  // How much wind it takes to stay up (soar) at the site: only a note in the assessment, never a limit.
  const soar = data.wind_limits?.soar_min_wind;
  if (soar !== null && soar !== undefined) {
    if (!(typeof soar === "number" && soar > 0 && soar <= 20)) errors.push(`wind_limits.soar_min_wind (${soar}) må være et tall i m/s mellom 0 og 20`);
    else if (typeof maxWind === "number" && soar >= maxWind) errors.push(`wind_limits.soar_min_wind (${soar}) må være lavere enn max_wind (${maxWind})`);
    else if (soar >= 7 && maxWind == null) errors.push(`wind_limits.soar_min_wind (${soar}) må være lavere enn den felles vindgrensen (7 m/s)`);
  }

  for (const c of data.categories ?? []) {
    if (!CATEGORIES.includes(c)) errors.push(`ugyldig kategori «${c}»`);
  }
  if (data.level !== null && data.level !== undefined && !LEVELS.includes(data.level)) {
    errors.push(`ugyldig nivå «${data.level}» (gyldige: ${LEVELS.join(", ")})`);
  }

  if (!Number.isFinite(data.launch?.lat) || !Number.isFinite(data.launch?.lon)) {
    errors.push("mangler gyldig `launch.lat`/`launch.lon`");
  }

  // Files from Strava, cameras etc. have arbitrary names. The build finds images by name (lib/site-images.js),
  // so a wrongly named image would otherwise silently disappear from the page.
  const { images, invalid } = listSiteImages(dir, dirName);
  for (const file of invalid) {
    errors.push(`bildet ${file} har feil navn. Bilder heter ${dirName}-overview-1.jpg, ${dirName}-takeoff-se-1.jpg, ${dirName}-landing-1.jpg eller ${dirName}-landing-spg-1.jpg. Bruk \`npm run images\``);
  }
  for (const { file } of images) {
    const size = fs.statSync(path.join(dir, file)).size;
    if (size > MAX_ORIGINAL_BYTES) {
      errors.push(`bildet ${file} er ${(size / 1024 / 1024).toFixed(1)} MB (maks ${MAX_ORIGINAL_BYTES / 1024 / 1024} MB). Kjør \`npm run images\` for å skalere det ned`);
    }
  }
  const routes = (data.access?.routes ?? []).filter((r) => r.file);
  routes.forEach((route, i) => {
    if (!fs.existsSync(path.join(dir, route.file))) errors.push(`gangruten ${route.file} finnes ikke`);
    const expected = routes.length === 1 ? `${dirName}-route.gpx` : `${dirName}-route-${i + 1}.gpx`;
    if (route.file !== expected) errors.push(`gangruten ${route.file} skal hete ${expected}`);
  });

  // The drawing for the 3D view (optional), see lib/drawing.js.
  try {
    const drawing = readDrawing(dir, dirName);
    if (drawing) errors.push(...validateDrawing(drawing, data.launch).map((e) => `${dirName}-drawing.geojson: ${e}`));
  } catch (err) {
    errors.push(`${dirName}-drawing.geojson er ikke gyldig JSON: ${err.message}`);
  }

  return errors.map((e) => `${inputPath}: ${e}`);
}
