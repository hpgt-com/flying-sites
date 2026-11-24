// Tester for appen som kan installeres, og bruk uten nett (lib/pwa.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { routeFor, offlineUrl, manifest, referencedAssets, staticToKeep, CACHE_SCHEMA } from "../lib/pwa.js";

const scope = "https://flysteder.hpgt.com/";

test("sider, egne filer og data får hver sin strategi", () => {
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder/elgen/", scope, true), "page");
  assert.equal(routeFor("https://flysteder.hpgt.com/assets/css/styles.css?v=1a2b3c4d", scope, false), "static");
  assert.equal(routeFor("https://flysteder.hpgt.com/img/elgen-overview-1-800.webp", scope, false), "static");
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder/elgen/elgen-route.gpx", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/flysteder.geojson", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/assets/airspace.geojson", scope, false), "data");
  assert.equal(routeFor("https://flysteder.hpgt.com/sw.js", scope, false), null);
});

test("bare Kartverkets kartfliser lagres, aldri tredjeparter", () => {
  assert.equal(routeFor("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/10/236/551.png", scope, false), "tile");
  assert.equal(routeFor("https://a.tile.opentopomap.org/10/551/236.png", scope, false), null);
  assert.equal(routeFor("https://hpgt-flysteder.goatcounter.com/count?p=/", scope, false), null);
  assert.equal(routeFor("https://www.yr.no/nb/innhold/1-2/meteogram.svg", scope, false), null);
  assert.equal(routeFor("https://example.com/flysteder/", scope, true), null);
});

test("med stiprefiks håndteres bare adresser under det", () => {
  const prefixed = "https://hpgt-com.github.io/flying-sites/";
  assert.equal(routeFor("https://hpgt-com.github.io/flying-sites/assets/js/common.js", prefixed, false), "static");
  assert.equal(routeFor("https://hpgt-com.github.io/other/", prefixed, true), null);
});

test("engelske sider får den engelske frakoblet-siden", () => {
  assert.equal(offlineUrl("/en/sites/elgen/", "/"), "/en/offline/");
  assert.equal(offlineUrl("/flysteder/elgen/", "/"), "/offline/");
  assert.equal(offlineUrl("/flying-sites/en/", "/flying-sites/"), "/flying-sites/en/offline/");
});

test("manifestet følger språket og stiprefikset", () => {
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

test("filene en lagret side bruker: egne ressurser og bilder, med srcset, ikke andre nettsteder", () => {
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
  assert.equal(staticToKeep("https://flysteder.hpgt.com/assets/fonts/barlow.woff2", keep, scope), true, "fonter og Leaflets bilder blir værende");
});

// Et lite Cache API i minnet, nok til service workerens install og activate.
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
  const match = async (r, o) => (o && o.cacheName ? (await open(o.cacheName)).match(r) : undefined);
  return { all, api: { open, keys: async () => [...all.keys()], delete: async (n) => all.delete(n), match } };
}

test("en side lagret før en utrulling har fortsatt CSS og JS uten nett; ubrukte filer forsvinner", async () => {
  const { all, api } = cacheStorage();
  // Før utrullingen: siden og de gamle filene den bruker, i den statiske cachen til den gamle service workeren.
  const page = `<link href="/assets/css/styles.css?v=old"><script src="/assets/js/site.js?v=old"></script>`;
  (await api.open("fs-pages-" + CACHE_SCHEMA)).put("https://flysteder.hpgt.com/flysteder/elgen/", new Response(page));
  const oldStatic = await api.open("fs-static-1a2b3c4d5e6f");
  for (const u of ["assets/css/styles.css?v=old", "assets/js/site.js?v=old", "assets/js/home.js?v=unused", "img/x-400.webp"]) {
    await oldStatic.put(scope + u, new Response(u));
  }
  // Den nye service workeren, slik src/sw.11ty.js bygger den.
  const precache = ["/assets/css/styles.css?v=new", "/assets/js/site.js?v=new"];
  const src = [`var VERSION = "new"; var SCHEMA = ${JSON.stringify(CACHE_SCHEMA)}; var BASE = "/"; var PRECACHE = ${JSON.stringify(precache)};`,
    "var MAX_TILES = 500; var MAX_PAGES = 120;", String(routeFor), String(offlineUrl), String(referencedAssets), String(staticToKeep),
    fs.readFileSync(new URL("../lib/service-worker.js", import.meta.url), "utf8")].join("\n");
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, registration: { scope }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, caches: api, URL, Response, Promise, setTimeout, fetch: async () => { throw new Error("offline"); } });
  const run = async (type) => { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); await p; };
  await run("install");
  await run("activate");
  const kept = [...all.get("fs-static-" + CACHE_SCHEMA).keys()].map((u) => u.slice(scope.length)).sort();
  assert.deepEqual(kept, ["assets/css/styles.css?v=new", "assets/css/styles.css?v=old", "assets/js/site.js?v=new", "assets/js/site.js?v=old",
    "en/offline/", "offline/"], "den gamle sidens filer, de nye og frakoblet-sidene; ikke den ubrukte filen eller bildet");
  assert.ok(!all.has("fs-static-1a2b3c4d5e6f"), "den gamle cachen per versjon er borte");
  assert.ok(all.has("fs-pages-" + CACHE_SCHEMA), "de lagrede sidene blir værende");
});

test("en kartflis går til kartet så snart den kommer; den lagres etterpå, og lageret trimmes av og til", async () => {
  const { all, api } = cacheStorage();
  const src = [`var VERSION = "v"; var SCHEMA = ${JSON.stringify(CACHE_SCHEMA)}; var BASE = "/"; var PRECACHE = [];`,
    "var MAX_TILES = 25; var MAX_PAGES = 120;", String(routeFor), String(offlineUrl), String(referencedAssets), String(staticToKeep),
    fs.readFileSync(new URL("../lib/service-worker.js", import.meta.url), "utf8")].join("\n");
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, registration: { scope }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const fetched = [];
  const tile = (n) => `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/8/58/${n}.png`;
  vm.runInNewContext(src, { self, caches: api, URL, Response, Promise, setTimeout, fetch: async (url, init) => {
    fetched.push([String(url), init]);
    // Nodes Response har typen "default"; service workeren lagrer bare "basic" eller "cors", slik en ekte fetch gir.
    const res = new Response("png " + url, { status: 200 });
    Object.defineProperty(res, "type", { value: "cors" });
    const clone = res.clone.bind(res);
    res.clone = () => { const c = clone(); Object.defineProperty(c, "type", { value: "cors" }); return c; };
    return res;
  } });
  const waits = [];
  const ask = (url) => new Promise((resolve) => { listeners.fetch({ request: { method: "GET", url, mode: "no-cors" }, respondWith: (p) => resolve(p), waitUntil: (p) => waits.push(p) }); });
  const first = await ask(tile(1));
  assert.equal(await first.text(), "png " + tile(1), "selve flisen, fra nettet");
  assert.equal(fetched[0][1].mode, "cors", "hentet som CORS");
  assert.equal(fetched[0][1].credentials, "omit", "uten informasjonskapsler");
  assert.equal(waits.length, 1, "lagringen registreres med waitUntil, uten å ventes på");
  await Promise.all(waits);
  const store = all.get("fs-tiles-" + CACHE_SCHEMA);
  assert.ok(store && store.has(tile(1)), "lagret når svaret er levert");
  assert.equal(await (await ask(tile(1))).text(), "png " + tile(1), "andre gang kommer den fra lageret");
  assert.equal(fetched.length, 1, "uten en ny henting");
  // 30 fliser til: lageret går over MAX_TILES (25) mellom trimmingene og kuttes tilbake til det ved den 20. lagrede
  // flisen.
  for (let i = 2; i <= 31; i++) await ask(tile(i));
  await Promise.all(waits);
  // 31 lagret; trimmingen ved den 20. lot 20 bli igjen, så kom 11 til: 31 i alt kuttes aldri, 25 er grensen ved neste
  // trimming.
  assert.equal(store.size, 31, "ingen trimming siden den 20. flisen");
  for (let i = 32; i <= 40; i++) await ask(tile(i));
  await Promise.all(waits);
  assert.equal(store.size, 25, "trimmet til MAX_TILES ved den 40. flisen");
  assert.ok(!store.has(tile(1)) && store.has(tile(40)), "de eldste forsvinner først");
});
