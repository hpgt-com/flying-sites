import { test } from "node:test";
import assert from "node:assert/strict";
import { siteStatus } from "../lib/status.js";

const site = (rawInput) => ({ url: "/flysteder/test/", rawInput, data: { id: "test", name: "Test" } });

test("launch and landing text are missing when the section is empty or a placeholder", () => {
  const missing = siteStatus(site("Intro.\n\n## Start\n\nBratt start.\n\n## Landing\n\nLandingsbeskrivelse mangler.\n")).missing.map((m) => m.key);
  assert.ok(!missing.includes("launch_text"));
  assert.ok(missing.includes("landing_text"));
  assert.ok(siteStatus(site("Intro.\n")).missing.map((m) => m.key).includes("launch_text"));
});

test("landing text as the last section counts", () => {
  const missing = siteStatus(site("## Start\n\nFin start.\n\n## Landing\n\nPå jordet.")).missing.map((m) => m.key);
  assert.ok(!missing.includes("launch_text"));
  assert.ok(!missing.includes("landing_text"));
});

test("a site without a fixed landing is missing neither landing nor landing image", () => {
  const s = { url: "/flysteder/test/", rawInput: "", data: { id: "test", name: "Test", landings: [], no_fixed_landing: true } };
  const missing = siteStatus(s).missing.map((m) => m.key);
  assert.ok(!missing.includes("landing"));
  assert.ok(!missing.includes("landing_photo"));
  assert.ok(siteStatus({ ...s, data: { ...s.data, no_fixed_landing: undefined } }).missing.map((m) => m.key).includes("landing"));
});

test("parking in the map without a description is missing parking text, not parking", () => {
  const s = (data) => siteStatus({ url: "/x/", rawInput: "", data: { id: "x", name: "X", ...data } }).missing.map((m) => m.key);
  const withPoint = s({ parking: [{ lat: 68.8, lon: 16.4 }] });
  assert.ok(!withPoint.includes("parking"));
  assert.ok(withPoint.includes("parking_text"));
  const none = s({});
  assert.ok(none.includes("parking"));
  assert.ok(!none.includes("parking_text"));
  assert.ok(!s({ parking: [{ lat: 68.8, lon: 16.4 }], access: { parking_text: "Ved kirka." } }).includes("parking_text"));
});
