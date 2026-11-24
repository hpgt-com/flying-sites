// Nettstedet som en app som kan installeres og også virker uten nett: web app-manifestet og service workeren
// (src/manifest.webmanifest.11ty.js, src/sw.11ty.js og lib/service-worker.js).

import { dict } from "./i18n.js";

// Cachene har en fast skjemaversjon, så det som er lagret, overlever en ny publisering. Øk den bare når formatet på
// det som lagres, endres. De statiske filene har versjonen i adressen (?v=…, lib/assets.js), så en gammel lagret
// side fortsatt finner CSS-en og JS-en den ble bygd med (se staticToKeep).
export const CACHE_SCHEMA = "v1";
// Maks så mange kartfliser og sider beholdes. De eldste fjernes først. 500 fliser er omtrent fem zoomnivåer av
// et kart på en PC med litt panorering (30–80 KB hver), så zoomer du inn igjen, finnes det som ble vist før.
export const MAX_TILES = 500;
export const MAX_PAGES = 120;

// Hvilken strategi en forespørsel får i service workeren, ut fra adressen alene. scope er omfanget til service
// workeren (https://flysteder.hpgt.com/, eller med et stiprefiks). navigate er true for sidelastinger.
// Gir "page", "static", "data", "tile" eller null (ikke håndtert: går rett til nettet).
// Funksjonen kopieres inn i service workeren som tekst, så den kan ikke bruke noe utenfor seg selv.
export function routeFor(url, scope, navigate) {
  var u = new URL(url);
  var s = new URL(scope);
  // Bare kartfliser fra Kartverket: åpne data (CC BY 4.0) som tillater CORS. Andre flisservere (OpenTopoMap, EOX)
  // og tredjeparter (GoatCounter, Yr, RainViewer) lagres aldri.
  if (u.origin === "https://cache.kartverket.no") return u.pathname.indexOf("/v1/wmts/") === 0 ? "tile" : null;
  if (u.origin !== s.origin || u.pathname.indexOf(s.pathname) !== 0) return null;
  var path = u.pathname.slice(s.pathname.length);
  if (navigate) return "page";
  if (/\.(gpx|geojson|kml)$/.test(path)) return "data";
  if (path.indexOf("assets/") === 0 || path.indexOf("img/") === 0) return "static";
  return null;
}

// Nettstedets egne filer en lagret side bruker: src-, href- og srcset-adressene under assets/ og img/, som absolutte
// adresser. Kopieres inn i service workeren som tekst, så den kan ikke bruke noe utenfor seg selv.
export function referencedAssets(html, pageUrl, scope) {
  var out = [];
  var s = new URL(scope);
  // data-…-script: skriptene kartlagene henter første gang de brukes (lazyOverlays i common.js).
  var re = /\s(?:src|href|srcset|data-src-dark|data-[a-z]+-script)="([^"]+)"/g, m;
  while ((m = re.exec(html))) {
    m[1].split(",").forEach(function (part) {
      var ref = part.trim().split(/\s+/)[0].replace(/&amp;/g, "&");
      if (!ref) return;
      try {
        var u = new URL(ref, pageUrl);
        var path = u.pathname.slice(s.pathname.length);
        if (u.origin === s.origin && u.pathname.indexOf(s.pathname) === 0 && (path.indexOf("assets/") === 0 || path.indexOf("img/") === 0)) out.push(u.href);
      } catch (err) { /* ikke en adresse */ }
    });
  }
  return out;
}

// Om en lagret statisk fil beholdes når en ny versjon av service workeren tar over. keep: adressene den nye versjonen
// lagrer ved installering, og de de lagrede sidene bruker (referencedAssets). En fil med versjon (?v=…) og et bilde
// (img/) beholdes bare så lenge noe bruker dem; resten (skrifter, Leaflets egne bilder) alltid.
export function staticToKeep(url, keep, scope) {
  var u = new URL(url);
  var path = u.pathname.slice(new URL(scope).pathname.length);
  if (u.searchParams.has("v") || path.indexOf("img/") === 0) return keep.indexOf(u.href) !== -1;
  return true;
}

// Siden uten nett for en adresse: engelske sider får den engelske. base er stiprefikset ("/" eller "/flying-sites/").
export function offlineUrl(path, base) {
  return path.indexOf(base + "en/") === 0 || path === base + "en" ? base + "en/offline/" : base + "offline/";
}

// Web app-manifestet for et språk. base er stiprefikset, home forsiden på det språket.
export function manifest(lang, base, home) {
  const t = dict(lang);
  return {
    id: home,
    name: t.common.siteTitle,
    short_name: t.pwa.shortName,
    description: t.pwa.description,
    lang: t.meta.htmlLang,
    start_url: home,
    // Begge språkene deler omfanget, så lenker mellom dem blir i appen.
    scope: base,
    display: "standalone",
    background_color: "#F3F5F4",
    theme_color: "#F3F5F4",
    icons: [
      { src: `${base}assets/img/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}assets/img/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}assets/img/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
