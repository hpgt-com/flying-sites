// The dictionaries in src/_i18n/<lang>.json, with Norwegian as fallback: if a text is missing in another
// language, the Norwegian one is used. The languages are listed in src/_data/languages.js.

import fs from "node:fs";
import languages from "../src/_data/languages.js";

export const DEFAULT_LANG = "nb";

const read = (code) => JSON.parse(fs.readFileSync(new URL(`../src/_i18n/${code}.json`, import.meta.url), "utf8"));

// Overlays b on a. Arrays and strings are replaced whole; objects are merged.
function merge(a, b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a?.[k] && typeof a[k] === "object" ? merge(a[k], v) : v;
  }
  return out;
}

const base = read(DEFAULT_LANG);
export const DICTIONARIES = Object.fromEntries(
  languages.map((l) => [l.code, l.code === DEFAULT_LANG ? base : merge(base, read(l.code))]),
);

export function dict(lang) {
  return DICTIONARIES[lang] ?? base;
}

// Fills {name} placeholders in a text: fmt("{n} steder", { n: 3 }).
export function fmt(text, vars = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

// Dotted-path lookup: t("site.map", "en").
export function t(path, lang = DEFAULT_LANG, vars) {
  const value = path.split(".").reduce((o, k) => o?.[k], dict(lang));
  return vars ? fmt(value, vars) : value;
}

// The URL of a page in another language: "/flysteder/ryten/" becomes "/en/sites/ryten/", and back. Strips the
// current language prefix, maps the first segment back to Norwegian (slugs), then applies the target language's slug and prefix.
export function localeUrl(url, code) {
  const current = languages.find((l) => l.prefix && (url === l.prefix || url.startsWith(`${l.prefix}/`)))
    ?? languages.find((l) => l.code === DEFAULT_LANG);
  const path = (current.prefix ? url.slice(current.prefix.length) : url) || "/";
  const [, first = "", ...rest] = path.split("/");
  const norwegian = Object.entries(current.slugs ?? {}).find(([, slug]) => slug === first)?.[0] ?? first;
  const target = languages.find((l) => l.code === code) ?? current;
  const slug = target.slugs?.[norwegian] ?? norwegian;
  return (target.prefix ?? "") + ["", slug, ...rest].join("/");
}
