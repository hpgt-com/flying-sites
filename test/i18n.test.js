// Tests for language support (lib/i18n.js, src/_i18n/*.json). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DICTIONARIES, localeUrl, fmt, t } from "../lib/i18n.js";
import languages from "../src/_data/languages.js";

const read = (code) => JSON.parse(fs.readFileSync(new URL(`../src/_i18n/${code}.json`, import.meta.url), "utf8"));
function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
const has = (dict, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict) !== undefined;

test("each language has a dictionary, with no keys missing from Norwegian", () => {
  const nb = new Set(keys(read("nb")));
  for (const { code } of languages) {
    const extra = keys(read(code)).filter((k) => !nb.has(k));
    assert.deepEqual(extra, [], `${code}.json har nøkler som ikke finnes i nb.json`);
  }
});

test("the English dictionary has all keys (no Norwegian fallback on English pages)", () => {
  const en = new Set(keys(read("en")));
  assert.deepEqual(keys(read("nb")).filter((k) => !en.has(k)), []);
});

test("text missing in a language falls back to Norwegian", () => {
  assert.equal(DICTIONARIES.en.home.title, read("en").home.title);
  assert.equal(t("home.title", "xx"), read("nb").home.title);
});

test("all t. lookups in the templates and FS.t lookups in the scripts exist in nb.json", () => {
  const nb = read("nb");
  const missing = [];
  const dir = (d) => fs.readdirSync(d).map((f) => path.join(d, f));
  const templates = [...dir("src"), ...dir("src/_includes")].filter((f) => f.endsWith(".njk"));
  for (const f of templates) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\.((?:[a-z]\w*\.)+[a-z]\w*)/gi)) {
      if (!has(nb, m[1])) missing.push(`${f}: t.${m[1]}`);
    }
  }
  for (const f of dir("src/assets/js").filter((f) => f.endsWith(".js"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/FS\.tn?\("([\w.]+)"/g)) {
      // «"wind.slots." + slot» is a lookup with a variable ending. It is checked by verifying that the group exists.
      const key = m[1].endsWith(".") ? m[1].slice(0, -1) : m[1];
      if (!has(nb.js, key)) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("text printed in the templates is text, not a group of keys", () => {
  // «{{ t.site.profile }}» printed «[object Object]» when a group got the same name as a heading.
  const nb = read("nb");
  const groups = [];
  const dir = (d) => fs.readdirSync(d).map((f) => path.join(d, f));
  for (const f of [...dir("src"), ...dir("src/_includes")].filter((f) => f.endsWith(".njk"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\{\{-?\s*t\.((?:[a-z]\w*\.)*[a-z]\w*)\s*(?:-?\}\}|\|)/gi)) {
      const value = m[1].split(".").reduce((o, k) => o?.[k], nb);
      if (typeof value === "object" && value !== null) groups.push(`${f}: t.${m[1]}`);
    }
  }
  assert.deepEqual(groups, []);
});

test("URLs in another language", () => {
  assert.equal(localeUrl("/flysteder/ryten/", "en"), "/en/sites/ryten/");
  assert.equal(localeUrl("/en/sites/ryten/", "nb"), "/flysteder/ryten/");
  assert.equal(localeUrl("/en/", "nb"), "/");
  assert.equal(localeUrl("/", "en"), "/en/");
  assert.equal(localeUrl("/tarn/", "en"), "/en/towers/");
  assert.equal(localeUrl("/en/towers/", "en"), "/en/towers/");
  assert.equal(localeUrl("/en/towers/", "nb"), "/tarn/");
  assert.equal(localeUrl("/status/", "nb"), "/status/");
});

test("values are inserted into the text", () => {
  assert.equal(fmt("{n} av {total}", { n: 3, total: 32 }), "3 av 32");
  assert.equal(fmt("{ukjent}", {}), "{ukjent}");
});
