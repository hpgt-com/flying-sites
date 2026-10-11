import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotoName, looksLikePhotoName } from "../lib/photo-name.js";

const sites = [
  { id: "storlitinden", name: "Storlitinden" },
  { id: "mela-aksla", name: "Melå aksla" },
  { id: "saetertinden", name: "Sætertinden" },
  { id: "rodmoldheia", name: "Rødmoldheia" },
];

test("launch image with direction", () => {
  assert.deepEqual(parsePhotoName("Storlitinden_Takeoff_SE_1_DSC04968.jpg", sites),
    { siteId: "storlitinden", siteName: "Storlitinden", field: "takeoff", type: "Takeoff", direction: "SE", category: null, nr: 1, original: "DSC04968" });
});

test("landing and aerial image without direction, and original name with underscore", () => {
  assert.equal(parsePhotoName("Storlitinden_Landing_1_DSC05012.jpg", sites).field, "landing");
  const air = parsePhotoName("Storlitinden_Aerial_2_DJI_0042.JPG", sites);
  assert.equal(air.field, "overview");
  assert.equal(parsePhotoName("Storlitinden_Overview_1_X.jpg", sites).field, "overview");
  assert.equal(air.nr, 2);
  assert.equal(air.original, "DJI_0042");
});

test("site name without æ/ø/å and spaces finds the right site", () => {
  assert.equal(parsePhotoName("MelaAksla_Aerial_1_X.jpg", sites).siteId, "mela-aksla");
  assert.equal(parsePhotoName("Saetertinden_Aerial_1_X.jpg", sites).siteId, "saetertinden");
  assert.equal(parsePhotoName("Setertinden_Aerial_1_X.jpg", sites).siteId, "saetertinden");
  const more = [...sites, { id: "arbostadtinden", name: "Årbostadtinden" }, { id: "rodmoldheia", name: "Rødmoldheia" }];
  assert.equal(parsePhotoName("Aarbostadtinden_Takeoff_NW_1_X.jpg", more).siteId, "arbostadtinden");
  assert.equal(parsePhotoName("Arbostadtinden_Takeoff_NW_1_X.jpg", more).siteId, "arbostadtinden");
  assert.equal(parsePhotoName("Roedmoldheia_Overview_1_X.jpg", more).siteId, "rodmoldheia");
  assert.equal(parsePhotoName("Rodmoldheia_Overview_1_X.jpg", more).siteId, "rodmoldheia");
  assert.equal(parsePhotoName("Rodmoldheia_Landing_1_X.jpg", sites).siteId, "rodmoldheia");
});

test("errors give a clear message", () => {
  assert.throws(() => parsePhotoName("Storlitinden_Takeoff_1_DSC1.jpg", sites), /Takeoff trenger én retning/);
  assert.throws(() => parsePhotoName("Storlitinden_Takeoff_SØ_1_DSC1.jpg", sites), /SE i stedet for SØ/);
  assert.throws(() => parsePhotoName("Storlitinden_Landing_SE_1_DSC1.jpg", sites), /bare på Takeoff/);
  assert.throws(() => parsePhotoName("Storlitind_Aerial_1_DSC1.jpg", sites), /fant ikke stedet.*Mente du Storlitinden/);
  assert.throws(() => parsePhotoName("Storlitinden_Aerial_DSC1.jpg", sites), /mangler nummer/);
  assert.throws(() => parsePhotoName("Storlitinden_Aerial_1.jpg", sites), /mangler kameraets filnavn/);
  assert.throws(() => parsePhotoName("Storlitinden_Launch_1_DSC1.jpg", sites), /skal hete|ukjent type/);
});

test("recognises names following the convention, but not ordinary camera files or the site's own files", () => {
  assert.equal(looksLikePhotoName("Storlitinden_Takeoff_SE_1_DSC04968.jpg"), true);
  assert.equal(looksLikePhotoName("DSC04968.jpg"), false);
  assert.equal(looksLikePhotoName("sollifjellet-takeoff.jpg"), false);
});

test("optional SPG tag on landing, not on other types, and PG is not written", () => {
  const spg = parsePhotoName("Saetertinden_Landing_SPG_1_DSC00978.jpg", sites);
  assert.equal(spg.category, "SPG");
  assert.equal(spg.nr, 1);
  assert.equal(spg.original, "DSC00978");
  assert.equal(parsePhotoName("Saetertinden_Landing_1_DSC00978.jpg", sites).category, null);
  assert.throws(() => parsePhotoName("Saetertinden_Aerial_SPG_1_X.jpg", sites), /bare på Landing/);
  assert.throws(() => parsePhotoName("Saetertinden_Landing_PG_1_X.jpg", sites), /PG er standard/);
  assert.throws(() => parsePhotoName("Saetertinden_Takeoff_SE_SPG_1_X.jpg", sites), /bare på Landing/);
});
