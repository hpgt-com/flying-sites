// Bilder på stedssidene: lager visningsstørrelser (WebP + JPEG) med srcset ved bygging.
// Originalene publiseres ikke, så EXIF og store filer aldri havner på siden.

import path from "node:path";
import Image from "@11ty/eleventy-img";
import sharp from "sharp";

// Grenser for originaler i repoet. `npm run images` skalerer ned og vasker metadata.
export const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
export const MAX_ORIGINAL_SIDE = 2560;

const WIDTHS = [400, 800, 1200, 1600];
const URL_PATH = "/img/";

// Uten cache holder ikke sharp filene åpne, så `npm run images` kan skrive mens forhåndsvisningen kjører.
sharp.cache(false);

// Genererer bildet i <outputDir>/img/ og returnerer det malen trenger. `field` er overview, launch, landing eller air.
// Bredder større enn originalen hoppes over, så små bilder strekkes ikke.
export async function processImage(dir, siteId, field, file, { alt, sizes, outputDir }) {
  const metadata = await Image(path.join(dir, file), {
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
    html: Image.generateHTML(metadata, { alt, sizes, loading: field === "overview" ? "eager" : "lazy", decoding: "async" }),
  };
}
