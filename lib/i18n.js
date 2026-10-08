// Ordbøkene i src/_i18n/<språk>.json, med norsk som reserve: mangler en tekst i et annet språk, brukes den
// norske. Språkene står i src/_data/languages.js.

import fs from "node:fs";
import languages from "../src/_data/languages.js";

export const DEFAULT_LANG = "nb";

const read = (code) => JSON.parse(fs.readFileSync(new URL(`../src/_i18n/${code}.json`, import.meta.url), "utf8"));

// Legger b over a. Lister og tekster byttes ut i sin helhet, objekter flettes.
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

// Setter inn {navn} i en tekst: fmt("{n} steder", { n: 3 }).
export function fmt(text, vars = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

// Oppslag med punktum: t("site.map", "en").
export function t(path, lang = DEFAULT_LANG, vars) {
  const value = path.split(".").reduce((o, k) => o?.[k], dict(lang));
  return vars ? fmt(value, vars) : value;
}

// Adressen til en side på et annet språk: «/flysteder/ryten/» blir «/en/sites/ryten/», og tilbake. Fjerner
// prefikset til språket adressen har nå, gjør første del norsk igjen (slugs), og legger på målspråkets navn og prefiks.
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
