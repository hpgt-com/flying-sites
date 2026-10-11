import { test } from "node:test";
import assert from "node:assert/strict";
import { assetUrl } from "../lib/assets.js";

test("CSS and JS get a version number from their content", () => {
  assert.match(assetUrl("/assets/css/styles.css"), /^\/assets\/css\/styles\.css\?v=[0-9a-f]{8}$/);
  assert.match(assetUrl("/assets/js/site.js"), /^\/assets\/js\/site\.js\?v=[0-9a-f]{8}$/);
  assert.match(assetUrl("/assets/leaflet/leaflet.js"), /\?v=[0-9a-f]{8}$/);
  assert.equal(assetUrl("/assets/js/site.js"), assetUrl("/assets/js/site.js"));
  assert.notEqual(assetUrl("/assets/js/site.js"), assetUrl("/assets/js/home.js"));
});

test("unknown files and other URLs are left unchanged", () => {
  assert.equal(assetUrl("/assets/js/finnes-ikke.js"), "/assets/js/finnes-ikke.js");
  assert.equal(assetUrl("https://example.com/a.js"), "https://example.com/a.js");
});
