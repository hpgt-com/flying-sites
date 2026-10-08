// Bildene i en stedsmappe. Bygget finner dem ut fra filnavnet, så stedsfilen har ingen liste over bilder:
//
//   <id>-overview-<nr>.jpg           oversiktsbilde, nr 1 er stedets hovedbilde
//   <id>-takeoff-<retning>-<nr>.jpg  start, retningen man ser mot når man starter (se, nw …). Retning kan mangle.
//   <id>-landing-<nr>.jpg            landing
//   <id>-landing-spg-<nr>.jpg        landing som er egen for SPG
//
// `npm run images` lager disse navnene fra bildenavnene i lib/photo-name.js.

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

// Tolker et filnavn i stedsmappen. Gir null hvis navnet ikke følger mønsteret.
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

// Teksten under bildet og i bildevisningen.
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

// Fast rekkefølge: oversikt, start, landing. Innenfor start etter nummer og så retning, innenfor landing
// vanlige landinger før SPG-landinger.
function compare(a, b) {
  return IMAGE_FIELDS.indexOf(a.field) - IMAGE_FIELDS.indexOf(b.field)
    || Number(!!a.category) - Number(!!b.category)
    || a.nr - b.nr
    || PHOTO_DIRECTIONS.indexOf(a.direction) - PHOTO_DIRECTIONS.indexOf(b.direction);
}

// Alle bildene i mappen i visningsrekkefølge, og bildefiler med navn som ikke følger mønsteret.
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

// Bildene som vises på siden: første oversiktsbilde, første start og første landing. Resten vises i
// bildevisningen («Se alle N bilder»).
export function featuredImages(images) {
  return IMAGE_FIELDS.map((field) => images.find((i) => i.field === field)).filter(Boolean);
}
