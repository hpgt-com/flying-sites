// Tests for the check of template and script slips in the built site (lib/output-check.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSlips, checkOutput } from "../lib/output-check.js";

const problems = (html) => findSlips(html).map((s) => s.problem);

test("finds [object Object], undefined and NaN in text and attributes", () => {
  assert.deepEqual(problems("<h3>[object Object]</h3>"), ["[object Object]"]);
  assert.deepEqual(problems('<p title="undefined">x</p>'), ["undefined"]);
  assert.deepEqual(problems("<p>Høyde NaN moh</p>"), ["NaN"]);
});

test("finds placeholders and Nunjucks code that were never filled in", () => {
  assert.deepEqual(problems("<p>{n} flysteder</p>"), ["plassholder som ikke er fylt ut"]);
  assert.deepEqual(problems("<p>{{ t.site.title }}</p>"), ["Nunjucks-kode som ikke er kjørt"]);
});

test("placeholders and words in script blocks are fine, but [object Object] is not", () => {
  assert.deepEqual(problems('<script type="application/json">{"sites":"{n} flysteder","x":"typeof undefined"}</script><p>OK</p>'), []);
  assert.deepEqual(problems('<script type="application/json">{"title":"[object Object]"}</script>'), ["[object Object]"]);
});

test("ordinary text is not a slip", () => {
  assert.deepEqual(problems("<p>Undefined er ikke et ord her, men nantes og Nansen er det.</p>"), []);
});

test("checkOutput lists the pages with slips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-"));
  fs.mkdirSync(path.join(dir, "a"));
  fs.writeFileSync(path.join(dir, "index.html"), "<p>OK</p>");
  fs.writeFileSync(path.join(dir, "a", "index.html"), "<h3>[object Object]</h3>");
  assert.deepEqual(checkOutput(dir).map((p) => [p.page, p.problem]), [["a/index.html", "[object Object]"]]);
});
