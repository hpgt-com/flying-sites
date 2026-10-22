// Tests for the installable app and offline use (lib/pwa.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { routeFor, offlineUrl, manifest, referencedAssets, staticToKeep, CACHE_SCHEMA } from "../lib/pwa.js";

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

test("the files a stored page uses: own assets and images, with srcset, not other sites", () => {
  const html = `<link rel="stylesheet" href="/assets/css/styles.css?v=old1"><script src="/assets/js/site.js?v=old2"></script>
    <img src="/img/a-400.webp" srcset="/img/a-400.webp 400w, /img/a-800.webp 800w"><img src="https://www.yr.no/x.svg">
    <a href="/flysteder/elgen/">x</a><script src="../../assets/js/wind.js?v=old3&amp;x=1"></script>
    <div id="site-map" data-live-url="https://data.hpgt.workers.dev/v1/live.json" data-live-script="/assets/js/live.js?v=old4"></div>`;
  assert.deepEqual(referencedAssets(html, "https://flysteder.hpgt.com/flysteder/elgen/", scope), [
    "https://flysteder.hpgt.com/assets/css/styles.css?v=old1", "https://flysteder.hpgt.com/assets/js/site.js?v=old2",
    "https://flysteder.hpgt.com/img/a-400.webp", "https://flysteder.hpgt.com/img/a-400.webp", "https://flysteder.hpgt.com/img/a-800.webp",
    "https://flysteder.hpgt.com/assets/js/wind.js?v=old3&x=1", "https://flysteder.hpgt.com/assets/js/live.js?v=old4",
  ]);
  const keep = ["https://flysteder.hpgt.com/assets/css/styles.css?v=old1"];
  assert.equal(staticToKeep("https://flysteder.hpgt.com/assets/css/styles.css?v=old1", keep, scope), true);
  assert.equal(staticToKeep("https://flysteder.hpgt.com/assets/css/styles.css?v=gone", keep, scope), false);
  assert.equal(staticToKeep("https://flysteder.hpgt.com/img/b-400.webp", keep, scope), false);
  assert.equal(staticToKeep("https://flysteder.hpgt.com/assets/fonts/barlow.woff2", keep, scope), true, "fonts and Leaflet's images stay");
});

// A small Cache API in memory, enough for the service worker's install and activate.
function cacheStorage() {
  const all = new Map();
  const open = async (name) => {
    if (!all.has(name)) all.set(name, new Map());
    const m = all.get(name), key = (r) => (typeof r === "string" ? r : r.url);
    return {
      keys: async () => [...m.keys()].map((url) => ({ url })),
      match: async (r) => m.get(key(r))?.clone(),
      put: async (r, res) => { m.set(key(r), res); },
      add: async (url) => { m.set(new URL(url, scope).href, new Response("file " + url)); },
      addAll: async (urls) => { for (const u of urls) m.set(new URL(u, scope).href, new Response("file " + u)); },
      delete: async (r) => m.delete(key(r)),
    };
  };
  return { all, api: { open, keys: async () => [...all.keys()], delete: async (n) => all.delete(n), match: async () => undefined } };
}

test("after a deploy, a page stored before it still has its CSS and JS offline; files nobody uses go", async () => {
  const { all, api } = cacheStorage();
  // Before the deploy: the page and the old files it uses, in the static cache of the old service worker.
  const page = `<link href="/assets/css/styles.css?v=old"><script src="/assets/js/site.js?v=old"></script>`;
  (await api.open("fs-pages-" + CACHE_SCHEMA)).put("https://flysteder.hpgt.com/flysteder/elgen/", new Response(page));
  const oldStatic = await api.open("fs-static-1a2b3c4d5e6f");
  for (const u of ["assets/css/styles.css?v=old", "assets/js/site.js?v=old", "assets/js/home.js?v=unused", "img/x-400.webp"]) {
    await oldStatic.put(scope + u, new Response(u));
  }
  // The new service worker, as src/sw.11ty.js builds it.
  const precache = ["/assets/css/styles.css?v=new", "/assets/js/site.js?v=new"];
  const src = [`var VERSION = "new"; var SCHEMA = ${JSON.stringify(CACHE_SCHEMA)}; var BASE = "/"; var PRECACHE = ${JSON.stringify(precache)};`,
    "var MAX_TILES = 300; var MAX_PAGES = 120;", String(routeFor), String(offlineUrl), String(referencedAssets), String(staticToKeep),
    fs.readFileSync(new URL("../lib/service-worker.js", import.meta.url), "utf8")].join("\n");
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, registration: { scope }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, caches: api, URL, Response, Promise, setTimeout, fetch: async () => { throw new Error("offline"); } });
  const run = async (type) => { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); await p; };
  await run("install");
  await run("activate");
  const kept = [...all.get("fs-static-" + CACHE_SCHEMA).keys()].map((u) => u.slice(scope.length)).sort();
  assert.deepEqual(kept, ["assets/css/styles.css?v=new", "assets/css/styles.css?v=old", "assets/js/site.js?v=new", "assets/js/site.js?v=old",
    "en/offline/", "offline/"], "the old page's files, the new ones and the offline pages; not the unused file or the image");
  assert.ok(!all.has("fs-static-1a2b3c4d5e6f"), "the old per-version cache is gone");
  assert.ok(all.has("fs-pages-" + CACHE_SCHEMA), "the stored pages stay");
});
