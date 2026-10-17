// Makes the PNG app icons (web app manifest, apple-touch-icon) from src/assets/img/icon.svg.
//
//   node scripts/app-icons.mjs
//
// Run it after changing icon.svg, and commit the PNG files.

import sharp from "sharp";

const DIR = "src/assets/img";
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await sharp(`${DIR}/icon.svg`, { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`${DIR}/${name}`);
  console.log(`${DIR}/${name}`);
}
