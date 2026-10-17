// Site page: map with launch, landing, parking and walking routes, and elevation profile.
(function () {
  "use strict";

  var FS = window.FlyingSites;

  // On mobile, Fakta, Bilder, «Logg og mer» and the winds aloft start folded, so the page is shorter. They are open
  // in the HTML, so desktop and pages without JavaScript show everything.
  if (window.matchMedia("(max-width: 1023px)").matches) {
    document.querySelectorAll("details[data-fold-mobile]").forEach(function (d) { d.open = false; });
  }

  var data = FS.readJson("site-data");
  var mapEl = document.getElementById("site-map");
  if (!data || !mapEl) return;

  var ACCENT = "#C24A12";
  // The walking route must be visible on both light and dark maps (dark mode, see styles.css).
  function inkColor() { return FS.isDark() ? "#F3F5F4" : "#1C2B33"; }
  var INK = inkColor();
  // The mouse wheel only zooms with Ctrl/Cmd, see «Zoom with the mouse wheel» below.
  var map = FS.createMap(mapEl, { scrollWheelZoom: true });
  var bounds = [];
  var routeLines = [];

  function squareIcon(className, text) {
    return L.divIcon({ className: "map-icon " + className, html: text || "", iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  (data.routes || []).forEach(function (route) {
    var line = L.polyline(route.line, { color: INK, weight: 4, dashArray: "2 8", lineCap: "round", opacity: 0.9 }).addTo(map);
    line.bindTooltip(FS.t("site.route") + (route.name ? " " + route.name : ""), { sticky: true });
    routeLines.push(line);
    route.line.forEach(function (p) { bounds.push(p); });
  });

  document.addEventListener("themechange", function () {
    INK = inkColor();
    routeLines.forEach(function (line) { line.setStyle({ color: INK }); });
  });

  // --- Points: launches, landing, parking and numbered points ---
  // All are in one layer. Points that would overlap are merged into one box with the same symbols
  // at small size (dot with launch count, target, P, number), so the map does not become a mess of
  // overlapping symbols. Tapping the box zooms in until they separate. From CLUSTER_OFF_ZOOM everything
  // is shown separately, including points at exactly the same position (such as a number on a launch:
  // the number is then placed above the dot). The kind of symbol is in options.kind.
  var CLUSTER_OFF_ZOOM = 16;
  var POINT_ORDER = { launch: 0, landing: 1, parking: 2, pin: 3 };
  function comboIcon(cluster) {
    var children = cluster.getAllChildMarkers();
    var launches = children.filter(function (m) { return m.options.kind === "launch"; }).length;
    if (launches === children.length) return launchIcon(launches);
    children.sort(function (a, b) {
      return POINT_ORDER[a.options.kind] - POINT_ORDER[b.options.kind] || (a.options.n || 0) - (b.options.n || 0);
    });
    var parts = [], names = [], launchDone = false;
    children.forEach(function (m) {
      var o = m.options;
      if (o.kind === "launch") {
        if (launchDone) return;
        launchDone = true;
        parts.push('<span class="map-combo__launch">' + (launches > 1 ? launches : "") + "</span>");
        names.push(launches > 1 ? FS.t("site.launchN", { n: launches }) : FS.t("site.launch"));
        return;
      }
      if (o.kind === "landing") parts.push('<span class="map-symbol map-symbol--landing' + (o.alternative ? " map-symbol--alt" : "") + '"></span>');
      else if (o.kind === "parking") parts.push('<span class="map-icon map-icon--parking">P</span>');
      else parts.push('<span class="drawing-pin' + (o.hazard ? " drawing-pin--hazard" : "") + '">' + o.n + "</span>");
      names.push(o.title);
    });
    var title = FS.t("site.zoomIn", { names: names.join(", ") });
    return L.divIcon({
      className: "map-combo-anchor",
      html: '<span class="map-combo" title="' + FS.escapeHtml(title) + '">' + parts.join("") + "</span>",
      iconSize: [0, 0],
    });
  }
  var pointLayer = L.markerClusterGroup({
    // The boxes are wider than the dots, so when zoomed far out more are merged.
    maxClusterRadius: function (zoom) { return zoom <= 13 ? 80 : 32; },
    disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
    spiderfyOnMaxZoom: false,
    iconCreateFunction: comboIcon,
  }).addTo(map);
  // Tapping the box zooms one step in when the points then separate, otherwise straight to CLUSTER_OFF_ZOOM
  // (points almost on the same spot), so few taps are needed and the map does not zoom in too close.
  pointLayer.on("clusterclick", function (ev) {
    var b = ev.layer.getBounds(), next = map.getZoom() + 1;
    var spread = map.project(b.getNorthWest(), next).distanceTo(map.project(b.getSouthEast(), next));
    map.setView(b.getCenter(), spread >= 34 ? next : Math.max(next, CLUSTER_OFF_ZOOM));
  });

  (data.parking || []).forEach(function (p) {
    var name = p.name || FS.t("site.parking");
    L.marker([p.lat, p.lon], { icon: squareIcon("map-icon--parking", "P"), title: name, alt: name, kind: "parking" })
      .bindTooltip(name, { direction: "top", offset: [0, -10] })
      .addTo(pointLayer);
    bounds.push([p.lat, p.lon]);
  });

  // Landing as a target, alternative landing in grey. The look is in styles.css (.map-symbol).
  (data.landings || []).forEach(function (landing) {
    var isAlternative = landing.primary === false;
    var name = landing.name || (isAlternative ? FS.t("site.altLanding") : FS.t("site.landing"));
    var icon = L.divIcon({ className: "map-symbol map-symbol--landing" + (isAlternative ? " map-symbol--alt" : ""), iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([landing.lat, landing.lon], { icon: icon, title: name, alt: name, kind: "landing", alternative: isAlternative })
      .bindTooltip(name, { direction: "top", offset: [0, -12] })
      .addTo(pointLayer);
    bounds.push([landing.lat, landing.lon]);
  });

  // --- Launches as blue dots ---
  // Directions are shown by the yellow arcs, so launches are just dots, which are easier to see.
  // Which launches are drawn is decided by launchPoints() in common.js. Launches so close that
  // the dots would overlap are merged into one dot with the count (or a box with the other
  // points, see above). Zooming in, or tapping it, splits them. The directions are in the
  // label on hover or tap.
  function launchIcon(count) {
    return L.divIcon({
      className: "map-symbol map-symbol--launch-dot",
      html: count > 1 ? '<span class="map-symbol__count">' + count + "</span>" : "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }
  FS.launchPoints(data).forEach(function (p) {
    L.marker([p.lat, p.lon], { icon: launchIcon(1), title: p.label, alt: p.label, zIndexOffset: 1000, kind: "launch" })
      .bindTooltip(p.label, { direction: "top", offset: [0, -10] })
      .addTo(pointLayer);
    bounds.push([p.lat, p.lon]);
  });

  // --- Direction arcs ---
  // Which sides of the mountain the site suits, seen from above: yellow arcs with arrow and direction, like the yellow
  // lines on the drawn overview images. Computed from the site file (directionArcs in common.js).
  // Below the roses, so launches can be tapped.
  var arcPane = map.createPane("arcs");
  arcPane.style.zIndex = 450;
  arcPane.style.pointerEvents = "none";
  var ll = function (p) { return [p[1], p[0]]; };
  // The arc is kept at least ARC_MIN_PX on screen, and arrow and direction label are computed in pixels, so it
  // stays readable when zoomed out. Redrawn when the zoom changes.
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
  // The map must also fit the arcs when it zooms to the content.
  FS.directionArcs(data).forEach(function (arc) { arc.pts.forEach(function (p) { bounds.push(ll(p)); }); });

  // --- The drawing (<id>-drawing.geojson) ---
  // Lines and areas (flight path, launch edge, hazard) below the points. Colours as in lib/drawing.js.
  var STYLE_COLORS = { flight: ACCENT, hazard: "#B7791F", info: "#2E5E6E", launch: "#F2B705", landing: "#1C2B33" };
  var features = (data.drawing && data.drawing.features) || [];
  features.forEach(function (f) {
    var p = f.properties || {};
    var color = STYLE_COLORS[p.style] || (p.kind === "area" ? STYLE_COLORS.hazard : STYLE_COLORS.flight);
    var layer = null;
    if (p.kind === "path") {
      var line = f.geometry.coordinates.map(ll);
      L.polyline(line, { pane: "arcs", color: "#1C2B33", weight: 7, opacity: 0.8, interactive: false }).addTo(map);
      layer = L.polyline(line, { color: color, weight: 4, dashArray: p.dashed ? "8 7" : null, lineCap: "round" }).addTo(map);
      if (p.arrow && line.length > 1) {
        var c = f.geometry.coordinates, a = c[c.length - 2], b = c[c.length - 1];
        var bearing = Math.atan2((b[0] - a[0]) * Math.cos(b[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI;
        L.polygon(FS.arrowHead(b, bearing, 40).map(ll), { color: "#1C2B33", weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }).addTo(map);
      }
    } else if (p.kind === "area") {
      layer = L.polygon(f.geometry.coordinates[0].map(ll), { color: color, weight: 2.5, fillColor: color, fillOpacity: 0.2 }).addTo(map);
    }
    if (layer && p.title) layer.bindPopup("<strong>" + FS.escapeHtml(p.title) + "</strong>" + (p.text ? "<br>" + FS.escapeHtml(p.text) : ""));
  });

  // Numbered points, with the same numbers as the list below the map. Tapping a point shows its text and
  // highlights it in the list. Tapping in the list moves the map there and shows the text. A hazard is a light square with a red border.
  var labels = features.filter(function (f) { return f.properties && f.properties.kind === "label" && f.properties.title; });
  var pinMarkers = labels.map(function (f, i) {
    var p = f.properties, n = i + 1, hazard = p.style === "hazard";
    return L.marker(ll(f.geometry.coordinates), {
      icon: L.divIcon({ className: "drawing-pin" + (hazard ? " drawing-pin--hazard" : ""), html: String(n), iconSize: [26, 26], iconAnchor: [13, 36] }),
      title: n + ". " + p.title, alt: n + ". " + p.title, zIndexOffset: 1100, kind: "pin", n: n, hazard: hazard,
    }).bindPopup("<strong>" + FS.escapeHtml(n + ". " + p.title) + "</strong>" + (p.text ? "<br>" + FS.escapeHtml(p.text) : ""), { offset: [0, -24] })
      .on("click", function () { selectPoint(n); })
      .addTo(pointLayer);
  });
  function selectPoint(n) {
    document.querySelectorAll(".drawing-list li").forEach(function (li) { li.classList.toggle("is-selected", li.getAttribute("data-n") === String(n)); });
  }
  document.querySelectorAll(".drawing-list button[data-n]").forEach(function (button) {
    button.addEventListener("click", function () {
      var n = Number(button.getAttribute("data-n")), m = pinMarkers[n - 1];
      if (!m) return;
      selectPoint(n);
      mapEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // If the point is in a box, zoom in until it is shown on its own.
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
      if (pointLayer.getVisibleParent(m) !== m) map.setView(m.getLatLng(), CLUSTER_OFF_ZOOM, { animate: false });
      m.openPopup();
    });
  });

  // --- Zoom with the mouse wheel ---
  // The mouse wheel scrolls the page as normal. With Ctrl (or Cmd on Mac) it zooms the map, as in Google Maps.
  // Without Ctrl a short hint is shown. Zoom buttons and +/- on the keyboard (when the map has focus) work as before.
  var hint = document.createElement("div");
  hint.className = "map-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? FS.t("site.zoomHintMac") : FS.t("site.zoomHint");
  mapEl.appendChild(hint);
  var hintTimer = null;
  // Caught before Leaflet sees the event (capture), so Leaflet's own zoom only gets scrolling with Ctrl/Cmd.
  // Leaflet then also stops the browser from zooming the whole page.
  mapEl.addEventListener("wheel", function (ev) {
    if (ev.ctrlKey || ev.metaKey) { hint.classList.remove("is-visible"); return; }
    ev.stopPropagation();
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove("is-visible"); }, 1200);
  }, true);

  // Zooms so the whole site is shown: launches, landing, parking, walking routes and direction arcs.
  function fitAll() {
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: false });
    else map.setView([data.launch.lat, data.launch.lon], 14, { animate: false });
    // Arcs are kept at least ARC_MIN_PX and can then be larger than the content. If they do not fit,
    // zoom out until they do, with room for the direction labels (at most twice).
    for (var i = 0; i < 3; i++) {
      drawArcs();
      if (!arcLayer.getLayers().length) break;
      var arcBounds = L.latLngBounds([]);
      arcLayer.eachLayer(function (layer) { arcBounds.extend(layer.getBounds ? layer.getBounds() : layer.getLatLng()); });
      // Direction labels sit outside the arc, and the zoom buttons cover the left corner, so more room is needed.
      var inner = L.latLngBounds(map.containerPointToLatLng([90, 60]), map.containerPointToLatLng(map.getSize().subtract([60, 50])));
      if (inner.contains(arcBounds)) break;
      map.fitBounds(arcBounds.extend(L.latLngBounds(bounds)), { paddingTopLeft: [90, 60], paddingBottomRight: [60, 50], maxZoom: 15, animate: false });
    }
  }
  FS.fitWhenVisible(map, mapEl, fitAll);

  // «Vis hele stedet» and full screen below the zoom buttons (common.js).
  FS.addViewControls(map, mapEl, fitAll, FS.t("site.showWholeSite"));

  // --- Elevation profile ---
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
  // The marker for the position along the route is dark, not orange (reserved for hazard and wind).
  var positionMarker = L.circleMarker([0, 0], { radius: 8, color: "#1C2B33", weight: 4, fillColor: "#FFFFFF", fillOpacity: 1, interactive: false });

  // Graph margins, in pixels.
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
    s += '<text class="profile__axis" x="4" y="' + (TOP - 2) + '">' + FS.escapeHtml(FS.t("site.masl")) + "</text>";
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
    readouts.elevation.textContent = Math.round(q[1]) + " " + FS.t("site.masl");
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
      summaryEl.textContent = FS.t("site.noProfile");
      return;
    }
    slider.max = String(route.profile.length - 1);
    var steepM = route.steepM >= 50 ? roundTo(route.steepM, 50) : roundTo(route.steepM, 10);
    var text = FS.t("site.profileSummary", { km: FS.formatNumber(route.lengthKm, 1), from: Math.round(route.fromMasl), to: Math.round(route.toMasl) });
    text += steepM > 0 ? FS.t("site.steep", { m: steepM }) : FS.t("site.noSteep");
    text += route.elevationSource === "Kartverket" ? FS.t("site.heightsKartverket") : FS.t("site.heightsGps");
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
