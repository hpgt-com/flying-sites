// Bilder til stedsmappene.
//
//   npm run images                                   Sjekker alle bilder og retter de som er for store eller har GPS-data.
//   npm run images -- <id> <felt> <fil> [--replace]  Importerer et nytt bilde, f.eks.
//   npm run images -- sollifjellet launch "C:/Users/deg/Downloads/IMG_1234.jpg"
//
// Felt: overview, launch, landing, air. Bildet skaleres ned til maks MAX_ORIGINAL_SIDE px, rotasjon fra
// kameraet rettes opp, og metadata (EXIF, GPS) fjernes. Importen skriver aldri i stedsfilen, den skriver
// bare ut linjen som skal inn under `images:`.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MAX_ORIGINAL_BYTES, MAX_ORIGINAL_SIDE } from "../lib/images.js";

const SITES_DIR = "src/flysteder";
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
const FIELDS = ["overview", "launch", "landing", "air"];

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

async function importImage(siteId, field, sourcePath, replace) {
  const siteDir = path.join(SITES_DIR, siteId);
  if (!fs.existsSync(path.join(siteDir, "index.md"))) fail(`Fant ikke stedet «${siteId}» (${siteDir}/index.md).`);
  if (!FIELDS.includes(field)) fail(`Ukjent felt «${field}». Bruk ett av: ${FIELDS.join(", ")}.`);
  if (!fs.existsSync(sourcePath)) fail(`Fant ikke bildet ${sourcePath}.`);

  const format = path.extname(sourcePath).toLowerCase() === ".png" ? ".png" : ".jpg";
  const target = path.join(siteDir, `${siteId}-${field}${format}`);
  const others = FIELDS.includes(field) && fs.readdirSync(siteDir).filter((f) => f.startsWith(`${siteId}-${field}.`) && path.join(siteDir, f) !== target);
  if ((fs.existsSync(target) || others.length) && !replace) {
    fail(`${siteId} har allerede et ${field}-bilde. Legg til --replace for å bytte det ut.`);
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
  console.log(`\nLegg inn dette under \`images:\` i ${siteDir}/index.md:\n  ${field}: ${path.basename(target)}`);
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
if (positional.length === 3 && !fs.existsSync(positional[0])) {
  await importImage(positional[0], positional[1], positional[2], replace);
} else if (positional.length) {
  await checkAll(positional);
} else {
  const files = fs.readdirSync(SITES_DIR)
    .map((id) => path.join(SITES_DIR, id))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f)).map((f) => path.join(dir, f)));
  await checkAll(files);
}
