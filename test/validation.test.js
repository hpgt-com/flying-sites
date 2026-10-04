// Tester for egne posisjoner per start (launches[].lat/lon) i lib/validation.js. Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSite } from "../lib/validation.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flysteder-"));
const inputPath = path.join(dir, "teststed", "index.md");
fs.mkdirSync(path.dirname(inputPath));

function errorsFor(launches) {
  const data = { name: "Teststed", id: "teststed", status: "utkast", launch: { lat: 68.85, lon: 16.25 }, launches };
  return validateSite(data, inputPath, { name: "Teststed", launches }).map((e) => e.slice(inputPath.length + 2));
}

test("start uten egen posisjon er gyldig", () => {
  assert.deepEqual(errorsFor([{ directions: ["N"], text: "Nordstarten" }]), []);
});

test("start med egen posisjon nær hovedstarten er gyldig", () => {
  assert.deepEqual(errorsFor([{ directions: ["E"], lat: 68.855, lon: 16.265, source: "gps" }]), []);
});

test("bare lat eller bare lon stopper bygget", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 68.855 }])[0], /både lat og lon/);
});

test("posisjon langt fra hovedstarten stopper bygget (byttet lat/lon)", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 16.25, lon: 68.85 }])[0], /km fra launch/);
});
