// Innholdet i service workeren. Ikke en modul: src/sw.11ty.js setter VERSION, SCHEMA, BASE, PRECACHE, MAX_TILES,
// MAX_PAGES, routeFor(), offlineUrl(), referencedAssets() og staticToKeep() (lib/pwa.js) foran, og publiserer
// resultatet som /sw.js.
//
// Strategier (routeFor bestemmer hvilken):
//   page    nettet først, så varselet og innholdet er så ferskt som mulig. Uten nett (eller etter 4 s på en treg
//           forbindelse, hvis siden er lagret) vises den lagrede kopien, ellers siden for uten nett.
//   static  CSS, JS, skrifter og bilder: den lagrede kopien med en gang, oppdatert i bakgrunnen
//           (stale-while-revalidate).
//           CSS og JS har en hash av innholdet i adressen (lib/assets.js), så en ny versjon er en ny adresse. De gamle
//           versjonene beholdes så lenge en lagret side bruker dem, så en side lagret før en publisering fortsatt har
//           CSS-en og JS-en sin uten nett (activate).
//   data    GPX, GeoJSON og KML: nettet først, den lagrede kopien uten nett.
//   tile    kartfliser fra Kartverket som besøkende alt har sett: lagret kopi først. Ingenting lastes ned på forhånd,
//           så besøkende ikke bruker mer data enn når de surfer, og Kartverket får ingen ekstra last. Maks
//           MAX_TILES fliser (opptil noen titalls MB) beholdes, så et område du så på hjemme, er der i felt.
// Alt annet (GoatCounter, Yr, andre kartlag, andre nettsteder) overlates til nettleseren og lagres aldri.

/* global SCHEMA, BASE, PRECACHE, MAX_TILES, MAX_PAGES, routeFor, offlineUrl, referencedAssets, staticToKeep */

// VERSION endres når en lagret fil eller service workeren endres (src/sw.11ty.js), så nettleseren installerer den nye;
// cachene selv beholder navnene sine på tvers av versjoner.
var STATIC = "fs-static-" + SCHEMA;
var PAGES = "fs-pages-" + SCHEMA;
var DATA = "fs-data-" + SCHEMA;
var TILES = "fs-tiles-" + SCHEMA;
var CURRENT = [STATIC, PAGES, DATA, TILES];
var PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(STATIC);
    // Én om gangen, så én fil som feiler, ikke stopper installeringen. Sidene for uten nett er påkrevd.
    await cache.addAll([BASE + "offline/", BASE + "en/offline/"]);
    await Promise.allSettled(PRECACHE.map(function (url) { return cache.add(url); }));
    var pages = await caches.open(PAGES);
    await Promise.allSettled([BASE, BASE + "en/"].map(function (url) { return pages.add(url); }));
    await self.skipWaiting();
  })());
});

// En ny versjon tar over: de statiske filene fra tidligere versjoner beholdes så lenge en lagret side (eller denne
// versjonen) bruker dem, og resten fjernes, så en side lagret før en publisering fortsatt virker uten nett og cachen
// ikke vokser uten grense. Cacher med andre navn (et eldre skjema, eller de statiske cachene per versjon som service
// workeren brukte før 20.10.2026, der filene flyttes over først) fjernes. Sidene, dataene og flisene beholdes.
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

// Beholder maks max oppføringer. Nøklene i cachen kommer i den rekkefølgen de ble lagt til, så de eldste går først.
async function trim(cacheName, max) {
  var cache = await caches.open(cacheName);
  var keys = await cache.keys();
  for (var i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Bare fullstendige svar fra samme opphav eller med CORS lagres (ikke ugjennomsiktige svar, som ikke kan sjekkes).
function storable(response) {
  return response && response.ok && (response.type === "basic" || response.type === "cors");
}

async function put(cacheName, request, response, max) {
  var cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (max) await trim(cacheName, max);
}

function noop() {}

// Behandlerne starter forespørselen mot nettet og registrerer lagringen med event.waitUntil med en gang, før noen
// await: når svaret er gitt til siden, godtar hendelsen ikke lenger waitUntil.
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
    // Med en lagret kopi blir ikke besøkende sittende og vente på en treg forbindelse (vanlig på fjellet).
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

// Kartet ber om fliser som vanlige bilder (no-cors), som ikke kan sjekkes eller lagres trygt. Kartverket tillater
// CORS, så en flis som mangler, hentes i stedet med CORS, uten informasjonskapsler. Flisen går til kartet så snart
// den kommer; lagringen, og opprydningen i lageret (som lister hver lagret flis), skjer i bakgrunnen, og opprydningen
// bare hver TRIM_EVERY flis, så en zoom som gir tjue nye fliser, ikke holdes igjen av tjue opprydninger.
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

// Ved aller første besøk ble siden lastet før service workeren fantes, så pwa.js ber om at den lagres.
self.addEventListener("message", function (event) {
  var msg = event.data || {};
  if (msg.type !== "store-page" || typeof msg.url !== "string") return;
  if (routeFor(msg.url, self.registration.scope, true) !== "page") return;
  event.waitUntil(fetch(msg.url).then(function (response) {
    if (storable(response)) return put(PAGES, msg.url.split("?")[0].split("#")[0], response, MAX_PAGES);
  }).catch(function () {}));
});
