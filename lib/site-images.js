// The images in a site folder. The build finds them by file name, so the site file has no list of images:
//
//   <id>-overview-<nr>.jpg             overview photo; nr 1 is the site's main image
//   <id>-takeoff-<direction>-<nr>.jpg  launch, the direction you face when launching (se, nw …). Direction is optional.
//   <id>-landing-<nr>.jpg              landing
//   <id>-landing-spg-<nr>.jpg          SPG-only landing
//
// `npm run images` produces these names from the photo names in lib/photo-name.js.

import fs from "node:fs";
import path from "node:path";
import { PHOTO_DIRECTIONS } from "./photo-name.js";
import { directionLabel } from "./format.js";
import { dict, fmt, DEFAULT_LANG } from "./i18n.js";

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const IMAGE_FIELDS = ["overview", "takeoff", "landing"];

// The file name (without extension) for an image. direction is an English code (SE), category is "SPG" or null.
export function repoImageName({ siteId, field, direction = null, category = null, nr }) {
  return [siteId, field, direction?.toLowerCase(), category?.toLowerCase(), nr].filter(Boolean).join("-");
}

// Parses a file name in the site folder. Returns null if the name does not match the pattern.
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

// The caption below the image and in the image viewer.
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

// Fixed order: overview, launch, landing. Launch photos by number, then direction; landing photos with
// regular landings before SPG landings.
function compare(a, b) {
  return IMAGE_FIELDS.indexOf(a.field) - IMAGE_FIELDS.indexOf(b.field)
    || Number(!!a.category) - Number(!!b.category)
    || a.nr - b.nr
    || PHOTO_DIRECTIONS.indexOf(a.direction) - PHOTO_DIRECTIONS.indexOf(b.direction);
}

// All images in the folder in display order, plus image files whose names do not match the pattern.
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

// The images shown on the page: first overview, first launch and first landing photo. The rest are shown in
// the image viewer («Se alle N bilder»).
export function featuredImages(images) {
  return IMAGE_FIELDS.map((field) => images.find((i) => i.field === field)).filter(Boolean);
}
