// Leser front matter i hver flystedsfil (src/sites/<id>/index.md), for skript og datamoduler som trenger
// koordinatene eller høydene uten å gå via Eleventy.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml");
export const SITES_DIR = "src/sites";

export function readSites(dir = SITES_DIR) {
  return fs.readdirSync(dir)
    .filter((id) => fs.existsSync(path.join(dir, id, "index.md")))
    .map((id) => {
      const text = fs.readFileSync(path.join(dir, id, "index.md"), "utf8");
      return { id, data: yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1]) };
    });
}
