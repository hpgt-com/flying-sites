import { test } from "node:test";
import assert from "node:assert/strict";
import { siteStatus } from "../lib/status.js";

const site = (rawInput) => ({ url: "/flysteder/test/", rawInput, data: { id: "test", name: "Test" } });

test("start- og landingstekst mangler når avsnittet er tomt eller en plassholder", () => {
  const missing = siteStatus(site("Intro.\n\n## Start\n\nBratt start.\n\n## Landing\n\nLandingsbeskrivelse mangler.\n")).missing;
  assert.ok(!missing.includes("starttekst"));
  assert.ok(missing.includes("landingstekst"));
  assert.ok(siteStatus(site("Intro.\n")).missing.includes("starttekst"));
});

test("landingstekst som siste avsnitt regnes med", () => {
  const missing = siteStatus(site("## Start\n\nFin start.\n\n## Landing\n\nPå jordet.")).missing;
  assert.ok(!missing.includes("starttekst"));
  assert.ok(!missing.includes("landingstekst"));
});

test("sted uten fast landing mangler verken landing eller landingsbilde", () => {
  const s = { url: "/flysteder/test/", rawInput: "", data: { id: "test", name: "Test", landings: [], no_fixed_landing: true } };
  const missing = siteStatus(s).missing;
  assert.ok(!missing.includes("landing"));
  assert.ok(!missing.includes("landingsbilde"));
  assert.ok(siteStatus({ ...s, data: { ...s.data, no_fixed_landing: undefined } }).missing.includes("landing"));
});

test("parkering i kartet uten beskrivelse mangler parkeringstekst, ikke parkering", () => {
  const s = (data) => siteStatus({ url: "/x/", rawInput: "", data: { id: "x", name: "X", ...data } }).missing;
  const withPoint = s({ parking: [{ lat: 68.8, lon: 16.4 }] });
  assert.ok(!withPoint.includes("parkering"));
  assert.ok(withPoint.includes("parkeringstekst"));
  const none = s({});
  assert.ok(none.includes("parkering"));
  assert.ok(!none.includes("parkeringstekst"));
  assert.ok(!s({ parking: [{ lat: 68.8, lon: 16.4 }], access: { parking_text: "Ved kirka." } }).includes("parkeringstekst"));
});
