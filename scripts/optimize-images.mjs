// Bilder til stedsmappene.
//
//   npm run images                                   Sjekker alle bilder og retter de som er for store eller har GPS-data.
//   npm run images -- <id> <felt> <fil> [--replace]  Importerer et nytt bilde, f.eks.
//   npm run images -- sollifjellet launch "C:/Users/deg/Downloads/IMG_1234.jpg"
//   npm run images -- <filer eller mapper> [--replace]  Importerer bilder navngitt etter konvensjonen
//   npm run images -- "C:/Bilder/Storlitinden_Takeoff_SE_1_DSC04968.jpg"     (se lib/photo-name.js):
//   npm run images -- "C:/Bilder/flysteder"                                   sted og type leses fra navnet.
//
// Felt: launch, landing, air. Bildet skaleres ned til maks MAX_ORIGINAL_SIDE px, rotasjon fra
// kameraet rettes opp, og metadata (EXIF, GPS) fjernes. Importen skriver aldri i stedsfilen, den skriver
// bare ut linjen som skal inn under `images:`.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
import { MAX_ORIGINAL_BYTES, MAX_ORIGINAL_SIDE } from "../lib/images.js";
import { looksLikePhotoName, parsePhotoName } from "../lib/photo-name.js";

const yaml = createRequire(import.meta.url)("js-yaml");

const SITES_DIR = "src/flysteder";
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
const FIELDS = ["launch", "landing", "air"];

// På Windows holder sharp-cachen filen åpen, så den kan ikke skrives over. Vi leser alt inn i minnet.
sharp.cache(false);

// GPS-data ligger i en egen blokk som første katalog (IFD0) i EXIF peker til med tag 0x8825.
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

// Skalerer ned, retter rotasjon og fjerner metadata. PNG forblir PNG (tegninger), alt annet blir JPEG.
async function optimize(input, format) {
  let pipeline = sharp(input)
    .rotate()
    .resize({ width: MAX_ORIGINAL_SIDE, height: MAX_ORIGINAL_SIDE, fit: "inside", withoutEnlargement: true });
  if (format === ".png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (format === ".webp") pipeline = pipeline.webp({ quality: 85 });
  else pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  return pipeline.toBuffer(); // sharp tar ikke med metadata med mindre vi ber om det
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Gir false i stedet for å avslutte når kalt med { soft: true }, så mange bilder kan importeres i én kjøring.
async function importImage(siteId, field, sourcePath, replace, { soft = false } = {}) {
  const stop = (message) => { if (soft) { console.log(message); return false; } fail(message); };
  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, "index.md"))) fail(`Fant ikke stedet «${siteId}» (${siteDir}/index.md).`);
  if (!FIELDS.includes(field)) fail(`Ukjent felt «${field}». Bruk ett av: ${FIELDS.join(", ")}.`);
  if (!fs.existsSync(sourcePath)) fail(`Fant ikke bildet ${sourcePath}.`);

  const format = path.extname(sourcePath).toLowerCase() === ".png" ? ".png" : ".jpg";
  const target = path.join(siteDir, `${siteId}-${field}${format}`);
  const others = FIELDS.includes(field) && fs.readdirSync(siteDir).filter((f) => f.startsWith(`${siteId}-${field}.`) && path.join(siteDir, f) !== target);
  if ((fs.existsSync(target) || others.length) && !replace) {
    return stop(`${siteId} har allerede et ${field}-bilde. Legg til --replace for å bytte det ut.`);
  }

  const input = fs.readFileSync(sourcePath);
  const before = await sharp(input).metadata();
  const output = await optimize(input, format);
  for (const f of others) fs.unlinkSync(path.join(siteDir, f)); // gammelt bilde med annen filtype
  fs.writeFileSync(target, output);
  const after = await sharp(output).metadata();

  console.log(`${sourcePath}: ${before.width}×${before.height} px, ${kb(input.length)}`);
  console.log(`→ ${target}: ${after.width}×${after.height} px, ${kb(output.length)}, uten metadata`);
  if (after.width < 1000) console.log(`Merk: bildet er bare ${after.width} px bredt og kan se uskarpt ut.`);
  if (soft) return path.basename(target);
  console.log(`\nLegg inn dette under \`images:\` i ${siteDir}/index.md:\n  ${field}: ${path.basename(target)}`);
}

function readSites() {
  return fs.readdirSync(SITES_DIR)
    .filter((id) => fs.existsSync(path.join(SITES_DIR, id, "index.md")))
    .map((id) => {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(SITES_DIR, id, "index.md"), "utf8"));
      return { id, name: (fm && yaml.load(fm[1]).name) || id };
    });
}

// Setter `images.<field>: <fil>` i stedsfilen. Endrer bare den ene linjen (eller legger den til), og sjekker
// etterpå at front matter fortsatt er gyldig YAML med riktig verdi.
function setImageInSiteFile(siteId, field, file) {
  const mdPath = path.join(SITES_DIR, siteId, "index.md");
  const text = fs.readFileSync(mdPath, "utf8");
  const end = text.indexOf("\n---", 4);
  let fm = text.slice(0, end);
  const line = `  ${field}: ${file}`;
  if (/^images:\s*$/m.test(fm)) {
    const block = /^images:\s*\n((?:  .*\n?)*)/m.exec(fm);
    const fieldLine = new RegExp(`^  ${field}:.*$`, "m");
    const body = fieldLine.test(block[1]) ? block[1].replace(fieldLine, line) : block[1].replace(/\n?$/, "\n") + line + "\n";
    fm = fm.replace(block[0], "images:\n" + body.replace(/\n+$/, "\n"));
  } else {
    fm = fm.replace(/\n?$/, "\n") + `images:\n${line}`;
  }
  const next = fm.replace(/\n+$/, "") + text.slice(end);
  const parsed = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(next)[1]);
  if (parsed.images?.[field] !== file) throw new Error(`Klarte ikke å oppdatere images.${field} i ${mdPath}. Legg inn linjen selv: ${line}`);
  fs.writeFileSync(mdPath, next);
}

// Importerer bilder navngitt etter konvensjonen. Siden viser foreløpig ett bilde per type (start, landing,
// fra luften), så for hver type på hvert sted brukes bildet med lavest nummer. De andre hoppes over.
async function importNamed(paths, replace) {
  const sites = readSites();
  const files = paths.flatMap((p) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => looksLikePhotoName(f)).map((f) => path.join(p, f))
    : [p]));
  const errors = [], chosen = new Map(), skipped = [];
  for (const file of files) {
    try {
      const photo = parsePhotoName(path.basename(file), sites);
      const key = `${photo.siteId}/${photo.field}`;
      const current = chosen.get(key);
      if (!current || photo.nr < current.photo.nr) {
        if (current) skipped.push(current.file);
        chosen.set(key, { file, photo });
      } else skipped.push(file);
    } catch (err) {
      errors.push(err.message);
    }
  }
  for (const { file, photo } of chosen.values()) {
    console.log(`\n${photo.siteName}, ${photo.type}${photo.direction ? " " + photo.direction : ""}:`);
    const target = await importImage(photo.siteId, photo.field, file, replace, { soft: true });
    if (target) {
      setImageInSiteFile(photo.siteId, photo.field, target);
      console.log(`Lagt inn i ${SITES_DIR}/${photo.siteId}/index.md: images.${photo.field}: ${target}`);
    }
  }
  if (skipped.length) {
    console.log(`\nIkke importert (siden viser foreløpig ett bilde per type, det med lavest nummer):`);
    for (const f of skipped) console.log(`  ${path.basename(f)}`);
  }
  if (errors.length) {
    console.error(`\n${errors.length} bilde(r) har feil navn og ble ikke importert:`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  if (!files.length) console.log("Fant ingen bilder navngitt etter konvensjonen (se lib/photo-name.js).");
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

// Tre argumenter der det første ikke er en fil, er en import (<id> <felt> <fil>). importImage sjekker resten.
// Filer navngitt etter konvensjonen, eller mapper, importeres med sted og type fra navnet.
// Andre filer (som stedsmappenes egne bilder) sjekkes og krympes.
const isNamedImport = (p) => fs.existsSync(p) && (fs.statSync(p).isDirectory() || looksLikePhotoName(path.basename(p)));
if (positional.length === 3 && !fs.existsSync(positional[0])) {
  await importImage(positional[0], positional[1], positional[2], replace);
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
