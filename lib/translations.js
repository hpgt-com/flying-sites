// Translated site texts. Next to src/sites/<id>/index.md there may be an index.<lang>.md (e.g. index.en.md)
// with the text in that language:
//
//   ---
//   hazards:            # same order as in index.md, only title and text
//     - title: Power line over the landing
//       text: …
//   launches:           # same order, only text
//     - text: …
//   landings:           # same order, only name
//     - name: Kvalvika beach
//   parking:            # same order, only name
//     - name: Parking at the chapel
//   access:
//     parking_text: …
//     route_text: …
//   routes:             # same order as access.routes, only name
//     - name: from the parking
//   links:              # same order, title and text
//   airspace:           # same order as airspace in index.md, only note
//   season: Summer and autumn
//   ---
//
//   Intro (before the first ##).
//
//   ## Launch
//   …
//   ## Landing
//   …
//
// Everything else (coordinates, level, directions, elevations) comes from index.md, so languages cannot drift apart.
// Any text missing from the translation falls back to Norwegian. These files are not built as pages (eleventy.config.js).

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import markdownIt from "markdown-it";
import languages from "../src/_data/languages.js";
import { lastModified } from "./git.js";

// Same settings Eleventy uses for index.md.
const md = markdownIt({ html: true });

// The keys a translation may have, and which fields can be translated in each.
export const TRANSLATABLE = {
  hazards: ["title", "text"],
  launches: ["text"],
  landings: ["name"],
  parking: ["name"],
  routes: ["name"],
  links: ["title", "text"],
  airspace: ["note"],
};

const ALLOWED = [...Object.keys(TRANSLATABLE), "access", "season"];

// The intro as plain text (for the front-page card and the share description).
export function introText(markdown) {
  return markdown
    .split(/^## /m)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function split(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*([\s\S]*)$/.exec(raw);
  return m ? { data: yaml.load(m[1]) ?? {}, body: m[2] } : { data: {}, body: raw };
}

// { en: { data, html, intro, lastModified, outdated } } for the translations found next to index.md.
// outdated: index.md has changed in Git since the translation.
export function readTranslations(inputPath) {
  const dir = path.dirname(inputPath);
  const source = lastModified(inputPath);
  const result = {};
  for (const { code } of languages) {
    const file = path.join(dir, `index.${code}.md`);
    if (code === "nb" || !fs.existsSync(file)) continue;
    const { data, body } = split(fs.readFileSync(file, "utf8"));
    // Typos in the keys fail the build; otherwise the text would silently stay in Norwegian.
    const unknown = Object.keys(data).filter((k) => !ALLOWED.includes(k));
    if (unknown.length) throw new Error(`${file}: ukjente nøkler ${unknown.join(", ")} (gyldige: ${ALLOWED.join(", ")})`);
    const changed = lastModified(file);
    result[code] = {
      data,
      html: md.render(body),
      intro: introText(body),
      lastModified: changed,
      outdated: !!(source?.date && changed?.date && source.date > changed.date),
    };
  }
  return result;
}

// Overlays translated fields on the list from index.md, item by item. Empty fields in the translation are skipped.
export function overlay(list, translated, keys) {
  if (!Array.isArray(list) || !translated) return list ?? [];
  return list.map((item, i) => {
    // Eleventy runs computed data once with empty values to find dependencies. Then item is empty,
    // and it is kept as an empty object so code reading its fields does not fail.
    if (!item || typeof item !== "object") return {};
    const tr = translated?.[i] ?? {};
    const out = { ...item };
    for (const k of keys) if (tr[k]) out[k] = tr[k];
    return out;
  });
}
