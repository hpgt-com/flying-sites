// The site as an installable app that also works offline: the web app manifest and the service worker
// (src/manifest.webmanifest.11ty.js, src/sw.11ty.js and lib/service-worker.js).

import { dict } from "./i18n.js";

// The caches carry a fixed schema version, so what is stored survives a new deploy. Bump it only when the format of
// what is stored changes. The static files keep their versions in their URLs (?v=…, lib/assets.js), so an old stored
// page still finds the CSS and JS it was built with (see staticToKeep).
export const CACHE_SCHEMA = "v1";
// At most this many map tiles and pages are kept. The oldest are removed first.
export const MAX_TILES = 300;
export const MAX_PAGES = 120;

// Which strategy a request gets in the service worker, from its URL alone. scope is the service worker's scope
// (https://flysteder.hpgt.com/, or with a path prefix). navigate is true for page loads.
// Returns "page", "static", "data", "tile" or null (not handled: passed straight to the network).
// The function is copied into the service worker as text, so it must not use anything outside itself.
export function routeFor(url, scope, navigate) {
  var u = new URL(url);
  var s = new URL(scope);
  // Map tiles from Kartverket only: open data (CC BY 4.0) that allows CORS. Other tile servers (OpenTopoMap, EOX)
  // and third parties (GoatCounter, Yr, RainViewer) are never stored.
  if (u.origin === "https://cache.kartverket.no") return u.pathname.indexOf("/v1/wmts/") === 0 ? "tile" : null;
  if (u.origin !== s.origin || u.pathname.indexOf(s.pathname) !== 0) return null;
  var path = u.pathname.slice(s.pathname.length);
  if (navigate) return "page";
  if (/\.(gpx|geojson|kml)$/.test(path)) return "data";
  if (path.indexOf("assets/") === 0 || path.indexOf("img/") === 0) return "static";
  return null;
}

// The site's own files a stored page uses: the src, href and srcset addresses under assets/ and img/, as absolute
// URLs. Copied into the service worker as text, so it must not use anything outside itself.
export function referencedAssets(html, pageUrl, scope) {
  var out = [];
  var s = new URL(scope);
  var re = /\s(?:src|href|srcset|data-src-dark)="([^"]+)"/g, m;
  while ((m = re.exec(html))) {
    m[1].split(",").forEach(function (part) {
      var ref = part.trim().split(/\s+/)[0].replace(/&amp;/g, "&");
      if (!ref) return;
      try {
        var u = new URL(ref, pageUrl);
        var path = u.pathname.slice(s.pathname.length);
        if (u.origin === s.origin && u.pathname.indexOf(s.pathname) === 0 && (path.indexOf("assets/") === 0 || path.indexOf("img/") === 0)) out.push(u.href);
      } catch (err) { /* not a URL */ }
    });
  }
  return out;
}

// Whether a stored static file is kept when a new version of the service worker takes over. keep: the URLs the new
// version stores at install and those the stored pages use (referencedAssets). A versioned file (?v=…) and an image
// (img/) are kept only while something uses them; the rest (fonts, Leaflet's own images) always.
export function staticToKeep(url, keep, scope) {
  var u = new URL(url);
  var path = u.pathname.slice(new URL(scope).pathname.length);
  if (u.searchParams.has("v") || path.indexOf("img/") === 0) return keep.indexOf(u.href) !== -1;
  return true;
}

// The offline page for a URL: English pages get the English one. base is the path prefix ("/" or "/flying-sites/").
export function offlineUrl(path, base) {
  return path.indexOf(base + "en/") === 0 || path === base + "en" ? base + "en/offline/" : base + "offline/";
}

// The web app manifest for a language. base is the path prefix, home the front page in that language.
export function manifest(lang, base, home) {
  const t = dict(lang);
  return {
    id: home,
    name: t.common.siteTitle,
    short_name: t.pwa.shortName,
    description: t.pwa.description,
    lang: t.meta.htmlLang,
    start_url: home,
    // Both languages share the scope, so links between them stay in the app.
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
