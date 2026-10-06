import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotoName, looksLikePhotoName } from "../lib/photo-name.js";

const sites = [
  { id: "storlitinden", name: "Storlitinden" },
  { id: "mela-aksla", name: "Melå aksla" },
  { id: "saetertinden", name: "Sætertinden" },
  { id: "rodmoldheia", name: "Rødmoldheia" },
];

test("startbilde med retning", () => {
  assert.deepEqual(parsePhotoName("Storlitinden_Takeoff_SE_1_DSC04968.jpg", sites),
    { siteId: "storlitinden", siteName: "Storlitinden", field: "launch", type: "Takeoff", direction: "SE", nr: 1, original: "DSC04968" });
});

test("landing og luftbilde uten retning, og originalnavn med understrek", () => {
  assert.equal(parsePhotoName("Storlitinden_Landing_1_DSC05012.jpg", sites).field, "landing");
  const air = parsePhotoName("Storlitinden_Aerial_2_DJI_0042.JPG", sites);
  assert.equal(air.field, "air");
  assert.equal(air.nr, 2);
  assert.equal(air.original, "DJI_0042");
});

test("stedsnavn uten æ/ø/å og mellomrom finner riktig sted", () => {
  assert.equal(parsePhotoName("MelaAksla_Aerial_1_X.jpg", sites).siteId, "mela-aksla");
  assert.equal(parsePhotoName("Saetertinden_Aerial_1_X.jpg", sites).siteId, "saetertinden");
  assert.equal(parsePhotoName("Setertinden_Aerial_1_X.jpg", sites).siteId, "saetertinden");
  assert.equal(parsePhotoName("Rodmoldheia_Landing_1_X.jpg", sites).siteId, "rodmoldheia");
});

test("feil gir en tydelig melding", () => {
  assert.throws(() => parsePhotoName("Storlitinden_Takeoff_1_DSC1.jpg", sites), /Takeoff trenger én retning/);
  assert.throws(() => parsePhotoName("Storlitinden_Takeoff_SØ_1_DSC1.jpg", sites), /SE i stedet for SØ/);
  assert.throws(() => parsePhotoName("Storlitinden_Landing_SE_1_DSC1.jpg", sites), /bare på Takeoff/);
  assert.throws(() => parsePhotoName("Storlitind_Aerial_1_DSC1.jpg", sites), /fant ikke stedet.*Mente du Storlitinden/);
  assert.throws(() => parsePhotoName("Storlitinden_Aerial_DSC1.jpg", sites), /mangler nummer/);
  assert.throws(() => parsePhotoName("Storlitinden_Aerial_1.jpg", sites), /mangler kameraets filnavn/);
  assert.throws(() => parsePhotoName("Storlitinden_Launch_1_DSC1.jpg", sites), /skal hete|ukjent type/);
});

test("kjenner igjen navn etter konvensjonen, men ikke vanlige kamerafiler eller sidens egne filer", () => {
  assert.equal(looksLikePhotoName("Storlitinden_Takeoff_SE_1_DSC04968.jpg"), true);
  assert.equal(looksLikePhotoName("DSC04968.jpg"), false);
  assert.equal(looksLikePhotoName("sollifjellet-launch.jpg"), false);
});
