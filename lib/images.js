// Bilder på flystedssidene: lager visningsstørrelser (WebP + JPEG) med srcset ved bygging.
// Originalene publiseres ikke, så EXIF-data og store filer kommer aldri ut på nettstedet.

import path from "node:path";
import Image from "@11ty/eleventy-img";
import sharp from "sharp";
import { creditFor, exifFor, xmpFor } from "./photo-credit.js";

// Grenser for originalene i repoet. `npm run images` skalerer dem ned og fjerner metadata.
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
export const MAX_ORIGINAL_SIDE = 2560;

// 2400 brukes bare i bildeviseren på store skjermer og retina-skjermer (lightbox.js), ikke på selve siden.
const WIDTHS = [400, 800, 1200, 1600, 2400];
const PAGE_MAX_WIDTH = 1600;
const URL_PATH = "/img/";

// Uten cachen holder ikke sharp filer åpne, så `npm run images` kan skrive mens forhåndsvisningsserveren kjører.
sharp.cache(false);

// Lager bildet i <outputDir>/img/ og gir det malen trenger. Filene får bildenavnet foran
// (sollifjellet-takeoff-se-1-800-<hash>.webp). Bredder større enn originalen hoppes over, så små bilder
// ikke skaleres opp.
export async function processImage(dir, file, { alt, sizes, outputDir }) {
  const source = path.join(dir, file);
  // Fotograf og lisens fra bildet (satt ved import), skrives inn i hver størrelse som lages.
  const credit = creditFor(await sharp(source).metadata());
  const metadata = await Image(source, {
    transform: function addCredit(image) {
      image.withExif(exifFor(credit)).withXmp(xmpFor(credit));
    },
    widths: WIDTHS,
    formats: ["webp", "jpeg"],
    outputDir: path.join(outputDir, "img"),
    urlPath: URL_PATH,
    filenameFormat: (hash, src, width, format) => `${path.parse(file).name}-${width}-${hash}.${format}`,
  });
  const largest = metadata.jpeg[metadata.jpeg.length - 1];
  return {
    file,
    width: largest.width,
    height: largest.height,
    fullUrl: largest.url,
    // For forhåndsvisning ved deling (og:image). Facebook anbefaler minst 1200 px bredde.
    shareUrl: (metadata.jpeg.find((e) => e.width >= 1200) ?? largest).url,
    // For bildeviseren (lightbox.js), som velger en størrelse som passer skjermen.
    srcsetWebp: metadata.webp.map((e) => e.srcset).join(", "),
    srcsetJpeg: metadata.jpeg.map((e) => e.srcset).join(", "),
    // Bildene på selve siden er små, så de største variantene utelates.
    credit,
    html: Image.generateHTML(onlyUpTo(metadata, PAGE_MAX_WIDTH), { alt, sizes, loading: "lazy", decoding: "async" }),
  };
}

// Samme metadata uten varianter bredere enn maxWidth. Er alle bredere (lite trolig), beholdes den minste.
function onlyUpTo(metadata, maxWidth) {
  const result = {};
  for (const [format, entries] of Object.entries(metadata)) {
    const kept = entries.filter((e) => e.width <= maxWidth);
    result[format] = kept.length ? kept : entries.slice(0, 1);
  }
  return result;
}
