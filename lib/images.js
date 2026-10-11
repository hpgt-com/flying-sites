// Images on the site pages: generates display sizes (WebP + JPEG) with srcset at build time.
// The originals are not published, so EXIF data and large files never reach the site.

import path from "node:path";
import Image from "@11ty/eleventy-img";
import sharp from "sharp";
import { creditFor, exifFor, xmpFor } from "./photo-credit.js";

// Limits for originals in the repo. `npm run images` downscales them and strips metadata.
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
export const MAX_ORIGINAL_SIDE = 2560;

// 2400 is only used in the image viewer on large and retina screens (lightbox.js), not on the page itself.
const WIDTHS = [400, 800, 1200, 1600, 2400];
const PAGE_MAX_WIDTH = 1600;
const URL_PATH = "/img/";

// Without its cache sharp does not hold files open, so `npm run images` can write while the preview server runs.
sharp.cache(false);

// Generates the image in <outputDir>/img/ and returns what the template needs. Files are prefixed with the
// image name (sollifjellet-takeoff-se-1-800-<hash>.webp). Widths larger than the original are skipped, so small
// images are not upscaled.
export async function processImage(dir, file, { alt, sizes, outputDir }) {
  const source = path.join(dir, file);
  // Photographer and license from the image (set on import), written into every generated size.
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
    // For share previews (og:image). Facebook recommends at least 1200 px width.
    shareUrl: (metadata.jpeg.find((e) => e.width >= 1200) ?? largest).url,
    // For the image viewer (lightbox.js), which picks a size to fit the screen.
    srcsetWebp: metadata.webp.map((e) => e.srcset).join(", "),
    srcsetJpeg: metadata.jpeg.map((e) => e.srcset).join(", "),
    // Images on the page itself are small, so the largest variants are left out.
    credit,
    html: Image.generateHTML(onlyUpTo(metadata, PAGE_MAX_WIDTH), { alt, sizes, loading: "lazy", decoding: "async" }),
  };
}

// The same metadata without variants wider than maxWidth. If all are wider (unlikely), the smallest is kept.
function onlyUpTo(metadata, maxWidth) {
  const result = {};
  for (const [format, entries] of Object.entries(metadata)) {
    const kept = entries.filter((e) => e.width <= maxWidth);
    result[format] = kept.length ? kept : entries.slice(0, 1);
  }
  return result;
}
