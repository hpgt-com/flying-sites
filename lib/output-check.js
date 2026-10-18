// Finds template and script slips in the built site (_site/): «[object Object]», «undefined» and «NaN» in the page text
// or attributes, and placeholders that were never filled in («{{ … }}», «{% … %}», «{name}»). The links and the HTML
// itself are checked by lib/link-check.js and html-validate. Used by scripts/check-output.mjs (npm run check:output),
// the PR check and the deploy build, so a slip like «[object Object]» as a heading never goes live.

import fs from "node:fs";
import path from "node:path";
import { htmlFiles, withoutScriptBodies } from "./link-check.js";

// Checked in the markup without <script> blocks: the dictionaries in the page (i18n-data) have «{name}» placeholders
// that the scripts fill in, and the data can hold any text.
const MARKUP = [
  { pattern: /\[object Object\]/, problem: "[object Object]" },
  { pattern: /\bundefined\b/, problem: "undefined" },
  { pattern: /\bNaN\b/, problem: "NaN" },
  { pattern: /\{\{|\}\}|\{%|%\}/, problem: "Nunjucks-kode som ikke er kjørt" },
  { pattern: /\{[a-zA-Z]+\}/, problem: "plassholder som ikke er fylt ut" },
];
// Checked everywhere, also in the JSON in the page: never a sensible value.
const ANYWHERE = [{ pattern: /\[object Object\]/, problem: "[object Object]" }];

// The slips in one page, as { problem, text } with some text around the hit.
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

// Returns a list of { page, problem, text }. Empty when no page has a slip.
export function checkOutput(siteDir) {
  return htmlFiles(siteDir).flatMap((page) =>
    findSlips(fs.readFileSync(path.join(siteDir, page), "utf8")).map((slip) => ({ page, ...slip })));
}
