import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRepoImageName, repoImageName, listSiteImages, featuredImages, imageCaption } from "../lib/site-images.js";

test("filnavn i repoet tolkes", () => {
  assert.deepEqual(parseRepoImageName("elgen-takeoff-se-2.jpg", "elgen"),
    { file: "elgen-takeoff-se-2.jpg", field: "takeoff", direction: "SE", category: null, nr: 2 });
  assert.equal(parseRepoImageName("elgen-landing-spg-1.jpg", "elgen").category, "SPG");
  assert.equal(parseRepoImageName("elgen-overview-1.webp", "elgen").field, "overview");
  assert.equal(parseRepoImageName("elgen-takeoff-1.jpg", "elgen").direction, null);
});

test("feil filnavn gir null", () => {
  for (const file of ["elgen-takeoff.jpg", "elgen-air-1.jpg", "elgen-landing-se-1.jpg", "elgen-overview-spg-1.jpg",
    "elgen-takeoff-sø-1.jpg", "elgen-takeoff-xx-1.jpg", "elgen-takeoff-se-0.jpg", "keipen-overview-1.jpg", "DSC0001.jpg"]) {
    assert.equal(parseRepoImageName(file, "elgen"), null, file);
  }
  assert.equal(parseRepoImageName("elgen-route.gpx", "elgen"), null);
});

test("navnet bygges fra bildenavnet", () => {
  assert.equal(repoImageName({ siteId: "elgen", field: "takeoff", direction: "SE", nr: 2 }), "elgen-takeoff-se-2");
  assert.equal(repoImageName({ siteId: "elgen", field: "landing", category: "SPG", nr: 1 }), "elgen-landing-spg-1");
  assert.equal(repoImageName({ siteId: "elgen", field: "overview", direction: null, category: null, nr: 3 }), "elgen-overview-3");
});

test("bildene sorteres og de tre første velges", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-images-"));
  for (const f of ["elgen-landing-spg-1.jpg", "elgen-takeoff-nw-1.jpg", "elgen-overview-2.jpg", "elgen-landing-2.jpg",
    "elgen-takeoff-se-1.jpg", "elgen-overview-1.jpg", "elgen-route.gpx", "IMG_1234.jpg"]) fs.writeFileSync(path.join(dir, f), "");
  const { images, invalid } = listSiteImages(dir, "elgen");
  assert.deepEqual(images.map((i) => i.file), ["elgen-overview-1.jpg", "elgen-overview-2.jpg", "elgen-takeoff-se-1.jpg",
    "elgen-takeoff-nw-1.jpg", "elgen-landing-2.jpg", "elgen-landing-spg-1.jpg"]);
  assert.deepEqual(invalid, ["IMG_1234.jpg"]);
  assert.deepEqual(featuredImages(images).map((i) => i.file), ["elgen-overview-1.jpg", "elgen-takeoff-se-1.jpg", "elgen-landing-2.jpg"]);
  fs.rmSync(dir, { recursive: true });
});

test("bildetekst", () => {
  assert.equal(imageCaption({ field: "takeoff", direction: "SE" }), "Start mot SØ");
  assert.equal(imageCaption({ field: "takeoff", direction: null }), "Start");
  assert.equal(imageCaption({ field: "landing", category: "SPG" }), "SPG-landing");
  assert.equal(imageCaption({ field: "overview" }), "Oversikt");
});
