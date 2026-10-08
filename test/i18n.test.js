// Tester for språkstøtten (lib/i18n.js, src/_i18n/*.json). Kjøres med `npm test`.
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

test("hvert språk har en ordbok, og ingen nøkler som ikke finnes på norsk", () => {
  const nb = new Set(keys(read("nb")));
  for (const { code } of languages) {
    const extra = keys(read(code)).filter((k) => !nb.has(k));
    assert.deepEqual(extra, [], `${code}.json har nøkler som ikke finnes i nb.json`);
  }
});

test("engelsk ordbok har alle nøklene (ingen norsk reserve på engelske sider)", () => {
  const en = new Set(keys(read("en")));
  assert.deepEqual(keys(read("nb")).filter((k) => !en.has(k)), []);
});

test("tekst som mangler i et språk hentes fra norsk", () => {
  assert.equal(DICTIONARIES.en.home.title, read("en").home.title);
  assert.equal(t("home.title", "xx"), read("nb").home.title);
});

test("alle t.-oppslag i malene og FS.t-oppslag i skriptene finnes i nb.json", () => {
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
      // «"wind.slots." + slot» er et oppslag med variabel slutt. Det sjekkes ved å se at gruppen finnes.
      const key = m[1].endsWith(".") ? m[1].slice(0, -1) : m[1];
      if (!has(nb.js, key)) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("adresser på et annet språk", () => {
  assert.equal(localeUrl("/flysteder/ryten/", "en"), "/en/flysteder/ryten/");
  assert.equal(localeUrl("/en/flysteder/ryten/", "nb"), "/flysteder/ryten/");
  assert.equal(localeUrl("/en/", "nb"), "/");
  assert.equal(localeUrl("/", "en"), "/en/");
  assert.equal(localeUrl("/en/luftrom/", "en"), "/en/luftrom/");
});

test("verdier settes inn i teksten", () => {
  assert.equal(fmt("{n} av {total}", { n: 3, total: 32 }), "3 av 32");
  assert.equal(fmt("{ukjent}", {}), "{ukjent}");
});
