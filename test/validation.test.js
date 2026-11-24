// Tester for posisjoner per start (launches[].lat/lon) i lib/validation.js. Kjør med `npm test`.
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
  const data = { name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25 }, launches };
  return validateSite(data, inputPath, { name: "Teststed", launches }).map((e) => e.slice(inputPath.length + 2));
}

test("en start uten egen posisjon er gyldig", () => {
  assert.deepEqual(errorsFor([{ directions: ["N"], text: "Nordstarten" }]), []);
});

test("en start med egen posisjon nær hovedstarten er gyldig", () => {
  assert.deepEqual(errorsFor([{ directions: ["E"], lat: 68.855, lon: 16.265, source: "gpx" }]), []);
});

test("bare lat eller bare lon stopper bygget", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 68.855 }])[0], /både lat og lon/);
});

test("en posisjon langt fra hovedstarten stopper bygget (byttet om lat/lon)", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 16.25, lon: 68.85 }])[0], /km fra launch/);
});

test("no_fixed_landing sammen med landinger stopper bygget", () => {
  const data = { name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25 },
    no_fixed_landing: true, landings: [{ name: "Jordet", lat: 68.84, lon: 16.25 }] };
  const errors = validateSite(data, inputPath, { name: "Teststed" });
  assert.ok(errors.some((e) => /no_fixed_landing/.test(e)));
});

test("en ukjent kilde stopper bygget, så verdiene holder seg konsistente", () => {
  const data = { name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25, source: "manuell" } };
  const errors = validateSite(data, inputPath, { name: "Teststed" });
  assert.ok(errors.some((e) => e.includes("ukjent source «manuell»")), errors.join("\n"));
});

test("vind for å holde seg oppe (wind_limits.soar_min_wind): et tall under stedets eller felles vindgrense", () => {
  const errs = (wl) => validateSite({ name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25 }, wind_limits: wl }, inputPath, { name: "Teststed" })
    .filter((e) => e.includes("soar_min_wind")).length;
  assert.equal(errs({ soar_min_wind: 4 }), 0);
  assert.equal(errs({ soar_min_wind: 4, max_wind: 6 }), 0);
  assert.equal(errs({ soar_min_wind: 6, max_wind: 5 }), 1, "ikke over stedets grense");
  assert.equal(errs({ soar_min_wind: 8 }), 1, "ikke over den felles grensen");
  assert.equal(errs({ soar_min_wind: "4" }), 1);
});
