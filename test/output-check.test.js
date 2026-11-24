// Tester for sjekken av glipp fra maler og skript i den bygde siden (lib/output-check.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSlips, checkOutput } from "../lib/output-check.js";

const problems = (html) => findSlips(html).map((s) => s.problem);

test("finner [object Object], undefined og NaN i tekst og attributter", () => {
  assert.deepEqual(problems("<h3>[object Object]</h3>"), ["[object Object]"]);
  assert.deepEqual(problems('<p title="undefined">x</p>'), ["undefined"]);
  assert.deepEqual(problems("<p>Høyde NaN moh</p>"), ["NaN"]);
});

test("finner plassholdere og Nunjucks-kode som aldri ble fylt inn", () => {
  assert.deepEqual(problems("<p>{n} flysteder</p>"), ["plassholder som ikke er fylt ut"]);
  assert.deepEqual(problems("<p>{{ t.site.title }}</p>"), ["Nunjucks-kode som ikke er kjørt"]);
});

test("plassholdere og ord i script-blokker er greit, men [object Object] er det ikke", () => {
  assert.deepEqual(problems('<script type="application/json">{"sites":"{n} flysteder","x":"typeof undefined"}</script><p>OK</p>'), []);
  assert.deepEqual(problems('<script type="application/json">{"title":"[object Object]"}</script>'), ["[object Object]"]);
});

test("vanlig tekst er ikke en glipp", () => {
  assert.deepEqual(problems("<p>Undefined er ikke et ord her, men nantes og Nansen er det.</p>"), []);
});

test("checkOutput lister sidene med glipp", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-"));
  fs.mkdirSync(path.join(dir, "a"));
  fs.writeFileSync(path.join(dir, "index.html"), "<p>OK</p>");
  fs.writeFileSync(path.join(dir, "a", "index.html"), "<h3>[object Object]</h3>");
  assert.deepEqual(checkOutput(dir).map((p) => [p.page, p.problem]), [["a/index.html", "[object Object]"]]);
});
