// Felles for forsiden og stedssidene: kartlag og vindrose.
(function () {
  "use strict";

  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var DIRECTION_LABELS = { N: "N", NE: "NØ", E: "Ø", SE: "SØ", S: "S", SW: "SV", W: "V", NW: "NV" };

  // Samme stier som rose-makroen i src/_includes/macros.njk.
  var ROSE_PATHS = [
    "M58.8 21.7 A62 62 0 0 1 101.2 21.7 L85.5 65.0 A16 16 0 0 0 74.5 65.0Z",
    "M106.2 23.8 A62 62 0 0 1 136.2 53.8 L94.5 73.2 A16 16 0 0 0 86.8 65.5Z",
    "M138.3 58.8 A62 62 0 0 1 138.3 101.2 L95.0 85.5 A16 16 0 0 0 95.0 74.5Z",
    "M136.2 106.2 A62 62 0 0 1 106.2 136.2 L86.8 94.5 A16 16 0 0 0 94.5 86.8Z",
    "M101.2 138.3 A62 62 0 0 1 58.8 138.3 L74.5 95.0 A16 16 0 0 0 85.5 95.0Z",
    "M53.8 136.2 A62 62 0 0 1 23.8 106.2 L65.5 86.8 A16 16 0 0 0 73.2 94.5Z",
    "M21.7 101.2 A62 62 0 0 1 21.7 58.8 L65.0 74.5 A16 16 0 0 0 65.0 85.5Z",
    "M23.8 53.8 A62 62 0 0 1 53.8 23.8 L73.2 65.5 A16 16 0 0 0 65.5 73.2Z",
  ];

  // "primary" | "possible" | "none", som directionType i lib/format.js.
  function directionType(site, code) {
    if (site.primary.indexOf(code) !== -1) return "primary";
    if (site.possible.indexOf(code) !== -1) return "possible";
    return "none";
  }

  function roseSvg(site, size, labels) {
    var viewBox = labels ? "-12 -12 184 184" : "18 18 124 124";
    var svg = '<svg class="rose" width="' + size + '" height="' + size + '" viewBox="' + viewBox + '" aria-hidden="true">';
    DIRECTIONS.forEach(function (code, i) {
      svg += '<path d="' + ROSE_PATHS[i] + '" class="sector sector--' + directionType(site, code) + '"></path>';
    });
    svg += '<circle cx="80" cy="80" r="9" class="rose__center"></circle>';
    if (labels) {
      svg += '<text x="80" y="2" text-anchor="middle">N</text><text x="80" y="168" text-anchor="middle">S</text>' +
        '<text x="-4" y="85" text-anchor="middle">V</text><text x="164" y="85" text-anchor="middle">Ø</text>';
    }
    return svg + "</svg>";
  }

  function createMap(element, options) {
    var map = L.map(element, Object.assign({ scrollWheelZoom: true, zoomControl: true }, options || {}));
    var topo = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    });
    var openTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: "abc",
      attribution: 'Kartdata: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsytere, SRTM | Kartstil: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    });
    topo.addTo(map);
    L.control.layers({ "Topografisk (Kartverket)": topo, "OpenTopoMap": openTopo }, null, { position: "topright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    return map;
  }

  // Leaflet må vite kartets størrelse før det zoomer til innholdet. Elementet kan ha null
  // størrelse når skriptet kjører (skjult fane, layout ikke ferdig), så vi venter på første
  // reelle størrelse og holder kartet oppdatert når den endres.
  function fitWhenVisible(map, element, fit) {
    var done = false;
    map.setView([68.8, 16.4], 9);
    function check() {
      if (!element.clientWidth || !element.clientHeight) return;
      map.invalidateSize();
      if (!done) { done = true; fit(); }
    }
    if ("ResizeObserver" in window) new ResizeObserver(check).observe(element);
    else window.addEventListener("resize", check);
    check();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Tall med norsk desimalkomma.
  function formatNumber(n, decimals) {
    return Number(n).toFixed(decimals || 0).replace(".", ",");
  }

  function readJson(id) {
    var el = document.getElementById(id);
    return el ? JSON.parse(el.textContent) : null;
  }

  // Samme merking som external()-makroen i macros.njk.
  var EXTERNAL_MARK = '<svg class="external-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg><span class="visually-hidden"> (åpnes i ny fane)</span>';

  window.FlyingSites = {
    EXTERNAL_MARK: EXTERNAL_MARK,
    DIRECTIONS: DIRECTIONS,
    DIRECTION_LABELS: DIRECTION_LABELS,
    directionType: directionType,
    roseSvg: roseSvg,
    createMap: createMap,
    fitWhenVisible: fitWhenVisible,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    readJson: readJson,
  };
})();
