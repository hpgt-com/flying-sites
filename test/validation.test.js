// Tests for per-launch positions (launches[].lat/lon) in lib/validation.js. Run with `npm test`.
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

test("a launch without its own position is valid", () => {
  assert.deepEqual(errorsFor([{ directions: ["N"], text: "Nordstarten" }]), []);
});

test("a launch with its own position near the main launch is valid", () => {
  assert.deepEqual(errorsFor([{ directions: ["E"], lat: 68.855, lon: 16.265, source: "gpx" }]), []);
});

test("only lat or only lon stops the build", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 68.855 }])[0], /både lat og lon/);
});

test("a position far from the main launch stops the build (swapped lat/lon)", () => {
  assert.match(errorsFor([{ directions: ["E"], lat: 16.25, lon: 68.85 }])[0], /km fra launch/);
});

test("no_fixed_landing together with landings stops the build", () => {
  const data = { name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25 },
    no_fixed_landing: true, landings: [{ name: "Jordet", lat: 68.84, lon: 16.25 }] };
  const errors = validateSite(data, inputPath, { name: "Teststed" });
  assert.ok(errors.some((e) => /no_fixed_landing/.test(e)));
});

test("an unknown source stops the build, so the values stay consistent", () => {
  const data = { name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25, source: "manuell" } };
  const errors = validateSite(data, inputPath, { name: "Teststed" });
  assert.ok(errors.some((e) => e.includes("ukjent source «manuell»")), errors.join("\n"));
});

test("wind to stay up (wind_limits.soar_min_wind): a number below the site's or the shared wind limit", () => {
  const errs = (wl) => validateSite({ name: "Teststed", id: "teststed", status: "draft", municipality: "Harstad", launch: { lat: 68.85, lon: 16.25 }, wind_limits: wl }, inputPath, { name: "Teststed" })
    .filter((e) => e.includes("soar_min_wind")).length;
  assert.equal(errs({ soar_min_wind: 4 }), 0);
  assert.equal(errs({ soar_min_wind: 4, max_wind: 6 }), 0);
  assert.equal(errs({ soar_min_wind: 6, max_wind: 5 }), 1, "not above the site's limit");
  assert.equal(errs({ soar_min_wind: 8 }), 1, "not above the shared limit");
  assert.equal(errs({ soar_min_wind: "4" }), 1);
});
