// Bildene i mappen til et flysted. Byggingen finner dem etter filnavn, så flystedsfilen har ingen liste over bilder:
//
//   <id>-overview-<nr>.jpg             oversiktsbilde; nr 1 er hovedbildet for flystedet
//   <id>-takeoff-<direction>-<nr>.jpg  start, retningen du står mot når du starter (se, nw …). Retning er valgfri.
//   <id>-landing-<nr>.jpg              landing
//   <id>-landing-spg-<nr>.jpg          landing bare for SPG
//
// `npm run images` lager disse navnene ut fra bildenavnene i lib/photo-name.js.

import fs from "node:fs";
import path from "node:path";
import { PHOTO_DIRECTIONS } from "./photo-name.js";
import { directionLabel } from "./format.js";
import { dict, fmt, DEFAULT_LANG } from "./i18n.js";

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const IMAGE_FIELDS = ["overview", "takeoff", "landing"];

// Filnavnet (uten filtype) for et bilde. direction er en engelsk kode (SE), category er "SPG" eller null.
export function repoImageName({ siteId, field, direction = null, category = null, nr }) {
  return [siteId, field, direction?.toLowerCase(), category?.toLowerCase(), nr].filter(Boolean).join("-");
}

// Tolker et filnavn i mappen til flystedet. Gir null hvis navnet ikke følger mønsteret.
export function parseRepoImageName(file, siteId) {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;
  const base = path.basename(file, path.extname(file));
  if (!base.startsWith(`${siteId}-`)) return null;
  const m = /^(overview|takeoff|landing)(?:-([a-z]{1,2}))?(?:-(spg))?-([1-9]\d*)$/.exec(base.slice(siteId.length + 1));
  if (!m) return null;
  const [, field, dir, spg, nr] = m;
  const direction = dir ? dir.toUpperCase() : null;
  if (direction && (field !== "takeoff" || !PHOTO_DIRECTIONS.includes(direction))) return null;
  if (spg && field !== "landing") return null;
  return { file, field, direction, category: spg ? "SPG" : null, nr: Number(nr) };
}

// Bildeteksten under bildet og i bildeviseren.
export function imageCaption({ field, direction, category }, lang = DEFAULT_LANG) {
  const t = dict(lang).images;
  if (field === "overview") return t.overview;
  if (field === "takeoff") return direction ? fmt(t.takeoffToward, { dir: directionLabel(direction, lang) }) : t.takeoff;
  return category ? fmt(t.categoryLanding, { category }) : t.landing;
}

export function imageAlt({ field, category }, siteName, lang = DEFAULT_LANG) {
  const t = dict(lang).images;
  if (field === "overview") return fmt(t.altOverview, { name: siteName });
  if (field === "takeoff") return fmt(t.altTakeoff, { name: siteName });
  return category ? fmt(t.altCategoryLanding, { category, name: siteName }) : fmt(t.altLanding, { name: siteName });
}

// Fast rekkefølge: oversikt, start, landing. Startbilder etter nummer, så retning; landingsbilder med
// vanlige landinger før SPG-landinger.
function compare(a, b) {
  return IMAGE_FIELDS.indexOf(a.field) - IMAGE_FIELDS.indexOf(b.field)
    || Number(!!a.category) - Number(!!b.category)
    || a.nr - b.nr
    || PHOTO_DIRECTIONS.indexOf(a.direction) - PHOTO_DIRECTIONS.indexOf(b.direction);
}

// Alle bildene i mappen i visningsrekkefølge, pluss bildefiler med navn som ikke følger mønsteret.
export function listSiteImages(dir, siteId) {
  const images = [];
  const invalid = [];
  for (const file of fs.readdirSync(dir)) {
    if (!IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) continue;
    const image = parseRepoImageName(file, siteId);
    if (image) images.push(image);
    else invalid.push(file);
  }
  return { images: images.sort(compare), invalid };
}

// Bildene som vises på siden: første oversiktsbilde, første startbilde og første landingsbilde. Resten vises i
// bildeviseren («Se alle N bilder»).
export function featuredImages(images) {
  return IMAGE_FIELDS.map((field) => images.find((i) => i.field === field)).filter(Boolean);
}
