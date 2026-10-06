// Bygget skal feile hvis en stedsfil er ugyldig.

import fs from "node:fs";
import path from "node:path";
import { DIRECTIONS, CATEGORIES, LEVELS } from "./format.js";
import { MAX_ORIGINAL_BYTES } from "./images.js";
import { readDrawing, validateDrawing } from "./drawing.js";
import { listSiteImages } from "./site-images.js";

// Tillatte nøkler i front matter. Ukjente nøkler (skrivefeil, gamle norske navn) stopper bygget.
// "[]" betyr hvert element i en liste.
const ALLOWED_KEYS = {
  "": ["name", "id", "status", "region", "external", "level", "training_site", "categories", "season",
    "wind_directions", "wind_limits", "launch", "landings", "parking", "access", "elevation", "airspace", "hazards",
    "launches", "reviewed", "links"],
  "external": ["flightlog_id", "pgearth_id", "yr_id"],
  "wind_directions": ["primary", "possible", "source"],
  "wind_limits": ["max_wind", "source"],
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

const STATUSES = ["utkast", "gjennomgått"];

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

// Eleventy legger egne felt i data-objektet, så ukjente nøkler sjekkes mot rå front matter.
export function validateSite(data, inputPath, frontMatter) {
  const errors = [];
  const dir = path.dirname(inputPath);
  const dirName = path.basename(dir);

  if (frontMatter) findUnknownKeys(frontMatter, [], errors);

  if (!data.name || typeof data.name !== "string") errors.push("mangler `name`");

  // `status: gjennomgått` settes sammen med hvem og når. Datoen skrives som '2026-09-24'.
  // Lenker under «Logg og mer» (for eksempel alpinsenteret med åpningstider for heisen). Bare https.
  for (const link of data.links ?? []) {
    if (!link.title || !/^https:\/\//.test(link.url ?? "")) errors.push(`links trenger title og en https-adresse (${link.url ?? "mangler url"})`);
  }
  if (!STATUSES.includes(data.status)) errors.push(`ugyldig status «${data.status}» (gyldige: ${STATUSES.join(", ")})`);
  const reviewedDate = data.reviewed?.date;
  if (reviewedDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(reviewedDate instanceof Date ? reviewedDate.toISOString().slice(0, 10) : reviewedDate))) {
    errors.push(`reviewed.date (${reviewedDate}) skal skrives som '2026-09-24'`);
  }
  if (data.status === "gjennomgått" && !(data.reviewed?.by && reviewedDate)) {
    errors.push("status er «gjennomgått», men reviewed.by og reviewed.date er ikke satt");
  }
  if (data.status === "utkast" && data.reviewed?.by && reviewedDate) {
    errors.push("reviewed.by og reviewed.date er satt, men status er fortsatt «utkast»");
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
  // Avstand i km mellom to punkter. Godt nok på de korte avstandene her.
  const distanceKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));

  (data.launches ?? []).forEach((launch, i) => {
    checkDirections(launch.directions, `launches[${i}].directions`);
    for (const c of launch.categories ?? []) {
      if (!CATEGORIES.includes(c)) errors.push(`ugyldig kategori «${c}» i launches[${i}]`);
    }
    // Egen posisjon for starten (valgfritt). Da får den egen vindrose i kartet på stedssiden.
    const hasLat = launch.lat !== null && launch.lat !== undefined;
    const hasLon = launch.lon !== null && launch.lon !== undefined;
    if (hasLat !== hasLon) errors.push(`launches[${i}] må ha både lat og lon, eller ingen av dem`);
    else if (hasLat) {
      if (!Number.isFinite(launch.lat) || !Number.isFinite(launch.lon)) errors.push(`launches[${i}].lat/lon må være tall`);
      else if (Number.isFinite(data.launch?.lat) && Number.isFinite(data.launch?.lon)) {
        // Fanger byttet lat/lon og kopieringsfeil: alle startene på et sted ligger nær hovedstarten.
        const km = distanceKm(launch, data.launch);
        if (km > 5) errors.push(`launches[${i}] ligger ${km.toFixed(1)} km fra launch.lat/lon (maks 5 km)`);
      }
    }
  });

  // Stedets egen vindgrense, brukt i vindvurderingen på forsiden i stedet for felles maxWind.
  const maxWind = data.wind_limits?.max_wind;
  if (maxWind !== null && maxWind !== undefined && !(typeof maxWind === "number" && maxWind > 0 && maxWind <= 20)) {
    errors.push(`wind_limits.max_wind (${maxWind}) må være et tall i m/s mellom 0 og 20`);
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

  // Filer fra Strava, kamera osv. har tilfeldige navn. Bygget finner bildene ut fra navnet (lib/site-images.js),
  // så et bilde med feil navn ville ellers bare blitt borte fra siden.
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

  // Tegningen til 3D-visningen (valgfri), se lib/drawing.js.
  try {
    const drawing = readDrawing(dir, dirName);
    if (drawing) errors.push(...validateDrawing(drawing, data.launch).map((e) => `${dirName}-drawing.geojson: ${e}`));
  } catch (err) {
    errors.push(`${dirName}-drawing.geojson er ikke gyldig JSON: ${err.message}`);
  }

  return errors.map((e) => `${inputPath}: ${e}`);
}
