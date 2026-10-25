// The service worker body. Not a module: src/sw.11ty.js puts VERSION, SCHEMA, BASE, PRECACHE, MAX_TILES,
// MAX_PAGES, routeFor(), offlineUrl(), referencedAssets() and staticToKeep() (lib/pwa.js) in front of it, and
// publishes the result as /sw.js.
//
// Strategies (routeFor decides which):
//   page    network first, so the forecast and content are as fresh as possible. Without network (or after 4 s on a
//           slow connection, if the page is stored) the stored copy is shown, and otherwise the offline page.
//   static  CSS, JS, fonts and images: the stored copy at once, updated in the background (stale-while-revalidate).
//           CSS and JS have a content hash in the URL (lib/assets.js), so a new version is a new URL. The old
//           versions are kept as long as a stored page uses them, so a page stored before a deploy still has its
//           CSS and JS offline (activate).
//   data    GPX, GeoJSON and KML: network first, the stored copy offline.
//   tile    Kartverket map tiles the visitor has already seen: stored copy first. Nothing is downloaded in advance,
//           so the visitor uses no more data than when browsing, and Kartverket gets no extra load. At most
//           MAX_TILES tiles (up to some tens of MB) are kept, so an area viewed at home is there in the field.
// Anything else (GoatCounter, Yr, other map layers, other sites) is left to the browser and never stored.

/* global SCHEMA, BASE, PRECACHE, MAX_TILES, MAX_PAGES, routeFor, offlineUrl, referencedAssets, staticToKeep */

// VERSION changes when a stored file or the service worker changes (src/sw.11ty.js), so the browser installs the new
// one; the caches themselves keep their names across versions.
var STATIC = "fs-static-" + SCHEMA;
var PAGES = "fs-pages-" + SCHEMA;
var DATA = "fs-data-" + SCHEMA;
var TILES = "fs-tiles-" + SCHEMA;
var CURRENT = [STATIC, PAGES, DATA, TILES];
var PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(STATIC);
    // One at a time, so a single failing file does not stop the install. The offline pages are required.
    await cache.addAll([BASE + "offline/", BASE + "en/offline/"]);
    await Promise.allSettled(PRECACHE.map(function (url) { return cache.add(url); }));
    var pages = await caches.open(PAGES);
    await Promise.allSettled([BASE, BASE + "en/"].map(function (url) { return pages.add(url); }));
    await self.skipWaiting();
  })());
});

// A new version takes over: the static files of earlier versions are kept as long as a stored page (or this version)
// uses them, and the rest are removed, so a page stored before a deploy still works offline and the cache does not
// grow without end. Caches with other names (an older schema, or the per-version static caches the service worker
// used before 20.10.2026, whose files are carried over first) are removed. The pages, data and tiles are kept.
self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    var cache = await caches.open(STATIC);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf("fs-static-") !== 0 || names[i] === STATIC) continue;
      var old = await caches.open(names[i]), oldKeys = await old.keys();
      for (var j = 0; j < oldKeys.length; j++) {
        if (await cache.match(oldKeys[j])) continue;
        var r = await old.match(oldKeys[j]);
        if (r) await cache.put(oldKeys[j], r);
      }
    }
    var scope = self.registration.scope;
    var keep = PRECACHE.map(function (u) { return new URL(u, scope).href; });
    var pages = await caches.open(PAGES), pageKeys = await pages.keys();
    for (var p = 0; p < pageKeys.length; p++) {
      var stored = await pages.match(pageKeys[p]);
      if (stored) keep = keep.concat(referencedAssets(await stored.text(), pageKeys[p].url, scope));
    }
    var keys = await cache.keys();
    for (var k = 0; k < keys.length; k++) {
      if (!staticToKeep(keys[k].url, keep, scope)) await cache.delete(keys[k]);
    }
    await Promise.all(names.filter(function (n) { return n.indexOf("fs-") === 0 && CURRENT.indexOf(n) < 0; })
      .map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

// Keeps at most max entries. Cache keys come back in the order they were added, so the oldest go first.
async function trim(cacheName, max) {
  var cache = await caches.open(cacheName);
  var keys = await cache.keys();
  for (var i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Only complete, same-origin or CORS responses are stored (not opaque ones, which cannot be checked).
function storable(response) {
  return response && response.ok && (response.type === "basic" || response.type === "cors");
}

async function put(cacheName, request, response, max) {
  var cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (max) await trim(cacheName, max);
}

function noop() {}

// The handlers start the network request and register storing it with event.waitUntil right away, before any
// await: once the response has been handed to the page, the event no longer accepts waitUntil.
function fetchAndStore(event, request, cacheName, key, max, init) {
  var network = fetch(request, init);
  event.waitUntil(network.then(function (response) {
    if (storable(response)) return put(cacheName, key, response.clone(), max);
  }).catch(noop));
  return network;
}

async function page(event) {
  var request = event.request;
  var network = fetchAndStore(event, request, PAGES, request.url.split("?")[0], MAX_PAGES);
  var stored = await caches.match(request, { ignoreSearch: true });
  try {
    if (!stored) return await network;
    // With a stored copy, a slow connection (common in the mountains) does not keep the visitor waiting.
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(stored); }, PAGE_TIMEOUT_MS); });
    return await Promise.race([network, timeout]);
  } catch (err) {
    if (stored) return stored;
    return (await caches.match(offlineUrl(new URL(request.url).pathname, BASE))) || Response.error();
  }
}

async function staticFile(event) {
  var network = fetchAndStore(event, event.request, STATIC, event.request);
  var stored = await caches.match(event.request);
  if (stored) {
    network.catch(noop);
    return stored;
  }
  return network;
}

async function data(event) {
  var network = fetchAndStore(event, event.request, DATA, event.request);
  try {
    return await network;
  } catch (err) {
    return (await caches.match(event.request, { ignoreSearch: true })) || Response.error();
  }
}

// The map asks for tiles as plain images (no-cors), which cannot be checked or stored safely. Kartverket allows
// CORS, so a missing tile is fetched as CORS instead, without cookies. The tile goes to the map as soon as it
// arrives; storing it, and trimming the store (which lists every stored tile), happen in the background, and the
// trim only every TRIM_EVERY tiles, so a zoom that brings twenty new tiles is not held up by twenty trims.
var TRIM_EVERY = 20;
var tilePuts = 0;
async function tile(event) {
  var url = event.request.url;
  var stored = await caches.match(url, { cacheName: TILES });
  if (stored) return stored;
  var network = fetch(url, { mode: "cors", credentials: "omit" });
  event.waitUntil(network.then(function (response) {
    if (storable(response)) return put(TILES, url, response.clone(), ++tilePuts % TRIM_EVERY === 0 ? MAX_TILES : 0);
  }).catch(noop));
  return network;
}

var HANDLERS = { page: page, static: staticFile, data: data, tile: tile };

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var route = routeFor(event.request.url, self.registration.scope, event.request.mode === "navigate");
  if (route) event.respondWith(HANDLERS[route](event));
});

// On the very first visit the page loaded before the service worker existed, so pwa.js asks for it to be stored.
self.addEventListener("message", function (event) {
  var msg = event.data || {};
  if (msg.type !== "store-page" || typeof msg.url !== "string") return;
  if (routeFor(msg.url, self.registration.scope, true) !== "page") return;
  event.waitUntil(fetch(msg.url).then(function (response) {
    if (storable(response)) return put(PAGES, msg.url.split("?")[0].split("#")[0], response, MAX_PAGES);
  }).catch(function () {}));
});
