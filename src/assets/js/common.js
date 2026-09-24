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
      className: "base-tiles",
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    });
    var openTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: "abc",
      className: "base-tiles",
      attribution: 'Kartdata: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsytere, SRTM | Kartstil: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    });
    topo.addTo(map);
    map.layersControl = L.control.layers({ "Topografisk (Kartverket)": topo, "OpenTopoMap": openTopo }, null, { position: "topright" }).addTo(map);
    // Termikk fra thermal.kk7.ch: statistikk fra loggede flyturer, ikke et varsel. Av som standard.
    // Flisene er i TMS-rekkefølge, og src skal oppgi domenet vårt (vilkår på thermal.kk7.ch).
    ["skyways_all_all", "thermals_all_all"].forEach(function (name, i) {
      var layer = L.tileLayer("https://thermal.kk7.ch/tiles/" + name + "/{z}/{x}/{y}.png?src=" + encodeURIComponent(location.hostname), {
        tms: true, maxNativeZoom: 13, maxZoom: 18, opacity: 0.7,
        attribution: 'Termikk: <a href="https://thermal.kk7.ch">thermal.kk7.ch</a> (<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>)',
      });
      map.layersControl.addOverlay(layer, i ? "Termikk: hotspots" : "Termikk: skyways");
    });
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

  // --- Luftromslag ---
  // Fire grupper med av/på i kartets lagvelger, som i IPPC. Alle er av til å begynne med, og
  // luftrommene (fra openAIP, se scripts/update-airspace.mjs) lastes først når en gruppe slås på.
  var AIRSPACE_GROUPS = [
    { name: "Luftrom: TMA", types: ["TMA", "CTA"], color: "#2F6FB5", dash: null },
    { name: "Luftrom: CTR", types: ["CTR", "MCTR", "ATZ", "TIZ"], color: "#C0392B", dash: null },
    { name: "Luftrom: militære områder", types: ["MTA", "TRA", "TSA"], color: "#7B3FA0", dash: "6 4" },
    { name: "Luftrom: fare og restriksjon", types: ["D", "R", "P"], color: "#C24A12", dash: "6 4" },
  ];

  function formatLimit(l) {
    if (!l) return "";
    if (l.ref === "GND" && !l.value) return "bakken";
    if (l.unit === "FL") return "FL" + l.value;
    var text = l.value + (l.unit === "M" ? " m" : " ft");
    if (l.ref === "GND") return text + " over bakken";
    return l.ref === "MSL" && l.unit === "FT" ? text + " (ca. " + Math.round(l.value * 0.3048) + " moh)" : text;
  }

  function airspacePopup(p) {
    var e = escapeHtml;
    var rows = [["Klasse", p.class], ["Nedre", formatLimit(p.lower)], ["Øvre", formatLimit(p.upper)]]
      .filter(function (row) { return row[1]; })
      .map(function (row) { return "<tr><th>" + row[0] + "</th><td>" + e(row[1]) + "</td></tr>"; }).join("");
    return '<div class="airspace-popup"><strong>' + e(p.name) + "</strong><table>" + rows + "</table>" +
      (p.byNotam ? '<p class="airspace-popup__notam">Aktiveres ved NOTAM. Sjekk IPPC.</p>' : "") + "</div>";
  }

  function addAirspaceLayers(map, url) {
    if (!url || !map.layersControl) return;
    var groups = AIRSPACE_GROUPS.map(function (g) { return { def: g, layer: L.layerGroup() }; });
    groups.forEach(function (g) { map.layersControl.addOverlay(g.layer, g.def.name); });
    var loading = null, attribution = null, active = 0;

    function load() {
      if (loading) return loading;
      loading = fetch(url).then(function (r) { return r.json(); }).then(function (data) {
        attribution = "Luftrom: openAIP (CC BY-NC 4.0), " + (data.fetched || "").split("-").reverse().join(".") +
          ". Ikke for navigasjon, sjekk IPPC";
        data.features.forEach(function (f) {
          var g = groups.find(function (x) { return x.def.types.indexOf(f.properties.type) !== -1; });
          if (!g) return;
          // Gjennomsiktig fyll, så kartet synes også der flere luftrom overlapper. Fyllet er likevel
          // klikkbart, og området lyser svakt opp når musen er over det.
          L.geoJSON(f, {
            style: { color: g.def.color, weight: 2, opacity: 0.9, fillColor: g.def.color, fillOpacity: 0, dashArray: g.def.dash },
            onEachFeature: function (feature, layer) {
              layer.on("mouseover", function () { layer.setStyle({ fillOpacity: 0.12, weight: 3 }); });
              layer.on("mouseout", function () { layer.setStyle({ fillOpacity: 0, weight: 2 }); });
            },
          }).bindPopup(airspacePopup(f.properties)).addTo(g.layer);
        });
      });
      return loading;
    }

    function isAirspace(layer) { return groups.some(function (g) { return g.layer === layer; }); }

    // Kreditering vises så lenge minst ett luftromslag er på.
    map.on("overlayadd", function (ev) {
      if (!isAirspace(ev.layer)) return;
      active++;
      load().then(function () {
        if (active && attribution) map.attributionControl.removeAttribution(attribution).addAttribution(attribution);
      });
    });
    map.on("overlayremove", function (ev) {
      if (!isAirspace(ev.layer)) return;
      active--;
      if (!active && attribution) map.attributionControl.removeAttribution(attribution);
    });
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
    addAirspaceLayers: addAirspaceLayers,
    fitWhenVisible: fitWhenVisible,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    readJson: readJson,
  };
})();
