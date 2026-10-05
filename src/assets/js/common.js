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

  // wind (valgfri): { code, rating } fra vindvurderingen. Sektoren vinden kommer fra «løftes» litt ut og
  // fylles med vurderingsfargen, så man ser om vinden treffer en startretning uten en egen pil.
  var LIFT = 8;
  function roseSvg(site, size, labels, wind) {
    var viewBox = labels ? "-12 -12 184 184" : wind ? (18 - LIFT) + " " + (18 - LIFT) + " " + (124 + 2 * LIFT) + " " + (124 + 2 * LIFT) : "18 18 124 124";
    var svg = '<svg class="rose" width="' + size + '" height="' + size + '" viewBox="' + viewBox + '" aria-hidden="true">';
    var lifted = "";
    DIRECTIONS.forEach(function (code, i) {
      if (wind && wind.code === code) {
        var a = i * 45 * Math.PI / 180;
        lifted = '<path d="' + ROSE_PATHS[i] + '" class="sector sector--wind sector--wind-' + wind.rating + '" transform="translate(' +
          (Math.sin(a) * LIFT).toFixed(1) + " " + (-Math.cos(a) * LIFT).toFixed(1) + ')"></path>';
        return;
      }
      svg += '<path d="' + ROSE_PATHS[i] + '" class="sector sector--' + directionType(site, code) + '"></path>';
    });
    svg += lifted;
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
  // Knapper under zoomknappene: «Vis hele …» (hus) går tilbake til utsnittet fit() gir, og fullskjerm
  // legger kartet over hele siden. Ikke nettleserens fullskjerm, så det også virker på iPhone. Esc eller
  // knappen igjen lukker. Utsnittet tilpasses når kartet bytter størrelse. Brukes på forsiden og stedssiden.
  var ICON_HOME = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"></path><path d="M5 10v10h5v-6h4v6h5V10"></path></svg>';
  var ICON_EXPAND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg>';
  var ICON_SHRINK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"></path></svg>';
  function controlButton(onClick) {
    var bar = L.DomUtil.create("div", "leaflet-bar map-reset");
    var button = L.DomUtil.create("a", "", bar);
    button.href = "#";
    button.setAttribute("role", "button");
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, "click", function (ev) { L.DomEvent.preventDefault(ev); onClick(); });
    return { bar: bar, button: button };
  }
  function addViewControls(map, mapEl, fit, resetLabel) {
    var Reset = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        var c = controlButton(function () { map.closePopup(); fit(); });
        c.button.title = resetLabel;
        c.button.setAttribute("aria-label", resetLabel);
        c.button.innerHTML = ICON_HOME;
        return c.bar;
      },
    });
    new Reset().addTo(map);

    var fullscreenButton = null;
    function setFullscreen(on, keepView) {
      mapEl.classList.toggle("map--fullscreen", on);
      document.body.classList.toggle("has-fullscreen-map", on);
      fullscreenButton.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
      var label = on ? "Lukk fullskjerm" : "Vis kartet i fullskjerm";
      fullscreenButton.title = label;
      fullscreenButton.setAttribute("aria-label", label);
      fullscreenButton.setAttribute("aria-pressed", String(on));
      if (keepView) return;
      map.invalidateSize();
      map.closePopup();
      fit();
    }
    var Fullscreen = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        var c = controlButton(function () { setFullscreen(!mapEl.classList.contains("map--fullscreen")); });
        fullscreenButton = c.button;
        return c.bar;
      },
    });
    new Fullscreen().addTo(map);
    setFullscreen(false, true);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && mapEl.classList.contains("map--fullscreen")) setFullscreen(false);
    });
  }

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

  // --- Starter på stedssiden og i 3D-visningen ---
  // Starter med egen posisjon (launches[].lat/lon) får hver sin rose med sine retninger. Hovedstarten
  // (launch) viser retningene til startene uten egen posisjon, eller alle retningene når ingen har det.
  // Bare retninger stedet passer for (hovedretning eller mulig) tas med, så linjer som «ikke egnet,
  // men mulig i svak vind» ikke gir farge. En start uten slike retninger tegnes ikke.
  // data: { launch, launches, wind_directions }. Gir [{ lat, lon, directions, label, texts }].
  function launchPoints(data) {
    var wind = data.wind_directions || {};
    var all = (wind.primary || []).concat(wind.possible || []);
    var usable = function (list) { return DIRECTIONS.filter(function (d) { return all.indexOf(d) !== -1 && (list || []).indexOf(d) !== -1; }); };
    var label = function (dirs) { return "Start " + dirs.map(function (d) { return DIRECTION_LABELS[d]; }).join(", "); };
    var launches = data.launches || [];
    var placed = launches.filter(function (l) { return l.lat != null && l.lon != null; });
    var points = [];
    if (!placed.length) {
      points.push({ lat: data.launch.lat, lon: data.launch.lon, directions: usable(all), label: "Start",
        texts: launches.map(function (l) { return l.text; }).filter(Boolean) });
    } else {
      var rest = launches.filter(function (l) { return l.lat == null; });
      var restDirs = usable([].concat.apply([], rest.map(function (l) { return l.directions || []; })));
      if (restDirs.length) {
        points.push({ lat: data.launch.lat, lon: data.launch.lon, directions: restDirs, label: label(restDirs),
          texts: rest.filter(function (l) { return usable(l.directions).length; }).map(function (l) { return l.text; }).filter(Boolean) });
      }
      placed.forEach(function (l) {
        var dirs = usable(l.directions);
        if (dirs.length) points.push({ lat: l.lat, lon: l.lon, directions: dirs, label: label(dirs), texts: l.text ? [l.text] : [] });
      });
    }
    return points;
  }

  // --- Retningsbuer ---
  // Hvilke sider av fjellet stedet passer for: én gul bue per retning i wind_directions, med en pil ut.
  // Mørk gul er hovedretning, lys gul mulig. Brukes i kartet på stedssiden (ovenfra) og i 3D-visningen.
  // Har startene egne posisjoner (launches[].lat/lon), får hver retningsgruppe (starter med samme
  // retninger) sin egen bue der startene ligger: midt mellom dem, med radius til lengste start +
  // ARC_RADIUS_PLACED_M, så buen strekker seg langs siden mellom dem. Uten egne posisjoner er det én bue
  // rundt hovedstarten, eller rundt direction_arc i tegningen (<id>-drawing.geojson).
  // data: { launch, launches, wind_directions, drawing }. Koordinatene er [lon, lat].
  var ARC_COLORS = { primary: "#F2B705", possible: "#F8DC7A" };
  var ARC_RADIUS_M = 250, ARC_RADIUS_PLACED_M = 110, ARC_ARROW_M = 70;
  var BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  // Punkt `meters` fra [lon, lat] i retning `bearing` (grader, 0 er nord). Godt nok på korte avstander.
  function offset(from, bearing, meters) {
    var b = bearing * Math.PI / 180;
    return [from[0] + Math.sin(b) * meters / (111320 * Math.cos(from[1] * Math.PI / 180)), from[1] + Math.cos(b) * meters / 110540];
  }
  function distanceM(a, b) { return Math.hypot((a[1] - b[1]) * 110540, (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180)); }

  function arcGroups(data) {
    var wind = data.wind_directions || {}, arcConfig = data.drawing && data.drawing.direction_arc;
    var all = DIRECTIONS.filter(function (d) { return (wind.primary || []).indexOf(d) !== -1 || (wind.possible || []).indexOf(d) !== -1; });
    var placed = (data.launches || []).some(function (l) { return l.lat != null && l.lon != null; });
    if (arcConfig || !placed) {
      return [{ center: (arcConfig && arcConfig.center) || [data.launch.lon, data.launch.lat],
        radius: (arcConfig && arcConfig.radius) || ARC_RADIUS_M, directions: all }];
    }
    var groups = {};
    launchPoints(data).forEach(function (p) {
      var key = p.directions.join(",");
      (groups[key] = groups[key] || { directions: p.directions, points: [] }).points.push([p.lon, p.lat]);
    });
    return Object.keys(groups).map(function (key) {
      var g = groups[key], n = g.points.length;
      var center = [g.points.reduce(function (s, q) { return s + q[0]; }, 0) / n, g.points.reduce(function (s, q) { return s + q[1]; }, 0) / n];
      var spread = Math.max.apply(null, g.points.map(function (q) { return distanceM(q, center); }));
      return { center: center, radius: spread + ARC_RADIUS_PLACED_M, directions: g.directions };
    });
  }

  // [{ direction, label, color, pts, bearing, center, radius, mid, tip }], én per retning og gruppe.
  // options.minRadius og options.arrow (meter) lar kartet holde buen synlig når man zoomer ut.
  function directionArcs(data, options) {
    var wind = data.wind_directions || {}, arcs = [], o = options || {};
    var arrow = o.arrow || ARC_ARROW_M;
    arcGroups(data).forEach(function (g) {
      var radius = Math.max(g.radius, o.minRadius || 0);
      g.directions.forEach(function (d) {
        var pts = [];
        for (var az = BEARINGS[d] - 22.5; az <= BEARINGS[d] + 22.5 + 0.01; az += 3) pts.push(offset(g.center, az, radius));
        var type = (wind.primary || []).indexOf(d) !== -1 ? "primary" : "possible";
        arcs.push({ direction: d, label: DIRECTION_LABELS[d], color: ARC_COLORS[type], pts: pts, bearing: BEARINGS[d],
          center: g.center, radius: radius, mid: offset(g.center, BEARINGS[d], radius), tip: offset(g.center, BEARINGS[d], radius + arrow) });
      });
    });
    return arcs;
  }

  // Pilspiss ved `tip` i retning `bearing`, som trekant i meter: [[lon, lat], ...].
  function arrowHead(tip, bearing, size) {
    var base = offset(tip, bearing + 180, size);
    return [tip, offset(base, bearing + 90, size * 0.6), offset(base, bearing - 90, size * 0.6), tip];
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

  // --- Fargemodus ---
  // Skriptet i <head> (base.njk) setter data-theme før siden tegnes. Her kobles knappene til, og
  // siden følger med når enheten bytter mellom lys og mørk mens valget er «Auto».
  var THEME_COLORS = { light: "#F3F5F4", dark: "#11191D" };
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }

  function applyTheme(choice) {
    var root = document.documentElement;
    var theme = choice === "dark" || (choice === "auto" && darkQuery && darkQuery.matches) ? "dark" : "light";
    var changed = root.getAttribute("data-theme") !== theme;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-choice", choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
    // Bilder med egen mørk variant, som Yr-meteogrammet. Den lyse adressen huskes i data-src-light.
    document.querySelectorAll("img[data-src-dark]").forEach(function (img) {
      if (!img.hasAttribute("data-src-light")) img.setAttribute("data-src-light", img.getAttribute("src"));
      var src = img.getAttribute(theme === "dark" ? "data-src-dark" : "data-src-light");
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
    document.querySelectorAll(".theme-toggle button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === choice));
    });
    if (changed) document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  document.querySelectorAll(".theme-toggle").forEach(function (group) {
    group.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-theme-choice]");
      if (!button) return;
      var choice = button.getAttribute("data-theme-choice");
      try {
        if (choice === "auto") localStorage.removeItem("theme");
        else localStorage.setItem("theme", choice);
      } catch (e) {
        // privat modus eller blokkert lagring: valget gjelder bare denne siden
      }
      applyTheme(choice);
    });
  });
  if (darkQuery) {
    var onSystemChange = function () { if (document.documentElement.getAttribute("data-theme-choice") === "auto") applyTheme("auto"); };
    if (darkQuery.addEventListener) darkQuery.addEventListener("change", onSystemChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
  }
  applyTheme(document.documentElement.getAttribute("data-theme-choice") || "auto");

  // --- Fargeblindvennlige farger ---
  // Bytter vindvurderingen til blå / gul / oransjerød / grå (Okabe–Ito). Lagres som «cvd» i nettleseren.
  function applyCvd(on) {
    var root = document.documentElement;
    if (on) root.setAttribute("data-cvd", "on");
    else root.removeAttribute("data-cvd");
    document.querySelectorAll("[data-cvd-toggle]").forEach(function (b) { b.setAttribute("aria-checked", String(on)); });
  }
  document.querySelectorAll("[data-cvd-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var on = document.documentElement.getAttribute("data-cvd") !== "on";
      try {
        if (on) localStorage.setItem("cvd", "on");
        else localStorage.removeItem("cvd");
      } catch (e) {
        // blokkert lagring: valget gjelder bare denne siden
      }
      applyCvd(on);
    });
  });
  applyCvd(document.documentElement.getAttribute("data-cvd") === "on");

  // --- Meny ---
  // Åpnes med knappen, lukkes med knappen, Escape eller klikk utenfor.
  document.querySelectorAll(".site-menu").forEach(function (menu) {
    var button = menu.querySelector(".site-menu__button");
    var panel = menu.querySelector(".site-menu__panel");
    button.hidden = false;
    function setOpen(open) {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }
    button.addEventListener("click", function () { setOpen(panel.hidden); });
    document.addEventListener("click", function (ev) { if (!panel.hidden && !menu.contains(ev.target)) setOpen(false); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !panel.hidden) { setOpen(false); button.focus(); }
    });
  });

  window.FlyingSites = {
    isDark: isDark,
    EXTERNAL_MARK: EXTERNAL_MARK,
    DIRECTIONS: DIRECTIONS,
    DIRECTION_LABELS: DIRECTION_LABELS,
    directionType: directionType,
    roseSvg: roseSvg,
    launchPoints: launchPoints,
    directionArcs: directionArcs,
    arrowHead: arrowHead,
    offset: offset,
    createMap: createMap,
    addAirspaceLayers: addAirspaceLayers,
    fitWhenVisible: fitWhenVisible,
    addViewControls: addViewControls,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    readJson: readJson,
  };
})();
