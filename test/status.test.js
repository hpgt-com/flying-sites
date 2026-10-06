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
