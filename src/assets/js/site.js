// Stedssiden: kart med start, landing, parkering og gangruter, og høydeprofil.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var data = FS.readJson("site-data");
  var mapEl = document.getElementById("site-map");
  if (!data || !mapEl) return;

  var ACCENT = "#C24A12";
  // Gangruten må synes både på lyst og mørkt kart (mørk modus, se styles.css).
  function inkColor() { return FS.isDark() ? "#F3F5F4" : "#1C2B33"; }
  var INK = inkColor();
  var map = FS.createMap(mapEl, { scrollWheelZoom: false });
  var bounds = [];
  var routeLines = [];

  function squareIcon(className, text) {
    return L.divIcon({ className: "map-icon " + className, html: text || "", iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  (data.routes || []).forEach(function (route) {
    var line = L.polyline(route.line, { color: INK, weight: 4, dashArray: "2 8", lineCap: "round", opacity: 0.9 }).addTo(map);
    line.bindTooltip("Gangrute" + (route.name ? " " + route.name : ""), { sticky: true });
    routeLines.push(line);
    route.line.forEach(function (p) { bounds.push(p); });
  });

  document.addEventListener("themechange", function () {
    INK = inkColor();
    routeLines.forEach(function (line) { line.setStyle({ color: INK }); });
  });

  (data.parking || []).forEach(function (p) {
    var name = p.name || "Parkering";
    L.marker([p.lat, p.lon], { icon: squareIcon("map-icon--parking", "P"), title: name, alt: name })
      .bindTooltip(name, { direction: "top", offset: [0, -10] })
      .addTo(map);
    bounds.push([p.lat, p.lon]);
  });

  // Landing som målskive, alternativ landing i grått. Utseendet ligger i styles.css (.map-symbol).
  (data.landings || []).forEach(function (landing) {
    var isAlternative = landing.primary === false;
    var name = landing.name || (isAlternative ? "Alternativ landing" : "Landing");
    var icon = L.divIcon({ className: "map-symbol map-symbol--landing" + (isAlternative ? " map-symbol--alt" : ""), iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([landing.lat, landing.lon], { icon: icon, title: name, alt: name })
      .bindTooltip(name, { direction: "top", offset: [0, -12] })
      .addTo(map);
    bounds.push([landing.lat, landing.lon]);
  });

  // --- Starter som vindroser ---
  // Hvilke roser som tegnes, står i launchPoints() i common.js (samme i 3D-visningen).
  // Starter som ligger så tett at rosene ville overlappet, slås sammen til én rose med alle retningene
  // og antallet starter. Zoomer man inn, eller trykker på den, deles de opp.
  var windDirections = data.wind_directions || { primary: [], possible: [] };
  function launchIcon(directions, count) {
    return L.divIcon({
      className: "map-symbol map-symbol--launch",
      html: FS.launchRoseHtml(directions, windDirections, count),
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  var launchLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    spiderfyDistanceMultiplier: 1.8,
    iconCreateFunction: function (cluster) {
      var directions = [];
      cluster.getAllChildMarkers().forEach(function (m) {
        m.options.directions.forEach(function (d) { if (directions.indexOf(d) === -1) directions.push(d); });
      });
      return launchIcon(directions, cluster.getChildCount());
    },
  }).addTo(map);
  FS.launchPoints(data).forEach(function (p) {
    L.marker([p.lat, p.lon], { icon: launchIcon(p.directions, 1), title: p.label, alt: p.label, zIndexOffset: 1000, directions: p.directions })
      .bindTooltip(p.label, { direction: "top", offset: [0, -18] })
      .addTo(launchLayer);
    bounds.push([p.lat, p.lon]);
  });

  // --- Retningsbuer ---
  // Hvilke sider av fjellet stedet passer for, sett ovenfra: gule buer med pil og retning, som de gule
  // strekene på de tegnede oversiktsbildene. Regnes ut fra stedsfilen (directionArcs i common.js).
  // Under rosene, så startene kan trykkes på.
  var arcPane = map.createPane("arcs");
  arcPane.style.zIndex = 450;
  arcPane.style.pointerEvents = "none";
  var ll = function (p) { return [p[1], p[0]]; };
  // Buen holdes minst ARC_MIN_PX stor på skjermen, og pil og retningsmerke regnes i piksler, så den
  // er lesbar også når man zoomer ut. Tegnes på nytt når zoomen endres.
  var ARC_MIN_PX = 60;
  var arcLayer = L.layerGroup().addTo(map);
  function metersPerPixel() { return 40075016 * Math.cos(data.launch.lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom())); }
  function drawArcs() {
    arcLayer.clearLayers();
    var mpp = metersPerPixel();
    FS.directionArcs(data, { minRadius: ARC_MIN_PX * mpp, arrow: 26 * mpp }).forEach(function (arc) {
      var line = arc.pts.map(ll), stem = [arc.mid, FS.offset(arc.center, arc.bearing, arc.radius + 16 * mpp)].map(ll);
      var head = FS.arrowHead(arc.tip, arc.bearing, 12 * mpp).map(ll);
      var opts = { pane: "arcs", interactive: false, lineCap: "round", lineJoin: "round" };
      L.polyline(line, Object.assign({ color: "#1C2B33", weight: 9 }, opts)).addTo(arcLayer);
      L.polyline(stem, Object.assign({ color: "#1C2B33", weight: 6 }, opts)).addTo(arcLayer);
      L.polyline(line, Object.assign({ color: arc.color, weight: 5.5 }, opts)).addTo(arcLayer);
      L.polyline(stem, Object.assign({ color: arc.color, weight: 3 }, opts)).addTo(arcLayer);
      L.polygon(head, Object.assign({ color: "#1C2B33", weight: 1.5, fillColor: arc.color, fillOpacity: 1 }, opts)).addTo(arcLayer);
      L.marker(ll(FS.offset(arc.center, arc.bearing, arc.radius + 40 * mpp)), {
        icon: L.divIcon({ className: "arc-label-anchor", html: '<span class="arc-label">' + arc.label + "</span>", iconSize: [0, 0] }),
        interactive: false, keyboard: false, pane: "arcs",
      }).addTo(arcLayer);
    });
  }
  map.on("zoomend", drawArcs);
  // Kartet skal også få plass til buene når det zoomer til innholdet.
  FS.directionArcs(data).forEach(function (arc) { arc.pts.forEach(function (p) { bounds.push(ll(p)); }); });

  // --- Punkter fra tegningen (<id>-drawing.geojson) ---
  // Nummererte punkter med tittel og tekst når man trykker. Fare er en lys firkant med rød kant.
  var labels = ((data.drawing && data.drawing.features) || []).filter(function (f) {
    return f.properties && f.properties.kind === "label" && f.properties.title;
  });
  labels.forEach(function (f, i) {
    var p = f.properties, n = i + 1, hazard = p.style === "hazard";
    L.marker(ll(f.geometry.coordinates), {
      icon: L.divIcon({ className: "drawing-pin" + (hazard ? " drawing-pin--hazard" : ""), html: String(n), iconSize: [26, 26], iconAnchor: [13, 36] }),
      title: n + ". " + p.title, alt: n + ". " + p.title, zIndexOffset: 1100,
    }).bindPopup("<strong>" + FS.escapeHtml(n + ". " + p.title) + "</strong>" + (p.text ? "<br>" + FS.escapeHtml(p.text) : ""))
      .addTo(map);
  });

  FS.fitWhenVisible(map, mapEl, function () {
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: false });
    else map.setView([data.launch.lat, data.launch.lon], 14, { animate: false });
    // Buene holdes minst ARC_MIN_PX store og kan da bli større enn innholdet. Får de ikke plass,
    // zoomes det ut til de er med, med plass til retningsmerkene (høyst to ganger).
    for (var i = 0; i < 3; i++) {
      drawArcs();
      if (!arcLayer.getLayers().length) break;
      var arcBounds = L.latLngBounds([]);
      arcLayer.eachLayer(function (layer) { arcBounds.extend(layer.getBounds ? layer.getBounds() : layer.getLatLng()); });
      // Retningsmerkene står utenfor buen, og zoomknappene dekker venstre hjørne, så det trengs mer luft.
      var inner = L.latLngBounds(map.containerPointToLatLng([90, 60]), map.containerPointToLatLng(map.getSize().subtract([60, 50])));
      if (inner.contains(arcBounds)) break;
      map.fitBounds(arcBounds.extend(L.latLngBounds(bounds)), { paddingTopLeft: [90, 60], paddingBottomRight: [60, 50], maxZoom: 15, animate: false });
    }
  });

  // --- Høydeprofil ---
  var profileEl = document.getElementById("elevation-profile");
  var routes = data.routes || [];
  if (!profileEl || !routes.some(function (r) { return r.profile; })) return;

  var svg = profileEl.querySelector(".profile__graph");
  var slider = profileEl.querySelector(".profile__slider");
  var readouts = {
    distance: profileEl.querySelector('[data-readout="distance"]'),
    elevation: profileEl.querySelector('[data-readout="elevation"]'),
    grade: profileEl.querySelector('[data-readout="grade"]'),
  };
  var summaryEl = profileEl.querySelector(".profile__summary");
  var positionMarker = L.circleMarker([0, 0], { radius: 8, color: ACCENT, weight: 4, fillColor: "#FFFFFF", fillOpacity: 1, interactive: false });

  // Marger i grafen, i piksler.
  var HEIGHT = 150, LEFT = 46, RIGHT = 12, TOP = 14, BOTTOM = 26;
  var activeRoute = 0, index = 0, scale = null;

  function roundTo(n, step) { return Math.round(n / step) * step; }

  function draw() {
    var route = routes[activeRoute];
    if (!route.profile) return;
    var p = route.profile;
    var width = Math.max(260, Math.round(svg.getBoundingClientRect().width || 350));
    svg.setAttribute("viewBox", "0 0 " + width + " " + HEIGHT);
    svg.removeAttribute("preserveAspectRatio");

    var min = Infinity, max = -Infinity;
    p.forEach(function (q) { if (q[1] < min) min = q[1]; if (q[1] > max) max = q[1]; });
    var step = max - min > 400 ? 100 : 50;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    var total = p[p.length - 1][0];
    var x = function (d) { return LEFT + (d / total) * (width - LEFT - RIGHT); };
    var y = function (e) { return TOP + (1 - (e - lo) / (hi - lo)) * (HEIGHT - TOP - BOTTOM); };
    scale = { x: x, y: y, total: total, width: width };

    var line = p.map(function (q, i) { return (i ? "L" : "M") + x(q[0]).toFixed(1) + " " + y(q[1]).toFixed(1); }).join(" ");
    var area = line + " L" + x(total).toFixed(1) + " " + (HEIGHT - BOTTOM) + " L" + LEFT + " " + (HEIGHT - BOTTOM) + " Z";
    var steep = "";
    for (var i = 1; i < p.length; i++) {
      if (Math.abs((p[i][4] + p[i - 1][4]) / 2) > 25) {
        steep += "M" + x(p[i - 1][0]).toFixed(1) + " " + y(p[i - 1][1]).toFixed(1) + " L" + x(p[i][0]).toFixed(1) + " " + y(p[i][1]).toFixed(1) + " ";
      }
    }
    var mid = (lo + hi) / 2;
    var s = "";
    [hi, mid].forEach(function (v) {
      s += '<line class="profile__grid" x1="' + LEFT + '" x2="' + (width - RIGHT) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"></line>';
    });
    [lo, mid, hi].forEach(function (v) {
      s += '<text class="profile__axis" x="' + (LEFT - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v) + "</text>";
    });
    s += '<text class="profile__axis" x="' + LEFT + '" y="' + (HEIGHT - 8) + '">0 km</text>';
    s += '<text class="profile__axis" x="' + (width - RIGHT) + '" y="' + (HEIGHT - 8) + '" text-anchor="end">' + FS.formatNumber(total / 1000, 1) + " km</text>";
    s += '<text class="profile__axis" x="4" y="' + (TOP - 2) + '">moh</text>';
    s += '<path class="profile__area" d="' + area + '"></path>';
    s += '<path class="profile__line" d="' + line + '"></path>';
    s += '<path class="profile__steep" d="' + steep + '"></path>';
    s += '<line class="profile__cursor-line" y1="' + TOP + '" y2="' + (HEIGHT - BOTTOM) + '"></line>';
    s += '<circle class="profile__cursor" r="6"></circle>';
    svg.innerHTML = s;
    moveTo(index);
  }

  function moveTo(i) {
    var p = routes[activeRoute].profile;
    index = Math.max(0, Math.min(p.length - 1, i));
    var q = p[index];
    var cx = scale.x(q[0]).toFixed(1), cy = scale.y(q[1]).toFixed(1);
    var cursorLine = svg.querySelector(".profile__cursor-line");
    cursorLine.setAttribute("x1", cx); cursorLine.setAttribute("x2", cx);
    var cursor = svg.querySelector(".profile__cursor");
    cursor.setAttribute("cx", cx); cursor.setAttribute("cy", cy);
    slider.value = String(index);
    readouts.distance.textContent = FS.formatNumber(q[0] / 1000, 2) + " km";
    readouts.elevation.textContent = Math.round(q[1]) + " moh";
    readouts.grade.textContent = q[4] + " %";
    positionMarker.setLatLng([q[2], q[3]]);
    if (!map.hasLayer(positionMarker)) positionMarker.addTo(map);
  }

  function selectRoute(k) {
    activeRoute = k;
    index = 0;
    var route = routes[k];
    routeLines.forEach(function (l, j) { l.setStyle({ weight: j === k ? 5 : 3, opacity: j === k ? 1 : 0.55 }); });
    profileEl.querySelectorAll("[data-route]").forEach(function (b) {
      b.setAttribute("aria-selected", Number(b.getAttribute("data-route")) === k ? "true" : "false");
    });
    if (!route.profile) {
      svg.innerHTML = "";
      summaryEl.textContent = "Mangler høydedata for denne ruten.";
      return;
    }
    slider.max = String(route.profile.length - 1);
    var steepM = route.steepM >= 50 ? roundTo(route.steepM, 50) : roundTo(route.steepM, 10);
    var text = FS.formatNumber(route.lengthKm, 1) + " km fra " + Math.round(route.fromMasl) + " til " + Math.round(route.toMasl) + " moh. ";
    text += steepM > 0 ? "Ca. " + steepM + " m av turen er brattere enn 25 %. " : "Ingen partier er brattere enn 25 %. ";
    text += route.elevationSource === "Kartverket" ? "Høyder fra Kartverket." : "Høyder fra GPS i gangruten.";
    summaryEl.textContent = text;
    draw();
  }

  function fromPointer(ev) {
    var rect = svg.getBoundingClientRect();
    var px = ((ev.clientX - rect.left) / rect.width) * scale.width;
    var d = ((px - LEFT) / (scale.width - LEFT - RIGHT)) * scale.total;
    var p = routes[activeRoute].profile;
    var best = 0;
    for (var i = 1; i < p.length; i++) if (Math.abs(p[i][0] - d) < Math.abs(p[best][0] - d)) best = i;
    moveTo(best);
  }

  var dragging = false;
  svg.addEventListener("pointerdown", function (ev) { dragging = true; svg.setPointerCapture(ev.pointerId); fromPointer(ev); });
  svg.addEventListener("pointermove", function (ev) { if (dragging) fromPointer(ev); });
  svg.addEventListener("pointerup", function () { dragging = false; });
  svg.addEventListener("pointercancel", function () { dragging = false; });
  slider.addEventListener("input", function () { moveTo(Number(slider.value)); });
  profileEl.querySelectorAll("[data-route]").forEach(function (b) {
    b.addEventListener("click", function () { selectRoute(Number(b.getAttribute("data-route"))); });
  });
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); });

  selectRoute(0);
})();
