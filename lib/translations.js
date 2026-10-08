// Oversatte stedstekster. Ved siden av src/flysteder/<id>/index.md kan det ligge index.<språk>.md (for eksempel
// index.en.md) med teksten på det språket:
//
//   ---
//   hazards:            # samme rekkefølge som i index.md, bare title og text
//     - title: Power line over the landing
//       text: …
//   launches:           # samme rekkefølge, bare text
//     - text: …
//   landings:           # samme rekkefølge, bare name
//     - name: Kvalvika beach
//   parking:            # samme rekkefølge, bare name
//     - name: Parking at the chapel
//   access:
//     parking_text: …
//     route_text: …
//   routes:             # samme rekkefølge som access.routes, bare name
//     - name: from the parking
//   links:              # samme rekkefølge, title og text
//   airspace:           # samme rekkefølge som airspace i index.md, bare note
//   season: Summer and autumn
//   ---
//
//   Ingress (før første ##).
//
//   ## Launch
//   …
//   ## Landing
//   …
//
// Alt annet (koordinater, nivå, retninger, høyder) hentes fra index.md, så språkene ikke kan komme i utakt.
// Mangler en tekst i oversettelsen, brukes den norske. Filene bygges ikke som egne sider (eleventy.config.js).

import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import markdownIt from "markdown-it";
import languages from "../src/_data/languages.js";
import { lastModified } from "./git.js";

// Samme innstilling som Eleventy bruker for index.md.
const md = markdownIt({ html: true });

// Nøklene en oversettelse kan ha, og hvilke felter som kan oversettes i hver.
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

// Ingressen som ren tekst (til kortet på forsiden og beskrivelsen ved deling).
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

// { en: { data, html, intro, lastModified, outdated } } for oversettelsene som finnes ved siden av index.md.
// outdated: index.md er endret i Git etter oversettelsen.
export function readTranslations(inputPath) {
  const dir = path.dirname(inputPath);
  const source = lastModified(inputPath);
  const result = {};
  for (const { code } of languages) {
    const file = path.join(dir, `index.${code}.md`);
    if (code === "nb" || !fs.existsSync(file)) continue;
    const { data, body } = split(fs.readFileSync(file, "utf8"));
    // Skrivefeil i nøklene stopper bygget, ellers ville teksten stille og rolig blitt stående på norsk.
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

// Legger oversatte felter over listen fra index.md, element for element. Tomme felter i oversettelsen hoppes over.
export function overlay(list, translated, keys) {
  if (!Array.isArray(list) || !translated) return list ?? [];
  return list.map((item, i) => {
    // Eleventy kjører beregnede data én gang med tomme verdier for å finne avhengigheter. Da er item tomt,
    // og det beholdes som et tomt objekt så kode som leser feltene ikke feiler.
    if (!item || typeof item !== "object") return {};
    const tr = translated?.[i] ?? {};
    const out = { ...item };
    for (const k of keys) if (tr[k]) out[k] = tr[k];
    return out;
  });
}
