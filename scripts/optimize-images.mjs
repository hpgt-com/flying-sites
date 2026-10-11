// Images for the site folders.
//
//   npm run images                                   Checks all images and fixes those that are too large or have GPS data.
//   npm run images -- <files or folders> [--replace]  Imports photos named by the convention
//   npm run images -- "C:/Bilder/Storlitinden_Takeoff_SE_1_DSC04968.jpg"     (see lib/photo-name.js):
//   npm run images -- "C:/Bilder/flysteder"                                   site and type are read from the name.
//   npm run images -- <id> <field> <file> [--replace]  Imports one photo outside the convention, e.g.
//   npm run images -- sollifjellet takeoff "C:/Users/deg/Downloads/IMG_1234.jpg"   (gets the next free number)
//
// Fields: takeoff, landing, overview. The image is downscaled to at most MAX_ORIGINAL_SIDE px, camera rotation
// is applied, and metadata (EXIF, GPS) is stripped. The image is saved in the site folder under the name the
// build looks for (lib/site-images.js), e.g. storlitinden-takeoff-se-1.jpg. The site file is not changed.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
import { MAX_ORIGINAL_BYTES, MAX_ORIGINAL_SIDE } from "../lib/images.js";
import { looksLikePhotoName, parsePhotoName } from "../lib/photo-name.js";
import { creditFor, exifFor, hasCredit, xmpFor } from "../lib/photo-credit.js";
import { IMAGE_FIELDS, listSiteImages, repoImageName } from "../lib/site-images.js";

const yaml = createRequire(import.meta.url)("js-yaml");

const SITES_DIR = "src/sites";
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

// On Windows the sharp cache keeps files open, so they cannot be overwritten. We read everything into memory.
sharp.cache(false);

// GPS data lives in a separate block that the first EXIF directory (IFD0) points to with tag 0x8825.
function hasGps(exif) {
  if (!exif || exif.length < 14) return false;
  const tiff = exif.subarray(exif.indexOf("Exif\0\0") === 0 ? 6 : 0);
  const little = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return false;
  const entries = u16(ifd0);
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x8825) return true;
  }
  return false;
}

const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

// Downscales, applies rotation and strips metadata. PNG stays PNG (drawings); everything else becomes JPEG.
// Only photographer, copyright, website and license are written back (lib/photo-credit.js), from the original
// or the default in src/_data/photoCredit.json.
async function optimize(input, format) {
  const credit = creditFor(await sharp(input).metadata());
  let pipeline = sharp(input)
    .rotate()
    .resize({ width: MAX_ORIGINAL_SIDE, height: MAX_ORIGINAL_SIDE, fit: "inside", withoutEnlargement: true });
  if (format === ".png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (format === ".webp") pipeline = pipeline.webp({ quality: 85 });
  else pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  // sharp drops metadata unless asked to keep it, so GPS and camera data are removed.
  return pipeline.withExif(exifFor(credit)).withXmp(xmpFor(credit)).toBuffer();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Returns false instead of exiting when called with { soft: true }, so many photos can be imported in one run.
// photo: { siteId, field, direction, category, nr }. Without nr, the next free number for the field is used.
async function importImage(photo, sourcePath, replace, { soft = false } = {}) {
  const stop = (message) => { if (soft) { console.log(message); return false; } fail(message); };
  const { siteId, field } = photo;
  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, "index.md"))) fail(`Fant ikke stedet «${siteId}» (${siteDir}/index.md).`);
  if (!IMAGE_FIELDS.includes(field)) fail(`Ukjent felt «${field}». Bruk ett av: ${IMAGE_FIELDS.join(", ")}.`);
  if (!fs.existsSync(sourcePath)) fail(`Fant ikke bildet ${sourcePath}.`);

  const existing = listSiteImages(siteDir, siteId).images;
  const nr = photo.nr ?? 1 + Math.max(0, ...existing.filter((i) => i.field === field).map((i) => i.nr));
  const name = repoImageName({ ...photo, nr });
  const format = path.extname(sourcePath).toLowerCase() === ".png" ? ".png" : ".jpg";
  const target = path.join(siteDir, name + format);
  // The same name with a different extension counts as the same image.
  const same = fs.readdirSync(siteDir).filter((f) => path.parse(f).name === name).map((f) => path.join(siteDir, f));
  if (same.length && !replace) {
    return stop(`${path.basename(same[0])} finnes allerede. Legg til --replace for å bytte det ut.`);
  }

  const input = fs.readFileSync(sourcePath);
  const before = await sharp(input).metadata();
  const output = await optimize(input, format);
  for (const f of same) if (f !== target) fs.unlinkSync(f);
  fs.writeFileSync(target, output);
  const after = await sharp(output).metadata();

  console.log(`${sourcePath}: ${before.width}×${before.height} px, ${kb(input.length)}`);
  console.log(`→ ${target}: ${after.width}×${after.height} px, ${kb(output.length)}, uten GPS og kameradata, med fotograf og lisens`);
  if (after.width < 1000) console.log(`Merk: bildet er bare ${after.width} px bredt og kan se uskarpt ut.`);
  return path.basename(target);
}

function readSites() {
  return fs.readdirSync(SITES_DIR)
    .filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")))
    .map((id) => {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8"));
      return { id, name: (fm && yaml.load(fm[1]).name) || id };
    });
}

// Imports all photos named by the convention. Type, direction, SPG and number from the name carry over to the
// file name in the repo, so Storlitinden_Takeoff_SE_2_DSC04970.jpg becomes storlitinden-takeoff-se-2.jpg.
async function importNamed(paths, replace) {
  const sites = readSites();
  const files = paths.flatMap((p) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => looksLikePhotoName(f)).map((f) => path.join(p, f))
    : [p]));
  const errors = [], photos = [], seen = new Map();
  for (const file of files) {
    try {
      const photo = parsePhotoName(path.basename(file), sites);
      const name = repoImageName(photo);
      if (seen.has(name)) throw new Error(`${path.basename(file)} og ${path.basename(seen.get(name))} blir begge ${name}. Gi et av dem et annet nummer.`);
      seen.set(name, file);
      photos.push({ file, photo });
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (errors.length) {
    console.error(`${errors.length} bilde(r) har feil navn. Ingenting er importert:`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  let imported = 0, skipped = 0;
  for (const { file, photo } of photos) {
    console.log(`\n${photo.siteName}, ${photo.type}${photo.direction ? " " + photo.direction : ""}${photo.category ? " " + photo.category : ""} ${photo.nr}:`);
    if (await importImage(photo, file, replace, { soft: true })) imported++;
    else skipped++;
  }
  if (!files.length) console.log("Fant ingen bilder navngitt etter konvensjonen (se lib/photo-name.js).");
  else console.log(`\n${imported} bilde(r) importert${skipped ? `, ${skipped} fantes fra før (bruk --replace for å bytte dem ut)` : ""}.`);
}

async function checkAll(files) {
  let changed = 0;
  for (const file of files) {
    const input = fs.readFileSync(file);
    const meta = await sharp(input).metadata();
    const reasons = [];
    if (input.length > MAX_ORIGINAL_BYTES) reasons.push(kb(input.length));
    if (Math.max(meta.width, meta.height) > MAX_ORIGINAL_SIDE) reasons.push(`${meta.width}×${meta.height} px`);
    if (hasGps(meta.exif)) reasons.push("GPS-posisjon i EXIF");
    if (meta.orientation && meta.orientation > 1) reasons.push("rotert av kameraet");
    if (!hasCredit(meta)) reasons.push("mangler fotograf og lisens");
    if (!reasons.length) continue;

    const output = await optimize(input, path.extname(file).toLowerCase());
    fs.writeFileSync(file, output);
    const after = await sharp(output).metadata();
    console.log(`${file}: ${reasons.join(", ")} → ${after.width}×${after.height} px, ${kb(output.length)}`);
    changed++;
  }
  console.log(changed ? `${changed} bilde(r) oppdatert.` : "Alle bildene er allerede innenfor grensene.");
}

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const positional = args.filter((a) => a !== "--replace");

// Three arguments where the first is not a file means a single import (<id> <field> <file>); importImage checks the rest.
// Files named by the convention, or folders, are imported with site and type taken from the name.
// Other files (such as the site folders' own images) are checked and shrunk.
const isNamedImport = (p) => fs.existsSync(p) && (fs.statSync(p).isDirectory() || looksLikePhotoName(path.basename(p)));
if (positional.length === 3 && !fs.existsSync(positional[0])) {
  await importImage({ siteId: positional[0], field: positional[1] }, positional[2], replace);
} else if (positional.length && positional.every(isNamedImport)) {
  await importNamed(positional, replace);
} else if (positional.length) {
  await checkAll(positional);
} else {
  const files = fs.readdirSync(SITES_DIR)
    .map((id) => path.join(SITES_DIR, id))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f)).map((f) => path.join(dir, f)));
  await checkAll(files);
}
