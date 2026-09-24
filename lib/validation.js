// Bygget skal feile hvis en stedsfil er ugyldig.

import fs from "node:fs";
import path from "node:path";
import { DIRECTIONS, CATEGORIES, LEVELS } from "./format.js";
import { MAX_ORIGINAL_BYTES } from "./images.js";

// Tillatte nøkler i front matter. Ukjente nøkler (skrivefeil, gamle norske navn) stopper bygget.
// "[]" betyr hvert element i en liste.
const ALLOWED_KEYS = {
  "": ["name", "id", "status", "region", "external", "level", "training_site", "categories", "season",
    "wind_directions", "launch", "landings", "parking", "access", "elevation", "airspace", "hazards",
    "launches", "images", "reviewed"],
  "external": ["flightlog_id", "pgearth_id", "yr_id"],
  "wind_directions": ["primary", "possible", "source"],
  "launch": ["lat", "lon", "source"],
  "landings.[]": ["name", "lat", "lon", "primary", "source"],
  "parking.[]": ["name", "lat", "lon", "source"],
  "access": ["parking_text", "route_text", "routes", "walk_time_min"],
  "access.routes.[]": ["file", "name", "km", "elevation_gain_m", "walk_time_min"],
  "elevation": ["launch_masl", "landing_masl", "difference_m", "source"],
  "airspace.[]": ["name", "type", "class", "lower", "upper", "valid_from", "source", "nearby", "note"],
  "airspace.[].lower": ["value", "unit", "ref"],
  "airspace.[].upper": ["value", "unit", "ref"],
  "hazards.[]": ["title", "text"],
  "launches.[]": ["directions", "categories", "text"],
  "images": ["overview", "launch", "landing", "air", "overview_credit"],
  "reviewed": ["by", "date"],
};

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

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
  (data.launches ?? []).forEach((launch, i) => {
    checkDirections(launch.directions, `launches[${i}].directions`);
    for (const c of launch.categories ?? []) {
      if (!CATEGORIES.includes(c)) errors.push(`ugyldig kategori «${c}» i launches[${i}]`);
    }
  });

  for (const c of data.categories ?? []) {
    if (!CATEGORIES.includes(c)) errors.push(`ugyldig kategori «${c}»`);
  }
  if (data.level !== null && data.level !== undefined && !LEVELS.includes(data.level)) {
    errors.push(`ugyldig nivå «${data.level}» (gyldige: ${LEVELS.join(", ")})`);
  }

  if (!Number.isFinite(data.launch?.lat) || !Number.isFinite(data.launch?.lon)) {
    errors.push("mangler gyldig `launch.lat`/`launch.lon`");
  }

  // Filer fra Strava, kamera osv. har tilfeldige navn. Faste navn gjør mappene like og lette å feilsøke.
  for (const field of ["overview", "launch", "landing", "air"]) {
    const file = data.images?.[field];
    if (!file) continue;
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) errors.push(`bildet images.${field} (${file}) finnes ikke`);
    else if (fs.statSync(filePath).size > MAX_ORIGINAL_BYTES) {
      const mb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
      errors.push(`bildet ${file} er ${mb} MB (maks ${MAX_ORIGINAL_BYTES / 1024 / 1024} MB). Kjør \`npm run images\` for å skalere det ned`);
    }
    const ext = path.extname(file).toLowerCase();
    const expected = `${dirName}-${field}`;
    if (path.basename(file, path.extname(file)) !== expected || !IMAGE_EXTENSIONS.includes(ext)) {
      errors.push(`bildet images.${field} (${file}) skal hete ${expected}${IMAGE_EXTENSIONS.includes(ext) ? ext : ".jpg"}. Bruk \`npm run images -- ${dirName} ${field} <fil>\``);
    }
  }
  const routes = (data.access?.routes ?? []).filter((r) => r.file);
  routes.forEach((route, i) => {
    if (!fs.existsSync(path.join(dir, route.file))) errors.push(`gangruten ${route.file} finnes ikke`);
    const expected = routes.length === 1 ? `${dirName}-route.gpx` : `${dirName}-route-${i + 1}.gpx`;
    if (route.file !== expected) errors.push(`gangruten ${route.file} skal hete ${expected}`);
  });

  return errors.map((e) => `${inputPath}: ${e}`);
}
