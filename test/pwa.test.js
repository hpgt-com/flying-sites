// Tests for the installable app and offline use (lib/pwa.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFor, offlineUrl, manifest } from "../lib/pwa.js";

const scope = "https://flysteder.hpgt.com/";

test("pages, own files and data get their own strategy", () => {
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder/elgen/", scope, true), "page");
  assert.equal(routeFor("https://flysteder.hpgt.com/assets/css/styles.css?v=1a2b3c4d", scope, false), "static");
  assert.equal(routeFor("https://flysteder.hpgt.com/img/elgen-overview-1-800.webp", scope, false), "static");
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder/elgen/elgen-route.gpx", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder.geojson", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/assets/airspace.geojson", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/sw.js", scope, false), null);
});

test("only Kartverket's map tiles are stored, never third parties", () => {
  assert.equal(routeFor("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/10/236/551.png", scope, false), "tile");
  assert.equal(routeFor("https://a.tile.opentopomap.org/10/551/236.png", scope, false), null);
  assert.equal(routeFor("https://hpgt-flysteder.goatcounter.com/count?p=/", scope, false), null);
  assert.equal(routeFor("https://www.yr.no/nb/innhold/1-2/meteogram.svg", scope, false), null);
  assert.equal(routeFor("https://example.com/flysteder/", scope, true), null);
});

test("with a path prefix, only addresses under it are handled", () => {
  const prefixed = "https://hpgt-com.github.io/flying-sites/";
  assert.equal(routeFor("https://hpgt-com.github.io/flying-sites/assets/js/common.js", prefixed, false), "static");
  assert.equal(routeFor("https://hpgt-com.github.io/other/", prefixed, true), null);
});

test("English pages get the English offline page", () => {
  assert.equal(offlineUrl("/en/sites/elgen/", "/"), "/en/offline/");
  assert.equal(offlineUrl("/flysteder/elgen/", "/"), "/offline/");
  assert.equal(offlineUrl("/flying-sites/en/", "/flying-sites/"), "/flying-sites/en/offline/");
});

test("the manifest follows the language and the path prefix", () => {
  const nb = manifest("nb", "/", "/");
  assert.equal(nb.start_url, "/");
  assert.equal(nb.scope, "/");
  assert.equal(nb.lang, "nb");
  assert.ok(nb.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  const en = manifest("en", "/flying-sites/", "/flying-sites/en/");
  assert.equal(en.start_url, "/flying-sites/en/");
  assert.equal(en.short_name, "Flying sites");
  assert.equal(en.icons[0].src, "/flying-sites/assets/img/icon-192.png");
});
