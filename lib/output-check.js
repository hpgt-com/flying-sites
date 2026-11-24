// Finner feil fra maler og skript i det bygde nettstedet (_site/): «[object Object]», «undefined» og «NaN» i teksten
// eller attributtene, og plassholdere som aldri ble fylt inn («{{ … }}», «{% … %}», «{name}»). Lenkene og selve
// HTML-en sjekkes av lib/link-check.js og html-validate. Brukes av scripts/check-output.mjs (npm run check:output),
// sjekken av PR-er og byggingen før publisering, så en feil som «[object Object]» i en overskrift aldri går ut.

import fs from "node:fs";
import path from "node:path";
import { htmlFiles, withoutScriptBodies } from "./link-check.js";

// Sjekkes i markeringen uten <script>-blokker: ordbøkene på siden (i18n-data) har «{name}»-plassholdere som
// skriptene fyller inn, og dataene kan inneholde hvilken som helst tekst.
const MARKUP = [
  { pattern: /\[object Object\]/, problem: "[object Object]" },
  { pattern: /\bundefined\b/, problem: "undefined" },
  { pattern: /\bNaN\b/, problem: "NaN" },
  { pattern: /\{\{|\}\}|\{%|%\}/, problem: "Nunjucks-kode som ikke er kjørt" },
  { pattern: /\{[a-zA-Z]+\}/, problem: "plassholder som ikke er fylt ut" },
];
// Sjekkes overalt, også i JSON-en på siden: aldri en fornuftig verdi.
const ANYWHERE = [{ pattern: /\[object Object\]/, problem: "[object Object]" }];

// Feilene på én side, som { problem, text } med litt tekst rundt treffet.
export function findSlips(html) {
  const found = [];
  const look = (text, rules) => {
    for (const { pattern, problem } of rules) {
      const m = text.match(pattern);
      if (m && !found.some((f) => f.problem === problem)) {
        found.push({ problem, text: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, " ").trim() });
      }
    }
  };
  look(withoutScriptBodies(html), MARKUP);
  look(html, ANYWHERE);
  return found;
}

// Gir en liste med { page, problem, text }. Tom når ingen side har feil.
export function checkOutput(siteDir) {
  return htmlFiles(siteDir).flatMap((page) =>
    findSlips(fs.readFileSync(path.join(siteDir, page), "utf8")).map((slip) => ({ page, ...slip })));
}
