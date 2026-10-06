// Bilder på stedssidene: lager visningsstørrelser (WebP + JPEG) med srcset ved bygging.
// Originalene publiseres ikke, så EXIF og store filer aldri havner på siden.

import path from "node:path";
import Image from "@11ty/eleventy-img";
import sharp from "sharp";
import { creditFor, exifFor, xmpFor } from "./photo-credit.js";

// Grenser for originaler i repoet. `npm run images` skalerer ned og vasker metadata.
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
export const MAX_ORIGINAL_SIDE = 2560;

// 2400 brukes bare i bildevisningen på store skjermer og retina (lightbox.js), ikke på selve siden.
const WIDTHS = [400, 800, 1200, 1600, 2400];
const PAGE_MAX_WIDTH = 1600;
const URL_PATH = "/img/";

// Uten cache holder ikke sharp filene åpne, så `npm run images` kan skrive mens forhåndsvisningen kjører.
sharp.cache(false);

// Genererer bildet i <outputDir>/img/ og returnerer det malen trenger. `field` er launch, landing eller air.
// Bredder større enn originalen hoppes over, så små bilder strekkes ikke.
export async function processImage(dir, siteId, field, file, { alt, sizes, outputDir }) {
  const source = path.join(dir, file);
  // Fotograf og lisens fra bildet (satt ved import), skrevet inn i alle størrelsene som lages.
  const credit = creditFor(await sharp(source).metadata());
  const metadata = await Image(source, {
    transform: function addCredit(image) {
      image.withExif(exifFor(credit)).withXmp(xmpFor(credit));
    },
    widths: WIDTHS,
    formats: ["webp", "jpeg"],
    outputDir: path.join(outputDir, "img"),
    urlPath: URL_PATH,
    filenameFormat: (hash, src, width, format) => `${siteId}-${field}-${width}-${hash}.${format}`,
  });
  const largest = metadata.jpeg[metadata.jpeg.length - 1];
  return {
    file,
    width: largest.width,
    height: largest.height,
    fullUrl: largest.url,
    // Til forhåndsvisning ved deling (og:image). Facebook anbefaler minst 1200 px bredde.
    shareUrl: (metadata.jpeg.find((e) => e.width >= 1200) ?? largest).url,
    // Til bildevisningen (lightbox.js), som velger størrelse etter skjermen.
    srcsetWebp: metadata.webp.map((e) => e.srcset).join(", "),
    srcsetJpeg: metadata.jpeg.map((e) => e.srcset).join(", "),
    // På selve siden er bildene små, så de største variantene tas ikke med.
    credit,
    html: Image.generateHTML(onlyUpTo(metadata, PAGE_MAX_WIDTH), { alt, sizes, loading: "lazy", decoding: "async" }),
  };
}

// Samme metadata, uten varianter bredere enn maxWidth. Er alle bredere (lite sannsynlig), beholdes den minste.
function onlyUpTo(metadata, maxWidth) {
  const result = {};
  for (const [format, entries] of Object.entries(metadata)) {
    const kept = entries.filter((e) => e.width <= maxWidth);
    result[format] = kept.length ? kept : entries.slice(0, 1);
  }
  return result;
}
